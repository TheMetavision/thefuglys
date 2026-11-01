// netlify/functions/shipping-event.mts
//
// POST /api/shipping-event   the shipping service's tracking callback
// (CALLBACK_URL_<BRAND> on metavision-shipping). Signed with SHIPPING_SECRET;
// see _shared/shipping-events.mjs for what each event does. The first carrier
// scan sends the wall-art dispatch email, once.
//
// Answers 503 while SHIPPING_ENABLED is off, so the service keeps the event
// and retries rather than it being dropped; 5xx on any failure, likewise.

import { shippingEnabled, verifyShippingCallback } from './_shared/shipping-client.mjs';
import { applyParcelEvent, applyReturnEvent } from './_shared/shipping-events.mjs';
import { sanity, getResend } from './_shared/shipping-deps.mts';

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return text('Method not allowed', 405);
  const rawBody = await req.text();
  if (!verifyShippingCallback(req, rawBody)) return text('Invalid signature', 401);
  if (!shippingEnabled()) return text('Shipping is not enabled here yet — retry later', 503);
  let event: any;
  try { event = JSON.parse(rawBody); } catch { return text('Bad JSON', 400); }
  try {
    const deps = { sanity, getResend };
    const r = event?.kind === 'parcel' ? await applyParcelEvent(event, deps)
      : event?.kind === 'return' ? await applyReturnEvent(event, deps)
      : { status: 200, body: 'Unknown kind — ignored' };
    return text(r.body, r.status);
  } catch (err: any) {
    console.error('shipping-event: failed:', err?.stack || err);
    return text('Failed', 500);
  }
}
