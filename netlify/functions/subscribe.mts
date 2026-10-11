// netlify/functions/subscribe.mts  (The Fuglys)
//
// Newsletter sign-up. The form posts to /.netlify/functions/subscribe;
// /api/subscribe (netlify.toml rewrites /api/*) and /api/newsletter (the old
// newsletter.mts, now an alias of this) reach the same handler. Hardened against subscription bombing: bots signing
// real third-party addresses up to many lists to bury them in mail. In order,
// cheapest first:
//
//   1. Honeypot (`fg_nl_extra` must be empty) -- a bot that fills it is told
//      it succeeded and nothing happens.
//   2. Time on page: under MIN_SUBMIT_MS between the form rendering and the
//      submit is a script. Missing timestamps do not trip it (a direct POST
//      sends none; Turnstile is the defence there).
//   3. Cloudflare Turnstile, verified server-side. No secret configured means
//      the endpoint is closed (503), never open.
//   4. Email format.
//   5. Per-IP rate limit: 3 per hour, in Netlify Blobs (hashed IP). Every
//      request that gets this far counts, confirmation email or not.
//   6. Domain check: disposable-mail domains and domains with no MX refused.
//   7. Our own double opt-in. Nothing is written to MailerLite here; the
//      subscriber is created only by /api/newsletter-confirm.
//
// Double opt-in is ours, not MailerLite's account-wide "double opt-in for API"
// (that sends one account-branded email for every brand on the account). The
// address is looked up (read only) and:
//
//   already active in the Fuglys group   -> nothing
//   unsubscribed, bounced or junk        -> nothing (never re-mailed from a form)
//   anything else (new, unconfirmed, or active only on another of the
//   account's lists) -> a branded "Confirm your subscription" email via Resend,
//     at most 1 per address per 24 hours, with a single-use link that expires
//     in 48 hours
//
// Every accepted request gets the same answer, { ok: true }, so the endpoint
// cannot be used to find out who is on the list.
//
// Env vars (Netlify): MAILERLITE_API_KEY, MAILERLITE_GROUP_ID, TURNSTILE_SECRET_KEY,
// RESEND_API_KEY, NEWSLETTER_CONFIRM_SECRET, NOTIFICATION_FROM (the sender),
// and the contact emails' branding: BRAND_NAME, LOGO_URL, EMAIL_HEADER_BG,
// BRAND_ACCENT, SITE_URL. TURNSTILE_SITE_KEY is read at build time by
// src/components/Newsletter.astro. MAILERLITE_GROUP_ID has no default here.

import type { Context } from "@netlify/functions";
import { verifyTurnstile } from "./_shared/turnstile.mjs";
import { hashKey, takeSlot } from "./_shared/rate-limit.mjs";
import { checkEmailDomain } from "./_shared/email-domain.mjs";
import { makeToken } from "./_shared/newsletter-token.mjs";
import { brandFromEnv, confirmationEmail } from "./_shared/newsletter-email.mjs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_SUBMIT_MS = 3000;
const IP_LIMIT = 3;
const IP_WINDOW_MS = 60 * 60 * 1000;
const ADDRESS_LIMIT = 1;
const ADDRESS_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_STORE = "newsletter-rate-limits";
const HONEYPOT = "fg_nl_extra";
const ML = "https://connect.mailerlite.com/api";
const FAILED = "Could not sign you up right now. Please try again later.";
const UNAVAILABLE = "Sign-up is temporarily unavailable. Please try again later.";

const COPY = {
  subject: "Confirm your subscription — The Fuglys",
  preheader: "One click and you’re on the list, survivor. Didn’t sign up? Ignore this and nothing happens.",
  heading: "Confirm you’re one of us",
  intro:
    "Thanks for signing up to Wasteland Whispers! Click below to confirm this is your address and we’ll start sending chaos, merch drops and dispatches from the wasteland.",
  button: "Confirm my subscription",
  signoff: "Stay weird — the Fuglys",
};

function clientIp(req: Request, context: Context): string {
  const xff = req.headers.get("x-forwarded-for");
  return (
    (context as any)?.ip ||
    req.headers.get("x-nf-client-connection-ip") ||
    (xff ? xff.split(",")[0].trim() : "") ||
    "unknown"
  );
}

/**
 * Should this address get a confirmation email? Read only: never writes to
 * MailerLite. Returns true/false, or null when MailerLite could not answer.
 */
async function needsConfirmation(key: string, groupId: string, email: string): Promise<boolean | null> {
  const res = await fetch(`${ML}/subscribers/${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (res.status === 404) return true;
  if (res.status !== 200) {
    console.error("[subscribe] MailerLite lookup failed", res.status, await res.text().catch(() => ""));
    return null;
  }
  const sub = (await res.json().catch(() => null))?.data;
  const status = sub?.status;
  if (status === "unsubscribed" || status === "bounced" || status === "junk") return false;
  const inGroup = (sub?.groups || []).some((g: any) => String(g?.id) === String(groupId));
  if (status === "active" && inGroup) return false;
  return true;
}

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid request" });
  }
  if (!body || typeof body !== "object") return json(400, { error: "Invalid request" });

  // 1. Honeypot: only a non-empty string trips it.
  if (typeof body[HONEYPOT] === "string" && body[HONEYPOT].trim()) {
    console.warn("[subscribe] bot signal: honeypot filled - discarded");
    return json(200, { ok: true });
  }

  // 2. Time on page, from the visitor's own clock (no client/server skew).
  const elapsed = Number(body.fg_nl_ts_submit) - Number(body.fg_nl_ts_load);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_SUBMIT_MS) {
    console.warn(`[subscribe] bot signal: submitted ${elapsed}ms after load - discarded`);
    return json(200, { ok: true });
  }

  // 3. Turnstile.
  const turnstileSecret = process.env.TURNSTILE_SECRET_KEY || "";
  if (!turnstileSecret) {
    console.error("[subscribe] TURNSTILE_SECRET_KEY not set - sign-ups closed");
    return json(503, { error: UNAVAILABLE });
  }
  const token = String(body.turnstileToken || body["cf-turnstile-response"] || "").slice(0, 2048);
  if (!token) return json(400, { error: "Please complete the anti-spam check and try again" });
  const ip = clientIp(req, context);
  const verdict = await verifyTurnstile(turnstileSecret, token, ip);
  if (!verdict.ok) return json(verdict.status, { error: verdict.error });

  // 4. Format.
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254);
  if (!EMAIL_RE.test(email)) return json(400, { error: "Please enter a valid email address" });

  // Everything the rest needs, checked before the request counts against anyone.
  const key = process.env.MAILERLITE_API_KEY;
  const groupId = process.env.MAILERLITE_GROUP_ID;
  const resendKey = process.env.RESEND_API_KEY;
  const confirmSecret = process.env.NEWSLETTER_CONFIRM_SECRET;
  const from = process.env.NOTIFICATION_FROM;
  const site = (process.env.SITE_URL || process.env.URL || new URL(req.url).origin).replace(/\/$/, "");
  if (!key || !groupId || !resendKey || !confirmSecret || !from) {
    console.error(
      "[subscribe] not configured, missing:",
      [!key && "MAILERLITE_API_KEY", !groupId && "MAILERLITE_GROUP_ID", !resendKey && "RESEND_API_KEY", !confirmSecret && "NEWSLETTER_CONFIRM_SECRET",
        !from && "NOTIFICATION_FROM"].filter(Boolean).join(", "),
    );
    return json(503, { error: UNAVAILABLE });
  }

  // 5. Per IP, hashed with the day so it is never stored raw.
  const day = new Date().toISOString().slice(0, 10);
  if (!(await takeSlot(RATE_STORE, hashKey("ip", ip, day), IP_LIMIT, IP_WINDOW_MS))) {
    return json(429, { error: "Too many sign-ups from your connection. Please try again later" });
  }

  // 6. Domain.
  const domain = await checkEmailDomain(email);
  if (!domain.ok) {
    return json(400, {
      error:
        domain.reason === "disposable"
          ? "Please use a permanent email address, not a disposable one"
          : "That email domain can't receive mail. Please check the address",
    });
  }

  // 7. Double opt-in.
  try {
    const needed = await needsConfirmation(key, groupId!, email);
    if (needed === null) return json(502, { error: FAILED });
    if (!needed) {
      console.info("[subscribe] already subscribed or opted out - nothing sent");
      return json(200, { ok: true });
    }

    // At most one confirmation per address per day, whichever IPs ask.
    if (!(await takeSlot(RATE_STORE, hashKey("addr", email), ADDRESS_LIMIT, ADDRESS_WINDOW_MS))) {
      console.info("[subscribe] confirmation already sent to this address today - nothing sent");
      return json(200, { ok: true });
    }

    const { token: confirmToken } = makeToken(confirmSecret, email);
    const mail = confirmationEmail({
      brand: brandFromEnv(),
      copy: COPY,
      confirmUrl: `${site}/newsletter/confirm/?t=${encodeURIComponent(confirmToken)}`,
    });
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!res.ok) {
      console.error("[subscribe] confirmation email failed", res.status, await res.text().catch(() => ""));
      return json(502, { error: FAILED });
    }
  } catch (err: any) {
    console.error("[subscribe] request failed", err?.message || err);
    return json(502, { error: FAILED });
  }
  return json(200, { ok: true });
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
