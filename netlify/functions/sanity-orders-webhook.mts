// netlify/functions/sanity-orders-webhook.mts
//
// POST /api/sanity-orders-webhook   the Sanity webhook "<Brand> orders"
// (the plan's second slot; the rebuild webhook holds the first and is
// untouched).
//
// Verified with SANITY_WEBHOOK_SECRET (docs/SHIPPING.md says whether this
// site already has it or needs it set). What each delivery starts is decided
// in _shared/orders-router.mjs:
//   - the wall-art dispatch email when Alan dispatches by hand: ALWAYS,
//     whether or not SHIPPING_ENABLED is set;
//   - the default parcel plan, Sendcloud labels and returns: only when
//     SHIPPING_ENABLED is "true". Labels and returns run as background
//     functions, started with an AWAITED request carrying the internal
//     shipping key (an un-awaited one is frozen with this function).
//
// Routed by netlify.toml (/api/* -> /.netlify/functions/:splat); no config.path.

import { isValidSignature, SIGNATURE_HEADER_NAME } from '@sanity/webhook';
import { runRoute, BACKGROUND_PATHS } from './_shared/orders-router.mjs';
import { sendDispatchEmail } from './_shared/dispatch-email.mjs';
import { proposePlanPatch } from './_shared/shipping-dispatch.mjs';
import { readDecideWrite } from './_shared/server-patch.mjs';
import { shippingEnabled } from './_shared/shipping-client.mjs';
import { SHIPPING_INTERNAL_HEADER, shippingInternalKey } from './_shared/shipping-internal.mjs';
import { sanity, getResend, startInternal } from './_shared/shipping-deps.mts';

const text = (body: string, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') return text('Method not allowed', 405);
  const secret = process.env.SANITY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('sanity-orders-webhook: SANITY_WEBHOOK_SECRET not set — refusing');
    return text('Webhook secret not configured', 500);
  }
  const rawBody = await req.text();
  const sig = req.headers.get(SIGNATURE_HEADER_NAME);
  let valid = false;
  try { valid = Boolean(sig) && (await isValidSignature(rawBody, sig!, secret)); } catch { valid = false; }
  if (!valid) return text('Invalid signature', 401);

  let doc: any;
  try { doc = JSON.parse(rawBody); } catch { return text('Bad JSON', 400); }

  try {
    const r = await runRoute(doc, {
      shippingOn: shippingEnabled(),
      sendDispatch: (id: string) => sendDispatchEmail({ id, sanity, getResend }),
      proposePlan: async (id: string) => {
        const { written } = await readDecideWrite(sanity, id, (d: any) => proposePlanPatch(d));
        return written ? 'default plan written' : 'nothing to write';
      },
      start: async (action: string, d: any) => {
        const key = shippingInternalKey();
        if (!key) return { ok: false, error: 'SHIPPING_SECRET is not set' };
        return startInternal(req, BACKGROUND_PATHS[action as keyof typeof BACKGROUND_PATHS], { _id: d._id, _type: d._type },
          { [SHIPPING_INTERNAL_HEADER]: key });
      },
    });
    return text(r.body, r.status);
  } catch (err: any) {
    console.error('sanity-orders-webhook: failed:', err?.stack || err);
    return text('Failed', 500);
  }
}
