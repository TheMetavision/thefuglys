/**
 * netlify/functions/printful-webhook.mjs  (The Fuglys)
 *
 * Printful → Sanity fulfilment-status sync, mirroring Cats On Crack, Labrats and
 * The Biker Babies. On Printful events:
 *   package_shipped → find the order, set status "shipped" + carrier/tracking/shippedAt,
 *                     and email the customer their tracking ("It's shipped").
 *   order_failed    → set status "fulfilment-failed" + failureReason (surfaces in Studio).
 *   order_created   → log only (stripe-webhook already marked it "fulfilled").
 *
 * Matching: stripe-webhook stores Printful's order id on the Sanity order as
 * `printfulOrderId`, and sends Printful `external_id` = the last 32 chars of the
 * Stripe session id, which is also the Sanity _id suffix (order.<key>, or the
 * older order-<key>). We match on printfulOrderId first, then external_id.
 *
 * Writes go through _shared/printful-shipped.mjs and server-patch.mjs: the
 * published order AND an open Studio draft get the same values (publishing
 * the draft never rolls tracking back). Every package is kept in
 * printfulShipments; a repeated event for a package already recorded (same
 * Printful shipment id or tracking number) is logged and skipped, so
 * shippedAt doesn't move and no second email goes. Writes are
 * read-decide-write on the order's _rev: when two packages of one order
 * arrive together, the one that loses the race re-reads and writes again,
 * so neither package's tracking or email is dropped.
 *
 * After the first "It's shipped" email the post-delivery sequence starts
 * (_shared/post-delivery.mjs: referral code + MailerLite), once per order,
 * unless the wall-art dispatch email started it first. It never blocks or
 * undoes the email.
 *
 * Every step is non-fatal — processed events always get 200 so Printful doesn't
 * retry-storm. Only a bad ?key (401), wrong method (405) or unparseable body (400)
 * gets anything else.
 *
 * Env vars:
 *   SANITY_API_TOKEN        — Sanity *write* (Editor) token (SANITY_TOKEN still works as a fallback)
 *   SANITY_PROJECT_ID       — optional; default ngx60q2x
 *   SANITY_DATASET          — optional; default production
 *   PRINTFUL_WEBHOOK_SECRET — optional; if set, the request must include ?key=<secret>
 *   RESEND_API_KEY          — optional; without it the tracking email is skipped
 *   (sender and reply-to: EMAIL_FROM / EMAIL_REPLY_TO in _shared/site-config.mjs)
 *                             (the order confirmation's sender in stripe-webhook.cjs)
 *   BRAND_NAME              — optional; default "The Fuglys"
 *   BRAND_ACCENT            — optional; falls back to EMAIL_ACCENT, then #99132F (site --color-accent)
 *                             (the order confirmation's accent in stripe-webhook.cjs)
 *   EMAIL_HEADER_BG         — optional; default #263F44
 *   LOGO_URL                — optional; absolute https logo for the email header (text wordmark without it)
 *
 * Point Printful's webhook at:
 *   https://thefuglys.com/api/printful-webhook?key=<PRINTFUL_WEBHOOK_SECRET>
 * (Default function path — no `export const config = { path }`; the
 *  netlify.toml /api/* rewrite maps it to /.netlify/functions/printful-webhook,
 *  which also still works.)
 */
import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@sanity/client';
import { setting } from './_shared/site-config.mjs';
import { findPrintfulOrder, recordShipped, recordFailed } from './_shared/printful-shipped.mjs';
import { startPostDelivery } from './_shared/post-delivery.mjs';

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 8000;

// Read per call so tests (and env changes) take effect without a reload.
const sanityProjectId = () => process.env.SANITY_PROJECT_ID || 'ngx60q2x';
const sanityDataset = () => process.env.SANITY_DATASET || 'production';
// SANITY_API_TOKEN is the name Netlify and the site use; SANITY_TOKEN is the older one.
const sanityWriteToken = () => process.env.SANITY_API_TOKEN || process.env.SANITY_TOKEN || '';
// Accent and sender match the order confirmation (stripe-webhook.cjs), so both
// emails look alike and come from the address already verified in Resend.
const brand = () => ({
  name: process.env.BRAND_NAME || 'The Fuglys',
  accent: process.env.BRAND_ACCENT || process.env.EMAIL_ACCENT || '#99132F',
  headerBg: process.env.EMAIL_HEADER_BG || '#263F44',
  logoUrl: setting('LOGO_URL'), // site-config's logo unless LOGO_URL is set
  from: setting('EMAIL_FROM'),
  replyTo: setting('EMAIL_REPLY_TO'),
});

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function keyMatches(given, secret) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

// On an order that also has wall art (made and posted by us, through the
// Sendcloud flow), this email covers Printful's parcel only: it says the wall
// art travels separately, so the two emails never contradict each other. The
// wall-art email (netlify/functions/_shared/dispatch-email.mjs) says the same
// the other way round. The only change made to this file for shipping.
export const WALL_ART_NOTE = 'Your wall art is made by us and ships separately, with its own tracking email.';

// Only http(s) links go in the button; anything else is dropped.
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');

// "The Fuglys" → "Fuglys", so the subject reads like the order confirmation's.
const shortName = (name) => String(name).replace(/^the\s+/i, '');

// "It's shipped" email in The Fuglys order-confirmation palette (stripe-webhook.cjs).
export function buildShippedEmailHtml(order, shipment, b = brand()) {
  const ref = esc(order.orderRef || '');
  const carrier = esc(shipment.carrier || 'the carrier');
  const num = esc(shipment.tracking_number || '');
  const url = safeUrl(shipment.tracking_url);
  const header = b.logoUrl
    ? `<img src="${esc(b.logoUrl)}" alt="${esc(b.name)}" width="240" style="max-width:240px;width:240px;height:auto;display:inline-block;border:0;" />`
    : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:3px;color:${esc(b.accent)};text-transform:uppercase;">${esc(b.name)}</span>`;
  const trackBtn = url
    ? `<a href="${esc(url)}" style="display:inline-block;margin-top:8px;padding:12px 26px;background:${esc(b.accent)};color:#fff;font-family:Arial,Helvetica,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:1px;text-decoration:none;border-radius:3px;font-size:14px;">Track your order</a>`
    : '';
  return `<!doctype html><html><body style="margin:0;padding:0;background:#16262b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#16262b;padding:32px 16px;"><tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#1e3238;border:1px solid ${esc(b.accent)};">
        <tr><td style="background:${esc(b.headerBg)};padding:22px 28px;text-align:center;">${header}</td></tr>
        <tr><td style="padding:32px 28px;">
          <h1 style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:24px;letter-spacing:1px;color:#ffffff;text-transform:uppercase;">It's shipped</h1>
          <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#9aa8aa;">Order ref <strong style="color:${esc(b.accent)};">#${ref}</strong></p>
          <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#c4d0d1;">
            Your gear's left the wasteland and is on its way${num ? ` via ${carrier}` : ''}.
          </p>
          ${order.hasInhouse ? `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#c4d0d1;">${esc(WALL_ART_NOTE)}</p>` : ''}
          ${num ? `<p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#9aa8aa;text-transform:uppercase;">Tracking number</p>
          <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#ffffff;font-weight:700;">${num}</p>` : ''}
          ${trackBtn}
          <p style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#7e9093;border-top:1px solid #2e4a51;padding-top:16px;">
            ${esc(b.name)} — printed &amp; shipped on demand. Questions? Just reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

// Never throws: the order is already patched, so a mail failure is just logged.
async function sendShippedEmail(order, shipment) {
  const ref = order.orderRef || '';
  if (!process.env.RESEND_API_KEY) {
    console.warn(`[SHIP-EMAIL-SKIP] ${ref}: RESEND_API_KEY not set.`);
    return;
  }
  if (!order.customerEmail) {
    console.warn(`[SHIP-EMAIL-SKIP] ${ref}: no customer email on the order.`);
    return;
  }
  const b = brand();
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.RESEND_API_KEY },
      body: JSON.stringify({
        from: b.from,
        reply_to: b.replyTo,
        to: order.customerEmail,
        subject: `Your ${shortName(b.name)} order #${ref} has shipped`,
        html: buildShippedEmailHtml(order, shipment, b),
      }),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[SHIP-EMAIL-FAIL] ${ref}: Resend ${res.status} — ${await res.text()}`);
    else console.log(`[SHIP-EMAIL-OK] ${ref}: tracking sent to ${order.customerEmail}.`);
  } catch (err) {
    console.error(`[SHIP-EMAIL-FAIL] ${ref}:`, err && err.message ? err.message : err);
  }
}

// The order writes go through server-patch.mjs, which needs @sanity/client.
export const sanityClientConfig = () => ({
  projectId: sanityProjectId(), dataset: sanityDataset(), apiVersion: '2026-04-14',
  token: sanityWriteToken(), useCdn: false,
});
const defaultSanity = () => createClient(sanityClientConfig());

/**
 * The webhook, with its Sanity client, email and post-delivery start
 * swappable for tests. Netlify uses the default export.
 */
export function createHandler({ getSanity = defaultSanity, sendEmail = sendShippedEmail, start = startPostDelivery } = {}) {
  return async function handler(req) {
    if (req.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    // Optional shared-secret gate via ?key=… (Printful V1 doesn't sign payloads).
    const secret = process.env.PRINTFUL_WEBHOOK_SECRET;
    if (secret) {
      const key = new URL(req.url).searchParams.get('key');
      if (!keyMatches(key, secret)) {
        console.warn('[PRINTFUL-WEBHOOK] rejected: bad or missing ?key');
        return new Response('Unauthorized', { status: 401 });
      }
    } else {
      console.warn('[PRINTFUL-WEBHOOK] PRINTFUL_WEBHOOK_SECRET not set — accepting unauthenticated request.');
    }

    let body;
    try {
      body = await req.json();
    } catch (_) {
      return new Response('Bad request', { status: 400 });
    }

    const eventType = body?.type;
    const printfulOrderId = body?.data?.order?.id;
    const externalId = body?.data?.order?.external_id;
    const label = `Printful #${printfulOrderId ?? '?'} (external_id ${externalId ?? '?'})`;

    try {
      if (eventType !== 'package_shipped' && eventType !== 'order_failed') {
        if (eventType === 'order_created') console.log('[ORDER-CREATED] Printful confirmed', label);
        else console.log('[PRINTFUL-WEBHOOK] unhandled event:', eventType);
        return new Response('OK', { status: 200 });
      }

      if (!sanityWriteToken()) {
        console.warn('[PRINTFUL-WEBHOOK] neither SANITY_API_TOKEN nor SANITY_TOKEN is set — cannot update orders.');
        return new Response('OK', { status: 200 });
      }

      const sanity = getSanity();
      const found = await findPrintfulOrder(sanity, printfulOrderId, externalId);

      if (eventType === 'package_shipped') {
        const shipment = body.data?.shipment || {};
        const trackingNumber = String(shipment.tracking_number || '');
        if (!found) {
          console.error(`[SHIPPED] ORDER NOT FOUND in Sanity for ${label} — tracking ${trackingNumber || 'none'} not recorded.`);
        } else {
          const r = await recordShipped(sanity, found._id, shipment);
          const ref = (r.order && r.order.orderRef) || found.orderRef || found._id;
          if (!r.written) {
            console.log(`[SHIPPED] ${ref} already has package ${trackingNumber || 'without tracking'} — ${r.reason}, skipped.`);
          } else {
            console.log(`[SHIPPED] ${ref} → shipped (${trackingNumber || 'no number'}).`);
            await sendEmail(r.order, shipment);
            // After the email, never before; never throws.
            await start({ sanity, id: found._id, trigger: 'merch', log: console });
          }
        }
      } else {
        const reason = String(body.data?.reason || '');
        if (!found) {
          console.error(`[ORDER-FAILED] ORDER NOT FOUND in Sanity for ${label}. Reason:`, reason);
        } else {
          const r = await recordFailed(sanity, found._id, reason);
          const ref = (r.order && r.order.orderRef) || found.orderRef || found._id;
          if (!r.written) console.log(`[ORDER-FAILED] ${ref} already fulfilment-failed with this reason — ${r.reason}, skipped.`);
          else console.error(`[ORDER-FAILED] ${ref} → fulfilment-failed. Reason:`, reason);
        }
      }

      return new Response('OK', { status: 200 });
    } catch (err) {
      // Non-fatal: log and still 200 so Printful doesn't retry-storm.
      console.error(`[PRINTFUL-WEBHOOK] error handling ${eventType} for ${label}:`, err && err.message ? err.message : err);
      return new Response('OK', { status: 200 });
    }
  };
}

export default createHandler();
