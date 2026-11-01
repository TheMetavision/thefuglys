// netlify/functions/shipping-return-background.mts
//
// POST /api/shipping-return-background   (started by sanity-orders-webhook)
//
// Acts on Alan's decision on a return request: Approved -> label bought and
// emailed with the postage deduction; Rejected -> the reason emailed. See
// _shared/shipping-returns.mjs. Background: create-return, the label PDF and
// an email with an attachment.

import { processReturn } from './_shared/shipping-returns.mjs';
import { shippingEnabled } from './_shared/shipping-client.mjs';
import { isShippingInternal } from './_shared/shipping-internal.mjs';
import { sanity, getResend, shipping, fetchLabel } from './_shared/shipping-deps.mts';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!isShippingInternal(req)) {
    console.warn('shipping-return: request without the internal key — ignored');
    return new Response('Forbidden', { status: 403 });
  }
  if (!shippingEnabled()) return new Response('Shipping is not enabled — ignored');
  let body: any;
  try { body = await req.json(); } catch { return new Response('Bad JSON', { status: 400 }); }
  if (body?._type !== 'returnRequest' || typeof body._id !== 'string' || body._id.startsWith('drafts.')) {
    return new Response('Not a published return request — ignored');
  }
  try {
    const r = await processReturn(body._id, { sanity, shipping, fetchLabel, getResend });
    console.log(`shipping-return: ${body._id}: ${r.outcome}`);
    return new Response(JSON.stringify({ outcome: r.outcome }));
  } catch (err: any) {
    console.error('shipping-return: failed:', err?.stack || err);
    return new Response('Failed', { status: 500 });
  }
}
