// ga4-purchase.cjs
// -----------------------------------------------------------------------------
// Server-side GA4 purchase via the Measurement Protocol, sent by stripe-webhook
// after the order is handled and saved. Only for shoppers who accepted analytics:
// create-checkout stores their GA ids (ga_client_id / ga_session_id) in the
// session metadata only when the browser had consent.
//
// Skips silently without GA4_MEASUREMENT_ID + GA4_API_SECRET, without a valid
// ga_client_id, for test-mode sessions, and when the order was already logged
// (a Stripe retry). One overall deadline covers any Stripe lookup and the GA
// call. Never throws.
// -----------------------------------------------------------------------------

const { itemVariant, validGaIds } = require('./ga4-item.cjs');

const MP_URL = 'https://www.google-analytics.com/mp/collect';
const DEFAULT_TIMEOUT_MS = 2500;

const money = (pence) => Math.round(Number(pence) || 0) / 100;
const round2 = (n) => Math.round(n * 100) / 100;

/** Why this session gets no purchase event, or null if it should get one. */
function purchaseSkipReason(session, env = process.env) {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) return 'not-configured';
  if (!session || !session.livemode) return 'not-livemode';
  if (!validGaIds((session.metadata || {}).ga_client_id).ga_client_id) return 'no-client-id';
  return null;
}

function productMeta(li) {
  const p = li && li.price && li.price.product;
  return p && typeof p === 'object' && p.metadata ? p.metadata : {};
}

/** One GA4 item per Stripe line, at the price actually charged per unit. */
function buildItem(li) {
  const m = productMeta(li);
  const quantity = li.quantity || 1;
  const discount = li.amount_discount || 0;
  const subtotal = li.amount_subtotal != null ? li.amount_subtotal : (li.amount_total || 0);
  const productType = m.item_type || (m.fulfilment === 'inhouse' ? 'wallart' : '');
  const item = {
    item_id: m.item_slug || m.wallart_slug || li.description || 'unknown',
    item_name: m.item_name || li.description || '',
    item_category: productType,
    item_variant: itemVariant({
      productType,
      format: m.item_format || m.wallart_format,
      colour: m.item_colour != null ? m.item_colour : m.fuglys_colour,
      size: m.item_size || m.fuglys_size || m.wallart_size,
    }),
    price: round2(money(subtotal - discount) / quantity),
    quantity,
  };
  if (discount > 0) item.discount = round2(money(discount) / quantity);
  return item;
}

/** The Measurement Protocol body for a completed Checkout Session. */
function buildPurchasePayload(session, lineItems) {
  const shippingPence = session.shipping_cost
    ? session.shipping_cost.amount_total || 0
    : ((session.total_details || {}).amount_shipping || 0);
  const taxPence = (session.total_details || {}).amount_tax || 0;
  const ids = validGaIds((session.metadata || {}).ga_client_id, (session.metadata || {}).ga_session_id);

  const params = {
    transaction_id: session.id,
    value: money((session.amount_total || 0) - shippingPence),
    currency: String(session.currency || 'gbp').toUpperCase(),
    shipping: money(shippingPence),
    tax: money(taxPence),
    items: ((lineItems && lineItems.data) || []).map(buildItem),
    engagement_time_msec: 1,
  };
  if (ids.ga_session_id) params.session_id = ids.ga_session_id;

  return {
    client_id: ids.ga_client_id,
    consent: { ad_user_data: 'DENIED', ad_personalization: 'DENIED' },
    events: [{ name: 'purchase', params }],
  };
}

async function run({ session, lineItems, stripe, env, fetchImpl, alreadySent }, signal) {
  try {
    if (await alreadySent) return { sent: false, reason: 'duplicate' };
    if ((!lineItems || !(lineItems.data || []).length) && stripe) {
      lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
        limit: 100,
        expand: ['data.price.product'],
      });
    }
    const url = `${MP_URL}?measurement_id=${encodeURIComponent(env.GA4_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(env.GA4_API_SECRET)}`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPurchasePayload(session, lineItems)),
      signal,
    });
    if (!res.ok) return { sent: false, reason: `http-${res.status}` };
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: signal.aborted ? 'timeout' : 'error' };
  }
}

/**
 * Send the purchase. Resolves to { sent, reason? } within timeoutMs; never throws.
 *   alreadySent — boolean or promise; true skips (the order was logged by an earlier attempt).
 *   lineItems   — the session's line items (expanded product); fetched with `stripe` if absent.
 */
async function sendPurchase({
  session, lineItems, stripe, alreadySent = false,
  env = process.env, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let timer;
  try {
    const skip = purchaseSkipReason(session, env);
    if (skip) return { sent: false, reason: skip };
    const controller = new AbortController();
    const deadline = new Promise((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve({ sent: false, reason: 'timeout' }); }, timeoutMs);
    });
    // A pending alreadySent must not reject unhandled after the deadline wins.
    const prior = Promise.resolve(alreadySent).catch(() => false);
    return await Promise.race([
      run({ session, lineItems, stripe, env, fetchImpl, alreadySent: prior }, controller.signal),
      deadline,
    ]);
  } catch (err) {
    return { sent: false, reason: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { sendPurchase, buildPurchasePayload, buildItem, purchaseSkipReason };
