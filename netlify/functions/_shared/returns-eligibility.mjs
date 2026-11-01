/**
 * What a customer may send back through /returns, per the brand's Returns &
 * Refunds policy (Sanity legalPage.returns-refunds, the same wording on The
 * Fuglys, Labrats, Cats On Crack and The Biker Babies, 20 Oct 2026). Pure:
 * the order and any earlier return requests go in, a verdict per line comes
 * out.
 *
 *   §2 "you have 14 days from the day you receive your order to tell us you
 *       want to cancel. You then have a further 14 days to send the goods back."
 *     -> a request may be made until the end of the 14th day after delivery,
 *        UK time (Alan, 1 Nov 2026). Delivery is shipmentResult.deliveredAt,
 *        which only Sendcloud-tracked wall art has. Without it the request is
 *        ALLOWED and marked "delivery date unknown" for Alan to judge:
 *        refusing would deny someone who is entitled.
 *   "unused, unwashed and in its original condition; returned in suitable
 *    packaging"
 *     -> a condition Alan checks on arrival; the page says it.
 *   §3 not returnable for change of mind: personalised or made-to-spec items,
 *      digital downloads, gift cards
 *     -> none is wall art: the prints are standard designs (§4), so every
 *        wall-art line qualifies.
 *   §5 faulty, damaged or wrong items
 *     -> NOT handled here: the customer emails us, and Alan raises a
 *        free-label return from the order in the Studio.
 *
 * SCOPE (Alan, 1 Nov 2026): wall art only. Merchandise lines (Printful)
 * answer "email us" unless RETURNS_CLOTHING is on; then they are allowed up
 * to CLOTHING_WINDOW_DAYS after the order was placed (14 days from a delivery
 * date we don't have, plus production and transit) and always flagged
 * "delivery date unknown". Orders delivered outside the UK answer "email us":
 * Sendcloud returns are UK-only. Not yet dispatched: "email us to cancel".
 */
import { isWallArtLine, isClothingLine, isUnderwear, formatKeyOf, sizeKeyOf } from './parcel-plan.mjs';

export const RETURN_WINDOW_DAYS = 14;
export const CLOTHING_WINDOW_DAYS = 30;
/** The address in every brand's Returns & Refunds policy. */
export const CONTACT = 'contact@themetavision.co.uk';

export const REASONS = {
  changed_mind: 'Changed my mind',
  doesnt_suit: "Doesn't suit the room / not for me",
  wrong_choice: 'Ordered the wrong size or format',
  other: 'Other',
};

export const CLOTHING_EMAIL_US = `Returns for clothing and other merchandise are handled by email: send your order reference to ${CONTACT} and we'll sort it.`;
export const OVERSEAS_EMAIL_US = `Online returns are for UK addresses. Please email ${CONTACT} with your order reference and we'll arrange your return.`;
export const NOT_DISPATCHED = `This print hasn't been dispatched yet. To cancel it, email ${CONTACT} with your order reference.`;

const LONDON = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });

/** The UK calendar date of an instant, as YYYY-MM-DD. */
export const londonDate = (t) => LONDON.format(new Date(t));

const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** The last day a return can be requested, YYYY-MM-DD. */
export const windowEndsOn = (from, days = RETURN_WINDOW_DAYS) => addDays(londonDate(from), days);

/** '2026-11-12' -> '12 November 2026' */
export const longDate = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
};

/** Has the wall art left us? */
export const wallArtDispatched = (order) => Boolean(order?.shipmentResult?.dispatchedAt || order?.dispatchEmailSentAt)
  || order?.inhouseStatus === 'dispatched';

/**
 * @param {object} order       the order document
 * @param {object} [opts]
 * @param {number} [opts.now]
 * @param {object[]} [opts.existing]  this order's earlier return requests
 * @param {boolean} [opts.clothing]   RETURNS_CLOTHING
 */
export function evaluateReturn(order, { now = Date.now(), existing = [], clothing = false } = {}) {
  const out = { eligible: false, reason: null, deliveredAt: null, deliveryDateUnknown: false, windowEndsOn: null, underwear: false, lines: [] };
  if (!order) { out.reason = 'Order not found.'; return out; }

  const country = String(order.shippingAddress?.country || '').toUpperCase();
  if (country && country !== 'GB') { out.reason = OVERSEAS_EMAIL_US; }

  const deliveredAt = order.shipmentResult?.deliveredAt || null;
  let artWhy = null;
  if (!wallArtDispatched(order)) {
    artWhy = NOT_DISPATCHED;
  } else if (deliveredAt) {
    out.deliveredAt = deliveredAt;
    out.windowEndsOn = windowEndsOn(deliveredAt);
    if (londonDate(now) > out.windowEndsOn) artWhy = `The ${RETURN_WINDOW_DAYS} days to request a return ended on ${longDate(out.windowEndsOn)}. If it's faulty or damaged, please email ${CONTACT}.`;
  }

  const placed = order.placedAt ? windowEndsOn(order.placedAt, CLOTHING_WINDOW_DAYS) : null;
  const clothingWhy = !clothing ? CLOTHING_EMAIL_US
    : (placed && londonDate(now) > placed ? `The return period for this item has ended. If it's faulty, please email ${CONTACT}.` : null);

  const requested = new Map();
  for (const r of existing || []) {
    if (!r || r.status === 'rejected') continue;
    for (const l of r.lines || []) requested.set(l.lineKey, (requested.get(l.lineKey) || 0) + (Number(l.quantity) || 0));
  }

  let artReturnable = false;
  let clothingReturnable = false;
  for (const line of order.items || []) {
    const ordered = Math.max(1, Math.floor(Number(line.quantity) || 1));
    const art = isWallArtLine(line);
    const row = {
      lineKey: line._key,
      title: line.title || 'Item',
      format: line.colour || '',
      size: line.size || '',
      fulfilment: art ? 'inhouse' : 'printful',
      formatKey: art ? formatKeyOf(line) : undefined,
      sizeKey: art ? sizeKeyOf(line) : undefined,
      unitPrice: Math.round(((Number(line.price) || 0) / ordered) * 100) / 100,
      ordered,
      returnable: 0,
      why: null,
    };
    const why = out.reason || (art ? artWhy : clothingWhy);
    if (why) row.why = why;
    else {
      const left = ordered - (requested.get(line._key) || 0);
      if (left <= 0) row.why = 'Already in a return request.';
      else {
        row.returnable = left;
        if (art) artReturnable = true; else clothingReturnable = true;
        if (isClothingLine(line) && isUnderwear(line)) out.underwear = true;
      }
    }
    out.lines.push(row);
  }

  // Delivery date unknown: wall art with no Sendcloud delivery, or any merchandise.
  out.deliveryDateUnknown = (artReturnable && !deliveredAt) || clothingReturnable;
  out.eligible = !out.reason && out.lines.some((l) => l.returnable > 0);
  if (!out.reason && !out.eligible) {
    const reasons = [...new Set(out.lines.map((l) => l.why).filter(Boolean))];
    out.reason = reasons.length === 1 ? reasons[0] : (out.lines.length
      ? `Nothing on this order can be returned online. Email ${CONTACT} with your order reference and we'll help.`
      : 'This order has nothing that can be returned.');
  }
  return out;
}

/** Check what the customer picked against the verdict: the lines for the request, or { error }. */
export function pickLines(verdict, picked) {
  if (!verdict.eligible) return { error: verdict.reason || 'Nothing can be returned.' };
  if (!Array.isArray(picked) || !picked.length) return { error: 'Choose at least one item to return.' };
  const byKey = new Map(verdict.lines.map((l) => [l.lineKey, l]));
  const lines = [];
  const seen = new Set();
  for (const p of picked) {
    const l = byKey.get(p?.lineKey);
    if (!l || seen.has(p.lineKey)) return { error: 'One of the chosen items is not on this order.' };
    seen.add(p.lineKey);
    const q = Math.floor(Number(p.quantity) || 0);
    if (q < 1) continue;
    if (l.returnable < 1) return { error: `"${l.title}" can't be returned online: ${l.why}` };
    if (q > l.returnable) return { error: `You can return at most ${l.returnable} of "${l.title}".` };
    lines.push({
      _key: l.lineKey, _type: 'returnLine', lineKey: l.lineKey, title: l.title,
      format: l.format, size: l.size, fulfilment: l.fulfilment,
      ...(l.formatKey ? { formatKey: l.formatKey } : {}), ...(l.sizeKey ? { sizeKey: l.sizeKey } : {}),
      quantity: q, unitPrice: l.unitPrice,
    });
  }
  if (!lines.length) return { error: 'Choose at least one item to return.' };
  return { lines };
}
