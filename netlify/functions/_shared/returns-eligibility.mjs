/**
 * What a customer may send back through /returns, per the brand's Returns &
 * Refunds policy (Sanity legalPage.returns-refunds, the same wording on The
 * Fuglys, Labrats, Cats On Crack and The Biker Babies, 20 Oct 2026). Pure:
 * the order and any earlier return requests go in, a verdict per line comes
 * out.
 *
 * WALL ART (in-house, Sendcloud):
 *   §2 "you have 14 days from the day you receive your order to tell us you
 *       want to cancel. You then have a further 14 days to send the goods back."
 *     -> a request may be made until the end of the 14th day after delivery,
 *        UK time (Alan, 1 Nov 2026). Delivery is shipmentResult.deliveredAt,
 *        which only Sendcloud-tracked wall art has. Without it the request is
 *        ALLOWED and marked "delivery date unknown" for Alan to judge:
 *        refusing would deny someone who is entitled.
 *   §3 not returnable for change of mind: personalised or made-to-spec items,
 *      digital downloads, gift cards
 *     -> none is wall art: the prints are standard designs (§4), so every
 *        wall-art line qualifies.
 *   §5 faulty, damaged or wrong prints
 *     -> NOT handled here: the customer emails us, and Alan raises a
 *        free-label return from the order in the Studio.
 *
 * MERCHANDISE (Printful), when RETURNS_CLOTHING is on (Alan, 2 Nov 2026):
 *   Change of mind / wrong size
 *     -> until the end of the MERCH_WINDOW_DAYS-th day (site-config
 *        RETURNS_MERCH_WINDOW_DAYS, 21 here) after Printful's ship date, UK
 *        time. Printful gives no delivery date, so the ship date stands in
 *        for it; with several packages, the LATEST one (the customer's side
 *        of the doubt). Returned like wall art: quote, prepaid label, postage
 *        deducted. Bands X1 / X2 (parcel-plan.mjs merchBandOf).
 *     -> not for personalised / custom items, gift cards or final-sale items
 *        (§3); "unused, unwashed and in its original condition" is checked
 *        on arrival, and the page says it.
 *   Faulty, misprinted or damaged
 *     -> always reportable once shipped (no change-of-mind window, no
 *        exclusions, any country: nothing is posted back). It becomes a
 *        Printful claim: no label, a photo by reply to our email, and
 *        Printful's deadline of PRINTFUL_CLAIM_DAYS (30) after the EARLIEST
 *        package's ship date, so the team never misses it. A report after
 *        that deadline is still taken, flagged "past Printful's deadline".
 *   No ship date recorded but Printful says shipped (an order from before
 *   ship dates were kept): the window runs from the order date plus
 *   UNKNOWN_SHIP_ALLOWANCE_DAYS, flagged "ship date unknown". Not shipped at
 *   all: "email us to cancel".
 *   Switch off: "email us", as before.
 *
 * Orders delivered outside the UK: wall art and change-of-mind merchandise
 * answer "email us" (Sendcloud returns are UK-only); faulty reports still go.
 */
import { setting, intSetting } from './site-config.mjs';
import { isWallArtLine, isClothingLine, isUnderwear, formatKeyOf, sizeKeyOf, merchBandOf } from './parcel-plan.mjs';

export const RETURN_WINDOW_DAYS = 14;
/** Change of mind on merchandise: days after Printful's ship date (site-config). */
export const MERCH_WINDOW_DAYS = intSetting('RETURNS_MERCH_WINDOW_DAYS', 21);
/** Printful's claim window for a faulty or damaged item: days after it shipped. */
export const PRINTFUL_CLAIM_DAYS = intSetting('PRINTFUL_CLAIM_DAYS', 30);
/** No ship date recorded: production and transit allowed on top of the order date. */
export const UNKNOWN_SHIP_ALLOWANCE_DAYS = 10;
/** The address in every brand's Returns & Refunds policy (site-config CONTACT_EMAIL). */
export const CONTACT = setting('CONTACT_EMAIL');

/** Change-of-mind reasons, for any line. */
export const REASONS = {
  changed_mind: 'Changed my mind',
  doesnt_suit: "Doesn't suit the room / not for me",
  wrong_choice: 'Ordered the wrong size or format',
  other: 'Other',
};
/** The reason that makes a merchandise line a Printful claim (no label). */
export const FAULTY = 'faulty';
export const FAULTY_LABEL = 'Faulty, misprinted or damaged';

export const CLOTHING_EMAIL_US = `Returns for clothing and other merchandise are handled by email: send your order reference to ${CONTACT} and we'll sort it.`;
export const OVERSEAS_EMAIL_US = `Online returns are for UK addresses. Please email ${CONTACT} with your order reference and we'll arrange your return.`;
export const NOT_DISPATCHED = `This print hasn't been dispatched yet. To cancel it, email ${CONTACT} with your order reference.`;
export const MERCH_NOT_SHIPPED = `This item hasn't shipped yet. To cancel it, email ${CONTACT} with your order reference.`;
export const EXCLUDED_WHY = "Personalised, custom, gift-card and final-sale items can't be returned for a change of mind. If it's faulty or damaged, choose that reason instead.";
export const ART_FAULTY_WHY = `For a faulty or damaged print, email ${CONTACT} with your order reference and a photo, and we'll put it right.`;

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
 * Printful's ship dates on an order: every package (printfulShipments), the
 * order's own shippedAt (the latest package), or null when none is recorded.
 * Read only: Printful's fields are printful-webhook's.
 */
export function printfulShipDates(order) {
  const times = [
    ...(Array.isArray(order?.printfulShipments) ? order.printfulShipments.map((s) => s?.shippedAt) : []),
    order?.shippedAt,
  ].map((t) => Date.parse(t || '')).filter(Number.isFinite);
  if (!times.length) return null;
  return { first: new Date(Math.min(...times)).toISOString(), last: new Date(Math.max(...times)).toISOString() };
}

const EXCLUDED = /\b(personali[sz]ed|custom|customi[sz]ed|made[\s-]to[\s-]order|gift\s*card|gift\s*voucher|final\s*sale)\b/i;

/** §3: personalised / custom, gift cards, final sale. Merchandise lines only. */
export const isExcludedLine = (line) => Boolean(line?.personalised || line?.custom || line?.finalSale || line?.giftCard)
  || EXCLUDED.test(String(line?.title || ''));

/**
 * @param {object} order       the order document
 * @param {object} [opts]
 * @param {number} [opts.now]
 * @param {object[]} [opts.existing]  this order's earlier return requests
 * @param {boolean} [opts.clothing]   RETURNS_CLOTHING
 */
export function evaluateReturn(order, { now = Date.now(), existing = [], clothing = false } = {}) {
  const out = {
    eligible: false, reason: null, deliveredAt: null, deliveryDateUnknown: false, windowEndsOn: null, underwear: false,
    shippedAt: null, merchWindowEndsOn: null, claimDeadline: null, shipDateUnknown: false, printfulOrderId: order?.printfulOrderId || null,
    lines: [],
  };
  if (!order) { out.reason = 'Order not found.'; return out; }
  const today = londonDate(now);

  const country = String(order.shippingAddress?.country || '').toUpperCase();
  const overseas = Boolean(country) && country !== 'GB';

  /* wall art */
  const deliveredAt = order.shipmentResult?.deliveredAt || null;
  let artWhy = overseas ? OVERSEAS_EMAIL_US : null;
  if (!artWhy && !wallArtDispatched(order)) {
    artWhy = NOT_DISPATCHED;
  } else if (!artWhy && deliveredAt) {
    out.deliveredAt = deliveredAt;
    out.windowEndsOn = windowEndsOn(deliveredAt);
    if (today > out.windowEndsOn) artWhy = `The ${RETURN_WINDOW_DAYS} days to request a return ended on ${longDate(out.windowEndsOn)}. If it's faulty or damaged, please email ${CONTACT}.`;
  }

  /* merchandise */
  const ship = printfulShipDates(order);
  let merchShipped = false;
  if (clothing) {
    if (ship) {
      merchShipped = true;
      out.shippedAt = ship.last;
      out.merchWindowEndsOn = windowEndsOn(ship.last, MERCH_WINDOW_DAYS);
      out.claimDeadline = windowEndsOn(ship.first, PRINTFUL_CLAIM_DAYS);
    } else if (order.status === 'shipped' && order.placedAt) {
      merchShipped = true;
      out.shipDateUnknown = true;
      out.merchWindowEndsOn = windowEndsOn(order.placedAt, MERCH_WINDOW_DAYS + UNKNOWN_SHIP_ALLOWANCE_DAYS);
    }
  }
  const merchWhy = !clothing ? CLOTHING_EMAIL_US
    : !merchShipped ? MERCH_NOT_SHIPPED
      : overseas ? OVERSEAS_EMAIL_US
        : today > out.merchWindowEndsOn ? `The ${MERCH_WINDOW_DAYS} days to return this ended on ${longDate(out.merchWindowEndsOn)}. If it's faulty or damaged, choose that reason instead.`
          : null;

  const requested = new Map();
  for (const r of existing || []) {
    if (!r || r.status === 'rejected') continue;
    for (const l of r.lines || []) requested.set(l.lineKey, (requested.get(l.lineKey) || 0) + (Number(l.quantity) || 0));
  }

  let artReturnable = false;
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
      productType: !art && line.productType ? String(line.productType) : undefined,
      band: art ? undefined : (merchBandOf(line) || undefined),
      unitPrice: Math.round(((Number(line.price) || 0) / ordered) * 100) / 100,
      ordered,
      returnable: 0,
      claimable: 0,
      why: null,
    };
    const left = ordered - (requested.get(line._key) || 0);
    if (art) {
      if (artWhy) row.why = artWhy;
      else if (left <= 0) row.why = 'Already in a return request.';
      else { row.returnable = left; artReturnable = true; }
    } else {
      // A faulty report needs only the switch on and the item shipped.
      const canClaim = clothing && merchShipped;
      const why = merchWhy || (isExcludedLine(line) ? EXCLUDED_WHY : null);
      if (left <= 0 && (canClaim || !why)) row.why = 'Already in a return request.';
      else {
        if (canClaim) row.claimable = left;
        if (why) row.why = why;
        else {
          row.returnable = left;
          if (isUnderwear(line)) out.underwear = true;
        }
      }
    }
    out.lines.push(row);
  }

  // Delivery date unknown: returnable wall art with no Sendcloud delivery.
  out.deliveryDateUnknown = artReturnable && !deliveredAt;
  out.eligible = out.lines.some((l) => l.returnable > 0 || l.claimable > 0);
  if (!out.eligible) {
    const reasons = [...new Set(out.lines.map((l) => l.why).filter(Boolean))];
    out.reason = reasons.length === 1 ? reasons[0] : (out.lines.length
      ? `Nothing on this order can be returned online. Email ${CONTACT} with your order reference and we'll help.`
      : 'This order has nothing that can be returned.');
  }
  return out;
}

/**
 * Check what the customer picked against the verdict: the lines for the
 * request, or { error }. Each pick is { lineKey, quantity, reason }; a pick
 * without a reason takes `fallbackReason` (the form's single reason before
 * reasons were per item). FAULTY makes a merchandise line a Printful claim.
 */
export function pickLines(verdict, picked, fallbackReason) {
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
    const reason = typeof p.reason === 'string' && p.reason ? p.reason : fallbackReason;
    const faulty = reason === FAULTY;
    if (!faulty && !Object.hasOwn(REASONS, reason)) return { error: `Please choose a reason for "${l.title}".` };
    if (faulty) {
      if (l.fulfilment === 'inhouse') return { error: ART_FAULTY_WHY };
      if (l.claimable < 1) return { error: `"${l.title}" can't be reported online: ${l.why || 'it is not available.'}` };
      if (q > l.claimable) return { error: `You can report at most ${l.claimable} of "${l.title}".` };
    } else {
      if (l.returnable < 1) return { error: `"${l.title}" can't be returned online: ${l.why}` };
      if (q > l.returnable) return { error: `You can return at most ${l.returnable} of "${l.title}".` };
    }
    lines.push({
      _key: l.lineKey, _type: 'returnLine', lineKey: l.lineKey, title: l.title,
      format: l.format, size: l.size, fulfilment: l.fulfilment,
      ...(l.formatKey ? { formatKey: l.formatKey } : {}), ...(l.sizeKey ? { sizeKey: l.sizeKey } : {}),
      ...(l.productType ? { productType: l.productType } : {}),
      ...(l.fulfilment === 'printful' && l.band ? { band: l.band } : {}),
      quantity: q, unitPrice: l.unitPrice,
      reason, reasonLabel: faulty ? FAULTY_LABEL : REASONS[reason],
      route: faulty ? 'claim' : 'return',
    });
  }
  if (!lines.length) return { error: 'Choose at least one item to return.' };
  return { lines };
}

/**
 * Split picked lines into the requests they become, each with its own route:
 *   claim  faulty merchandise: a Printful claim, no label
 *   art    wall art: one label (the bands of returnBandFor)
 *   merch  change-of-mind merchandise: one label, X1 / X2
 * Empty groups are left out; the order is always claim, art, merch.
 */
export function returnRoutes(lines) {
  const groups = { claim: [], art: [], merch: [] };
  for (const l of lines || []) {
    if (l.route === 'claim') groups.claim.push(l);
    else if (l.fulfilment === 'inhouse') groups.art.push(l);
    else groups.merch.push(l);
  }
  return Object.entries(groups).filter(([, ls]) => ls.length).map(([kind, ls]) => ({ kind, lines: ls }));
}
