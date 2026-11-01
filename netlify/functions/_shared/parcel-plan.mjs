/**
 * Parcel bands and the default parcel plan for IN-HOUSE wall art.
 *
 * Only wall-art lines (fulfilment "inhouse") are ever planned. Merchandise
 * lines (fulfilment "printful": clothing, stickers, badges…) are made and
 * posted by Printful, whose package_shipped webhook sends its own tracking
 * email; nothing here touches them.
 *
 * BANDS (the shipping service's config/shipping.json holds sizes and weights).
 * Three formats in three sizes (src/lib/artwork-pricing.mjs). A portrait
 * print uses the same band as its landscape twin:
 *
 *                     small 12x8 / 8x12   medium 18x12 / 12x18   large 24x16 / 16x24
 *   poster                  P1                  P3                    P4
 *   canvas-standard         CS1                 CS3                   CS4
 *   canvas-gallery          CG1                 CG3                   CG4
 *
 * Order lines keep the format id in `colour` and the size id in `size`
 * ("small" | "medium" | "large", stripe-webhook.cjs). A printed size ("16x24")
 * is read from its longest edge too. "medium" was 16x12 for orders placed
 * before 1 Nov 2026; it is the same band.
 *
 * DEFAULT PLAN (agreed with Alan, 1 Nov 2026):
 *   - every poster on the order goes in ONE tube, at the band of the largest
 *     poster; each poster after the first adds POSTER_EXTRA_WEIGHT_G, sent to
 *     the service as extraWeightG so the tube isn't under-declared;
 *   - a lone small (12x8) poster goes flat, on its own, at P1;
 *   - each canvas is its own parcel (two canvases, two parcels);
 *   - anything the plan can't place for certain is a `problem`, never a
 *     guess: the order shows in the Studio's "Plan needs a decision" queue;
 *   - outside the UK (posters AND canvas ship worldwide on these sites, but
 *     the service is GB-only): flagged "dispatch by hand".
 *
 * Returns use the same bands; merchandise returns (off until measured) use
 * X1 (mailer) and X2 (bulky box).
 *
 * Pure (no Node imports, no env): the Studio imports it for the band lists.
 */

export const FORMATS = ['poster', 'canvas-standard', 'canvas-gallery'];
export const SIZE_KEYS = ['small', 'medium', 'large'];
const LONG_EDGE = { 12: 'small', 16: 'medium', 18: 'medium', 24: 'large' };

export const BANDS = {
  poster: { small: 'P1', medium: 'P3', large: 'P4' },
  'canvas-standard': { small: 'CS1', medium: 'CS3', large: 'CS4' },
  'canvas-gallery': { small: 'CG1', medium: 'CG3', large: 'CG4' },
};

/** Merchandise return bands (only used when RETURNS_CLOTHING is on). */
export const CLOTHING_BANDS = { mailer: 'X1', bulky: 'X2' };

/** Every band the service knows, so the Studio can pick any of them. */
export const ALL_BANDS = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `P${n}`),
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `CS${n}`),
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `CG${n}`),
  ...[1, 2, 3, 4, 5].map((n) => `X${n}`),
];

export const BAND_TITLES = {
  P1: 'P1 — poster 12x8 (flat, or a tube of 12x8s)',
  P3: 'P3 — poster tube up to 18x12',
  P4: 'P4 — poster tube up to 24x16',
  CS1: 'CS1 — standard canvas 12x8',
  CS3: 'CS3 — standard canvas 18x12',
  CS4: 'CS4 — standard canvas 24x16',
  CG1: 'CG1 — gallery canvas 12x8',
  CG3: 'CG3 — gallery canvas 18x12',
  CG4: 'CG4 — gallery canvas 24x16',
  X1: 'X1 — merchandise mailer',
  X2: 'X2 — merchandise, bulky box',
};

const POSTER_RANK = { P1: 1, P3: 3, P4: 4 };

export const isWallArtLine = (line) => line?.fulfilment === 'inhouse';
export const isClothingLine = (line) => Boolean(line) && line.fulfilment !== 'inhouse';

/** The size key of a wall-art line: a size id, or a printed size ("16x24"). */
export function sizeKeyOf(line) {
  const s = String(line?.sizeKey || line?.size || '').trim().toLowerCase();
  if (SIZE_KEYS.includes(s)) return s;
  const m = /^(\d{1,2})\s*x\s*(\d{1,2})$/.exec(s);
  if (!m) return null;
  return LONG_EDGE[Math.max(Number(m[1]), Number(m[2]))] || null;
}

/** The format key of a wall-art line (kept in `colour` on the order). */
export function formatKeyOf(line) {
  const f = String(line?.formatKey || line?.colour || '').trim();
  return FORMATS.includes(f) ? f : null;
}

/** The band for a format + size key, or null. */
export const bandFor = (format, sizeKey) => BANDS[format]?.[sizeKey] || null;

/** The band of one wall-art line, or null. */
export const bandOfLine = (line) => bandFor(formatKeyOf(line), sizeKeyOf(line));

const qtyOf = (line) => Math.max(1, Math.floor(Number(line?.quantity) || 1));
const titleOf = (line) => line?.title || line?.productTitle || 'Item';

export const INTERNATIONAL_NOTE = 'Sendcloud is UK-only for now, so dispatch this one by hand: set In-house Status to Dispatched with the wall-art carrier and tracking number, and the customer email goes automatically.';

/**
 * The default plan for an order's wall art.
 *
 * @param {object[]} items   the order's `items` (all of them; merchandise is skipped)
 * @param {{ country?: string, posterExtraWeightG?: number }} [opts]
 * @returns {{ plan: object[], problems: string[], international: boolean }}
 */
export function proposeParcelPlan(items, { country = 'GB', posterExtraWeightG = 0 } = {}) {
  const lines = (items || []).filter(isWallArtLine);
  const problems = [];
  const plan = [];
  const international = Boolean(country) && String(country).toUpperCase() !== 'GB';
  if (international) problems.push(`Delivery is to ${String(country).toUpperCase()}. ${INTERNATIONAL_NOTE}`);

  const posters = [];
  const canvases = [];
  for (const line of lines) {
    const format = formatKeyOf(line);
    const band = bandOfLine(line);
    if (!format || !band) {
      problems.push(`"${titleOf(line)}" (${[line.colour, line.size].filter(Boolean).join(' ') || 'no format or size'}): not one of the three formats in 12x8 / 18x12 / 24x16, so there is no band for it. Plan this item by hand.`);
      continue;
    }
    (format === 'poster' ? posters : canvases).push({ line, band });
  }

  let ref = 1;
  const posterQty = posters.reduce((n, p) => n + qtyOf(p.line), 0);
  if (posterQty > 0) {
    const largest = posters.reduce((a, b) => (POSTER_RANK[b.band] > POSTER_RANK[a.band] ? b : a)).band;
    const extra = posterQty - 1;
    const parcel = {
      _key: `parcel-${ref}`,
      _type: 'plannedParcel',
      parcelRef: String(ref),
      band: largest,
      items: posters.map(({ line }) => ({
        _key: `item-${line._key}`, _type: 'plannedItem', lineKey: line._key, title: titleOf(line), quantity: qtyOf(line),
      })),
    };
    if (extra > 0) {
      parcel.extraWeightG = extra * Math.max(0, Math.floor(Number(posterExtraWeightG) || 0));
      if (largest === 'P1') {
        problems.push(`${posterQty} small (12x8) posters: one tube at P1 is assumed. Check P1 suits a tube (or pick a bigger band) before Ready to ship.`);
      }
    }
    plan.push(parcel);
    ref += 1;
  }
  for (const { line, band } of canvases) {
    for (let i = 0; i < qtyOf(line); i++) {
      plan.push({
        _key: `parcel-${ref}`,
        _type: 'plannedParcel',
        parcelRef: String(ref),
        band,
        items: [{ _key: `item-${line._key}-${i + 1}`, _type: 'plannedItem', lineKey: line._key, title: titleOf(line), quantity: 1 }],
      });
      ref += 1;
    }
  }
  return { plan, problems, international };
}

/**
 * What's wrong with a plan (empty when it adds up). `items` are the order's
 * lines; only wall art must be fully planned.
 */
export function validateParcelPlan(plan, items = []) {
  const problems = [];
  const lines = (items || []).filter(isWallArtLine);
  const byKey = new Map(lines.map((l) => [l._key, l]));
  if (!Array.isArray(plan) || !plan.length) return ['The parcel plan is empty'];
  const refs = new Set();
  const planned = new Map();
  for (const p of plan) {
    const ref = String(p?.parcelRef ?? '').trim();
    const label = `Parcel ${ref || '(no ref)'}`;
    if (!ref) problems.push('A parcel has no parcel ref');
    else if (!/^[A-Za-z0-9_-]{1,32}$/.test(ref)) problems.push(`${label}: the parcel ref may only use letters, digits, - and _`);
    else if (refs.has(ref)) problems.push(`${label}: the parcel ref is used twice`);
    refs.add(ref);
    if (!p?.band) problems.push(`${label} has no band`);
    else if (!ALL_BANDS.includes(p.band)) problems.push(`${label}: "${p.band}" is not a known band`);
    if (p?.extraWeightG != null && !(Number(p.extraWeightG) >= 0 && Number(p.extraWeightG) <= 5000)) problems.push(`${label}: extra weight must be 0 to 5000 grams`);
    const its = Array.isArray(p?.items) ? p.items : [];
    if (!its.length) problems.push(`${label} has nothing in it`);
    for (const it of its) {
      const line = byKey.get(it?.lineKey);
      if (!line) { problems.push(`${label} lists an item that is not wall art on this order (${it?.lineKey || 'blank'})`); continue; }
      const q = Math.floor(Number(it.quantity) || 0);
      if (q < 1) problems.push(`${label}: quantity for "${titleOf(line)}" must be at least 1`);
      planned.set(it.lineKey, (planned.get(it.lineKey) || 0) + Math.max(q, 0));
    }
  }
  for (const line of lines) {
    const want = qtyOf(line);
    const got = planned.get(line._key) || 0;
    if (got !== want) problems.push(`"${titleOf(line)}" (${[line.colour, line.size].filter(Boolean).join(' ')}): ${want} ordered, ${got} in the parcel plan`);
  }
  return problems;
}

/**
 * The items list create-parcel wants for one planned parcel. The line title
 * already carries the format and printed size ("… — Poster Print · Medium
 * (12 x 18")", create-checkout.cjs).
 */
export function parcelItems(parcel, items = [], { skuPrefix = '' } = {}) {
  const byKey = new Map((items || []).map((l) => [l._key, l]));
  return (parcel.items || []).map((it) => {
    const line = byKey.get(it.lineKey) || {};
    const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
    const unit = (Number(line.price) || 0) / qtyOf(line);
    const sku = [skuPrefix, formatKeyOf(line), sizeKeyOf(line)].filter(Boolean).join('-');
    return {
      description: String(titleOf(line)).slice(0, 120) || 'Wall art print',
      qty,
      valueGBP: Math.round(unit * qty * 100) / 100,
      ...(formatKeyOf(line) && sizeKeyOf(line) ? { sku: sku.slice(0, 64) } : {}),
    };
  });
}

/** An order's shippingAddress -> the service's recipient shape. */
export function recipientFor(name, address) {
  const a = address || {};
  return {
    name: name || a.name || '',
    addressLine1: a.line1 || '',
    addressLine2: a.line2 || '',
    houseNumber: '',
    city: a.city || '',
    postalCode: a.postalCode || '',
    countryCode: String(a.country || '').toUpperCase(),
    email: '',
    phone: '',
  };
}

/* ------------------------------------------------------------------ returns */

const BULKY = /hoodie|sweat|jacket|fleece|jogger|trainer|high[\s-]?top|sneaker|backpack|blanket/i;
const UNDERWEAR = /boxer|brief|underwear/i;

export const isBulkyGarment = (line) => BULKY.test(titleOf(line));
export const isUnderwear = (line) => UNDERWEAR.test(titleOf(line));

/**
 * The band for what a customer is sending back, or null for "Alan chooses".
 * Picked lines carry fulfilment, formatKey, sizeKey, title and quantity.
 *   posters only           one tube at the largest poster's band (a lone 12x8: P1)
 *   one canvas             its band
 *   one merchandise item   X1, or X2 if bulky
 *   anything else          null
 */
export function returnBandFor(picked) {
  const lines = (picked || []).filter((l) => Number(l?.quantity) > 0);
  if (!lines.length) return null;
  const qty = lines.reduce((n, l) => n + Math.floor(Number(l.quantity)), 0);
  if (lines.every(isWallArtLine)) {
    const bands = lines.map(bandOfLine);
    if (bands.some((b) => !b)) return null;
    if (lines.every((l) => formatKeyOf(l) === 'poster')) {
      const largest = bands.reduce((a, b) => (POSTER_RANK[b] > POSTER_RANK[a] ? b : a));
      return largest === 'P1' && qty > 1 ? null : largest;
    }
    return qty === 1 ? bands[0] : null;
  }
  if (lines.every(isClothingLine) && qty === 1) return isBulkyGarment(lines[0]) ? CLOTHING_BANDS.bulky : CLOTHING_BANDS.mailer;
  return null;
}

/* ------------------------------------------------------------------ carriers */

const CARRIERS = [
  [/^royal[_\s-]?mail/i, 'royalmail', 'Royal Mail'],
  [/^(hermes|evri)/i, 'evri', 'Evri'],
  [/^inpost/i, 'inpost', 'InPost'],
  [/^dpd/i, 'dpd', 'DPD'],
  [/^ups/i, 'ups', 'UPS'],
];

/** The wall-art carrier list on the order (hand dispatch) and in the emails. */
export const CARRIER_OPTIONS = [
  { title: 'Royal Mail', value: 'royalmail' },
  { title: 'Evri', value: 'evri' },
  { title: 'InPost', value: 'inpost' },
  { title: 'DPD', value: 'dpd' },
  { title: 'UPS', value: 'ups' },
  { title: 'Other', value: 'other' },
];

/** A Sendcloud carrier code -> { carrier, carrierOther } for the order. */
export function mapCarrier(code) {
  const s = String(code || '');
  for (const [re, value] of CARRIERS) if (re.test(s)) return { carrier: value, carrierOther: null };
  return { carrier: 'other', carrierOther: s ? s.replace(/[_:].*$/, '').replace(/^\w/, (c) => c.toUpperCase()) : 'Courier' };
}

/** A display name for a carrier value or Sendcloud code. */
export function carrierName(code, other) {
  const s = String(code || '');
  for (const [re, value, name] of CARRIERS) if (re.test(s) || s === value) return name;
  if (/^sendcloud/i.test(s)) return 'Sendcloud (test)';
  if (s === 'other') return other || 'Courier';
  return s || other || 'Courier';
}

/** A public tracking page for a hand-entered number, or null. */
export function trackingUrlFor(carrier, trackingNumber) {
  const n = String(trackingNumber || '').trim();
  if (!carrier || !n) return null;
  const num = encodeURIComponent(n);
  switch (String(carrier).toLowerCase().replace(/[\s_-]+/g, '')) {
    case 'royalmail': return `https://www.royalmail.com/track-your-item?trackNumber=${num}`;
    case 'evri': return `https://www.evri.com/track/parcel/${num}`;
    case 'dpd': return `https://track.dpd.co.uk/parcels/${num}`;
    case 'ups': return `https://www.ups.com/track?tracknum=${num}&loc=en_GB`;
    default: return null;
  }
}
