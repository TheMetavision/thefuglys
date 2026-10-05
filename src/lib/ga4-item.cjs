// ga4-item.cjs
// -----------------------------------------------------------------------------
// The GA4 item_variant rule and id checks, shared by the browser (view_item,
// add_to_cart, begin_checkout via src/lib/analytics.ts) and the server
// (create-checkout stores the ids, stripe-webhook sends the purchase). CommonJS
// for the same reason as artwork-pricing.cjs: Netlify functions require() it and
// Vite imports it.
// -----------------------------------------------------------------------------

/**
 * item_variant, identical everywhere it is sent:
 *   wall art                 "<format-slug> / <size-slug>"  e.g. "canvas-gallery / large"
 *   clothing, other products "<colour> / <size>"            e.g. "Black / M"
 *   no colour                "<size>"                       e.g. "One Size"
 */
function itemVariant({ productType, format, colour, size } = {}) {
  const s = String(size == null ? '' : size).trim();
  if (productType === 'wallart' || format) return `${String(format || '').trim()} / ${s}`;
  const c = String(colour == null ? '' : colour).trim();
  return c ? `${c} / ${s}` : s;
}

const CLIENT_ID = /^\d+\.\d+$/;
const SESSION_ID = /^\d{1,20}$/;

/**
 * GA client_id / session_id as they may be stored in Stripe metadata: a session
 * id only alongside a valid client id. Returns {} when the client id is invalid.
 */
function validGaIds(clientId, sessionId) {
  const cid = String(clientId == null ? '' : clientId);
  if (!CLIENT_ID.test(cid)) return {};
  const sid = String(sessionId == null ? '' : sessionId);
  return SESSION_ID.test(sid) ? { ga_client_id: cid, ga_session_id: sid } : { ga_client_id: cid };
}

module.exports = { itemVariant, validGaIds, CLIENT_ID, SESSION_ID };
