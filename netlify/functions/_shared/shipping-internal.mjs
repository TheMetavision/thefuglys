/**
 * Two keys the shipping code needs, derived from SHIPPING_SECRET so neither
 * costs an environment variable (the 4 KB function-env limit):
 *
 *   internal key  sanity-orders-webhook starts the background functions
 *                 (shipping-dispatch-background, shipping-return-background)
 *                 with it in SHIPPING_INTERNAL_HEADER.
 *   label key     signs the "Print label" links (/api/shipping-label), which
 *                 the team email and the Studio carry. A link names one label
 *                 and an expiry (LABEL_LINK_DAYS), nothing else.
 *
 * Each is an HMAC of SHIPPING_SECRET under its own fixed label (and the
 * /returns session key under a third, in returns-api.mjs), so knowing one says
 * nothing about another or about SHIPPING_SECRET, and either can be rotated by
 * changing its label. SHIPPING_SECRET is the one secret all four IP brand
 * sites have (Alan, 1 Nov 2026). Rotating it rotates all three: every print
 * link already sent stops working (re-issue them from the Studio: On hold ->
 * Ready to ship, see docs/SHIPPING.md), and it must change on the shipping
 * service at the same time.
 *
 * Fails closed: with no SHIPPING_SECRET there is no key, nothing is accepted
 * and no link can be made.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { setting } from './site-config.mjs';

export const SHIPPING_INTERNAL_HEADER = 'x-mv-shipping-key';
const label = (env, what) => `${setting('SHIPPING_BRAND', env).toLowerCase()}:${what}:v1`;

export const LABEL_LINK_DAYS = 30;
export const LABEL_LINK_PATH = '/api/shipping-label';
/** A link with less than this left is treated as expired when re-issuing. */
export const LABEL_LINK_RENEW_MS = 24 * 60 * 60 * 1000;

const derive = (env, what) => {
  const base = env?.SHIPPING_SECRET;
  return base ? createHmac('sha256', base).update(label(env, what)).digest('hex') : null;
};

const same = (a, b) => {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
};

/** The internal key, or null when SHIPPING_SECRET is unset. */
export function shippingInternalKey(env = process.env) {
  const k = derive(env, 'shipping-internal');
  return k ? k.slice(0, 48) : null;
}

/** Constant-time check of a request's header. */
export function isShippingInternal(req, env = process.env) {
  const want = shippingInternalKey(env);
  return Boolean(want) && same(req.headers.get(SHIPPING_INTERNAL_HEADER), want);
}

const labelSig = (key, labelId, exp) =>
  createHmac('sha256', key).update(`${labelId}.${exp}`).digest('base64url').slice(0, 43);

/**
 * A signed, expiring print link for one label, or null without a key.
 * @returns {{ url: string, expiresAt: string } | null}
 */
export function signLabelLink(labelId, { env = process.env, now = Date.now(), days = LABEL_LINK_DAYS, origin } = {}) {
  const key = derive(env, 'shipping-label-link');
  const id = String(labelId ?? '').trim();
  if (!key || !id) return null;
  const exp = Math.floor((now + days * 24 * 60 * 60 * 1000) / 1000);
  const base = (origin || setting('SITE_URL', env)).replace(/\/+$/, '');
  const q = new URLSearchParams({ l: id, x: String(exp), s: labelSig(key, id, exp) });
  return { url: `${base}${LABEL_LINK_PATH}?${q}`, expiresAt: new Date(exp * 1000).toISOString() };
}

/**
 * Check a link's query. { ok: true, labelId } or { ok: false, reason } where
 * reason is 'invalid' or 'expired'. An expired link is only reported as such
 * when its signature is good, so the page can say "ask for a new link".
 */
export function verifyLabelLink(params, { env = process.env, now = Date.now() } = {}) {
  const key = derive(env, 'shipping-label-link');
  const id = String(params?.get?.('l') || '').trim();
  const exp = String(params?.get?.('x') || '').trim();
  const sig = String(params?.get?.('s') || '').trim();
  if (!key || !id || id.length > 64 || !/^\d{9,11}$/.test(exp) || !sig) return { ok: false, reason: 'invalid' };
  if (!same(sig, labelSig(key, id, Number(exp)))) return { ok: false, reason: 'invalid' };
  if (Number(exp) * 1000 <= now) return { ok: false, reason: 'expired' };
  return { ok: true, labelId: id };
}

/** True when a stored link is missing or has under a day left. */
export function labelLinkStale(expiresAt, now = Date.now()) {
  const t = Date.parse(expiresAt || '');
  return !Number.isFinite(t) || t - now < LABEL_LINK_RENEW_MS;
}

/** The /returns session key (returns-api.mjs), under its own label. */
export function returnsSessionKey(env = process.env) {
  const k = derive(env, 'returns-session');
  return k ? Buffer.from(k, 'hex') : null;
}
