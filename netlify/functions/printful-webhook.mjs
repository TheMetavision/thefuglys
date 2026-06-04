/**
 * netlify/functions/printful-webhook.mjs  (The Fuglys)
 *
 * Printful → Sanity fulfilment-status sync. On Printful events:
 *   package_shipped → find the order by printfulOrderId, set status "shipped"
 *                     + carrier/tracking, and email the customer their tracking.
 *   order_failed    → set status "fulfilment-failed" (so it surfaces in Studio).
 *   order_created   → log only (stripe-webhook already marked it "fulfilled").
 *
 * Every step is non-fatal — we always return 200 so Printful doesn't retry-storm.
 *
 * Env vars:
 *   SANITY_TOKEN          — Sanity *write* (Editor) token (same one the Stripe webhook uses)
 *   SANITY_PROJECT_ID     — optional; default ngx60q2x
 *   SANITY_DATASET        — optional; default production
 *   RESEND_API_KEY        — optional; if set, customer gets a tracking email
 *   ORDER_EMAIL_FROM      — optional; default "The Fuglys <orders@thefuglys.com>"
 *   PRINTFUL_WEBHOOK_SECRET — optional; if set, the request must include ?key=<secret>
 *
 * Point Printful's webhook at:  https://thefuglys.com/.netlify/functions/printful-webhook
 * (Default function path — avoids the netlify.toml [[redirects]] /api/* conflict, so
 *  there is no `export const config = { path: '/api/...' }` here on purpose.)
 */

const SANITY_PROJECT_ID = process.env.SANITY_PROJECT_ID || 'ngx60q2x';
const SANITY_DATASET = process.env.SANITY_DATASET || 'production';
const SANITY_API_VER = '2024-01-01';
const RESEND_URL = 'https://api.resend.com/emails';
const FROM = process.env.ORDER_EMAIL_FROM || 'The Fuglys <orders@thefuglys.com>';

const esc = (s) =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function findOrderByPrintfulId(printfulOrderId) {
  if (!printfulOrderId) return null;
  const groq = `*[_type == "order" && printfulOrderId == $pid][0]{ _id, orderRef, customerName, customerEmail, status }`;
  const params = encodeURIComponent(JSON.stringify(String(printfulOrderId)));
  const url = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VER}/data/query/${SANITY_DATASET}` +
    `?query=${encodeURIComponent(groq)}&$pid=${params}`;
  const res = await fetch(url, {
    headers: { Authorization: 'Bearer ' + process.env.SANITY_TOKEN },
  });
  if (!res.ok) throw new Error(`Sanity query ${res.status}: ${await res.text()}`);
  return (await res.json()).result || null;
}

async function patchOrder(orderId, set) {
  const res = await fetch(
    `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VER}/data/mutate/${SANITY_DATASET}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.SANITY_TOKEN },
      body: JSON.stringify({ mutations: [{ patch: { id: orderId, set } }] }),
    }
  );
  if (!res.ok) throw new Error(`Sanity mutate ${res.status}: ${await res.text()}`);
}

async function sendTrackingEmail(order, shipment) {
  if (!process.env.RESEND_API_KEY || !order.customerEmail) return;
  const ref = esc(order.orderRef || '');
  const carrier = esc(shipment.carrier || 'the carrier');
  const num = esc(shipment.tracking_number || '');
  const url = shipment.tracking_url || '';
  const trackBtn = url
    ? `<a href="${esc(url)}" style="display:inline-block;margin-top:8px;padding:12px 26px;background:#b3162e;color:#fff;font-family:Arial,Helvetica,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:1px;text-decoration:none;border-radius:3px;font-size:14px;">Track your order</a>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#16262b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#16262b;padding:32px 16px;"><tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#1e3238;border:1px solid #b3162e;">
        <tr><td style="background:#263F44;padding:22px 28px;text-align:center;">
          <span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:3px;color:#b3162e;text-transform:uppercase;">The Fuglys</span>
        </td></tr>
        <tr><td style="padding:32px 28px;">
          <h1 style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:24px;letter-spacing:1px;color:#ffffff;text-transform:uppercase;">It's shipped</h1>
          <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#9aa8aa;">Order ref <strong style="color:#b3162e;">#${ref}</strong></p>
          <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#c4d0d1;">
            Your gear's left the wasteland and is on its way${num ? ` via ${carrier}` : ''}.
          </p>
          ${num ? `<p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#9aa8aa;text-transform:uppercase;">Tracking number</p>
          <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:16px;color:#ffffff;font-weight:700;">${num}</p>` : ''}
          ${trackBtn}
          <p style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#7e9093;border-top:1px solid #2e4a51;padding-top:16px;">
            The Fuglys — printed &amp; shipped on demand. Questions? Just reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.RESEND_API_KEY },
    body: JSON.stringify({ from: FROM, to: order.customerEmail, subject: `Your Fuglys order #${order.orderRef} has shipped`, html }),
  });
  if (!res.ok) console.error('[SHIP-EMAIL-FAIL]', res.status, await res.text());
  else console.log(`[SHIP-EMAIL-OK] tracking sent to ${order.customerEmail} for #${order.orderRef}`);
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Optional shared-secret gate via ?key=… (Printful V1 doesn't sign payloads).
  if (process.env.PRINTFUL_WEBHOOK_SECRET) {
    const key = new URL(req.url).searchParams.get('key');
    if (key !== process.env.PRINTFUL_WEBHOOK_SECRET) {
      console.warn('[PRINTFUL-WEBHOOK] rejected: bad or missing ?key');
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body;
  try {
    body = await req.json();
  } catch (_) {
    return new Response('Bad request', { status: 400 });
  }

  const eventType = body.type;
  const printfulOrderId = body.data?.order?.id;

  try {
    if (!process.env.SANITY_TOKEN) {
      console.warn('[PRINTFUL-WEBHOOK] SANITY_TOKEN not set — cannot update orders.');
      return new Response('OK', { status: 200 });
    }

    switch (eventType) {
      case 'package_shipped': {
        const shipment = body.data?.shipment || {};
        const order = await findOrderByPrintfulId(printfulOrderId);
        if (!order) {
          console.error(`[SHIPPED] no Sanity order found for printfulOrderId ${printfulOrderId}`);
          break;
        }
        await patchOrder(order._id, {
          status: 'shipped',
          carrier: shipment.carrier || '',
          trackingNumber: shipment.tracking_number || '',
          trackingUrl: shipment.tracking_url || '',
          shippedAt: new Date().toISOString(),
        });
        console.log(`[SHIPPED] ${order.orderRef} → shipped (${shipment.tracking_number || 'no number'})`);
        await sendTrackingEmail(order, shipment);
        break;
      }

      case 'order_failed': {
        const order = await findOrderByPrintfulId(printfulOrderId);
        if (order) {
          await patchOrder(order._id, { status: 'fulfilment-failed' });
          console.error(`[ORDER-FAILED] ${order.orderRef} → fulfilment-failed. Reason:`, body.data?.reason);
        } else {
          console.error(`[ORDER-FAILED] Printful order ${printfulOrderId} failed; no matching Sanity order. Reason:`, body.data?.reason);
        }
        break;
      }

      case 'order_created':
        console.log('[ORDER-CREATED] Printful confirmed order', printfulOrderId);
        break;

      default:
        console.log('[PRINTFUL-WEBHOOK] unhandled event:', eventType);
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    // Non-fatal: log and still 200 so Printful doesn't retry-storm.
    console.error('[PRINTFUL-WEBHOOK] error:', err && err.message ? err.message : err);
    return new Response('OK', { status: 200 });
  }
}
