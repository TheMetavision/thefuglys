// Email for the leaderboard. Sent through Resend the same way as the Printful "It's shipped" email
// (netlify/functions/printful-webhook.mjs): RESEND_API_KEY and the same 8s timeout. Emails to
// the team come from NOTIFICATION_FROM as before; `customer: true` ones (the parent's receipt)
// come from, and take replies at, the brand address (EMAIL_FROM / EMAIL_REPLY_TO, site-config). Throws on failure so the caller's request fails visibly.
import { setting } from '../functions/_shared/site-config.mjs';
import { brandLook, brandCard } from '../functions/_shared/dispatch-email.mjs';
import { teamLogoBar } from '../functions/_shared/shipping-emails.mjs';

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 8000;

/**
 * The Fuglys logo on every leaderboard email, read through site-config (LOGO_URL from the
 * environment if set, the committed URL otherwise). The parent's receipt gets the customer card
 * (brandCard, as the shipped and returns emails); emails to the team get the small team logo bar.
 */
export function sdEmailHtml({ html, customer = false, title = '' }, b = brandLook()) {
  if (customer) return brandCard(title, html, b);
  return `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #222; max-width: 680px;">${teamLogoBar(b)}${html}</div>`;
}

export async function sendEmail({ to, subject, html, text, replyTo, customer = false, title = '' }) {
  const key = process.env.RESEND_API_KEY;
  const from = customer ? setting('EMAIL_FROM') : (process.env.NOTIFICATION_FROM || setting('TEAM_EMAIL_FROM'));
  if (customer) replyTo = setting('EMAIL_REPLY_TO');
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({ from, to, subject, html: sdEmailHtml({ html, customer, title }), text, reply_to: replyTo }),
    signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error('email failed: ' + res.status + ' ' + (await res.text()).slice(0, 200));
  return res.json();
}
