// netlify/functions/returns.mts
//
// POST /api/returns   the public /returns page (see _shared/returns-api.mjs).
// 404 unless SHIPPING_ENABLED is "true"; lookups answer 503 until
// TURNSTILE_SECRET_KEY is set. Wall art, plus merchandise (labels and
// Printful claims) while RETURNS_CLOTHING (site-config) is on.

import { handleReturns } from './_shared/returns-api.mjs';
import { shippingEnabled, shippingRequest } from './_shared/shipping-client.mjs';
import { verifyTurnstile } from './_shared/turnstile.mjs';
import { takeSlot, hashKey } from './_shared/rate-limit.mjs';
import { flag } from './_shared/site-config.mjs';
import { CONTACT } from './_shared/returns-eligibility.mjs';
import { sanity, getResend } from './_shared/shipping-deps.mts';

export default async function handler(req: Request): Promise<Response> {
  let r: { status: number; body: unknown };
  try {
    r = await handleReturns(req, {
      sanity,
      getResend,
      shippingOn: shippingEnabled(),
      clothing: flag('RETURNS_CLOTHING'),
      turnstile: async (token: string, ip: string) => {
        const secret = process.env.TURNSTILE_SECRET_KEY || '';
        if (!secret) {
          console.error('returns: TURNSTILE_SECRET_KEY not set — lookups closed');
          return { ok: false, status: 503, error: `Returns are unavailable right now. Please email ${CONTACT}.` };
        }
        if (!token) return { ok: false, status: 400, error: 'Please complete the anti-spam check and try again.' };
        return verifyTurnstile(secret, token, ip);
      },
      // Keys are hashed, never a raw IP (rate-limit.mjs).
      rateLimit: (store: string, key: string, limit: number, windowMs: number) =>
        takeSlot(store, hashKey(store, key), limit, windowMs),
      // A slow quote must not hold the page: 6 s, then the general wording.
      quote: (body: object) => shippingRequest('quote-return', {
        body, fetchImpl: (url: string, init: RequestInit) => fetch(url, { ...init, signal: AbortSignal.timeout(6000) }),
      }),
    });
  } catch (err: any) {
    console.error('returns: failed:', err?.stack || err);
    r = { status: 500, body: { error: `Something went wrong. Please try again, or email ${CONTACT}.` } };
  }
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
