/**
 * The customer-facing order reference: "#" + the order's orderRef, which
 * stripe-webhook already stamps as the last 8 characters of the Stripe
 * Checkout session id, upper-cased (cs_live_…zq9xk2bt -> #ZQ9XK2BT).
 *
 * It is what customers already have: the order confirmation, Printful's
 * "It's shipped" email and the order-success page all show #XXXXXXXX, so no
 * brand prefix is added (Alan, 1 Nov 2026). The shipping service receives the
 * bare 8 characters as orderRef (it scopes references per brand), so that is
 * what labels and tracking callbacks carry.
 *
 * Pure (no Node imports, no env): the Studio imports it as well.
 */

export const ORDER_REF_PREFIX = '#';

const BARE = /^[A-Z0-9_]{8}$/;

/** 'cs_live_…' -> '#XXXXXXXX', or null if there is no usable session id. */
export function orderRefFromSession(sessionId) {
  const s = String(sessionId || '').trim();
  if (s.length < 8 || !/^[A-Za-z0-9_]+$/.test(s)) return null;
  return `${ORDER_REF_PREFIX}${s.slice(-8).toUpperCase()}`;
}

/** An order's 8-character reference as stored ('ZQ9XK2BT'), or null. */
export function bareOrderRef(order) {
  if (!order) return null;
  const raw = String(order.orderRef || '').trim().toUpperCase();
  if (BARE.test(raw)) return raw;
  const fromSession = orderRefFromSession(order.stripeSessionId);
  return fromSession ? fromSession.slice(ORDER_REF_PREFIX.length) : null;
}

/** An order's reference as customers see it, e.g. '#ZQ9XK2BT', or null. */
export function orderRefFor(order) {
  const bare = bareOrderRef(order);
  return bare ? `${ORDER_REF_PREFIX}${bare}` : null;
}

/**
 * What a customer typed, or what the shipping service sends back, as the
 * 8-character orderRef stored on the order ('ZQ9XK2BT'), or null.
 * Accepts '#ZQ9XK2BT', 'ZQ9XK2BT', ' zq9xk2bt ', '# ZQ9X K2BT'.
 */
export function normaliseOrderRef(input) {
  const s = String(input || '').replace(/\s+/g, '').replace(/^#/, '');
  return /^[A-Za-z0-9_]{8}$/.test(s) ? s.toUpperCase() : null;
}
