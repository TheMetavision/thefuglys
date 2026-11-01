// artwork-pricing.mjs
// -----------------------------------------------------------------------------
// Single source of truth for in-house WALL ART: formats, sizes and prices.
// Ported from Wyrmfuel's src/lib/artwork-pricing.js (same sizes and prices as
// Comic Strip Canvas). Ready-made prints; no personalisation.
//
// An ES module so BOTH consumers work:
//   - Astro / Vite (ESM):        import { artworkPrice } from '../lib/artwork-pricing.mjs'
//   - Netlify functions (CJS):   const { artworkPrice } = require('../../src/lib/artwork-pricing.mjs')
//     netlify.toml bundles those functions with esbuild, which inlines this
//     file, so the deployed function never needs the runtime's require(esm).
//
// Money is in GBP **pence** (integers) to match Stripe and avoid float drift.
//
// SIZES AND ORIENTATION
// Medium moved from 16x12 to 18x12 so all three sizes share the artwork's 3:2
// shape. The size ID (small | medium | large) is what travels through the cart,
// the Stripe metadata and the order, and it is deliberately not a dimension:
// prices are keyed by it and did not change. Orientation belongs to the
// artwork, not to this table. It is read from the master image's Sanity asset
// dimensions (src/lib/wallart.ts at build time, create-checkout at checkout).
// A landscape piece is 12x8 / 18x12 / 24x16, a portrait one 8x12 / 12x18 / 16x24.
// Anything without dimensions is treated as landscape, and that is logged.
//
// SHIPPING IS NOT DEFINED HERE.
// Wall art ships in-house but WORLDWIDE, using the brand's EXISTING cart-level
// shipping options, exactly like POD. See netlify/functions/create-checkout.
// (Wyrmfuel's canvas-UK-only rule and wall-art parcel rates were not ported.)
// -----------------------------------------------------------------------------

const ARTWORK_FORMATS = [
  {
    id: 'poster',
    label: 'Poster Print',
    blurb: '260gsm semi-gloss photo paper, rolled and shipped in a protective tube.',
  },
  {
    id: 'canvas-standard',
    label: 'Canvas — Standard Frame',
    blurb: '410gsm water-resistant canvas on a solid lightweight wooden frame. Ready to hang.',
  },
  {
    id: 'canvas-gallery',
    label: 'Canvas — Gallery Frame',
    blurb: '410gsm water-resistant canvas on a deeper gallery frame for a premium finish. Ready to hang.',
  },
];

// [long edge, short edge] in inches. Turned round for portrait pieces.
const ARTWORK_SIZES = [
  { id: 'small',  label: 'Small',  inches: [12, 8] },
  { id: 'medium', label: 'Medium', inches: [18, 12] },
  { id: 'large',  label: 'Large',  inches: [24, 16] },
];

// Prices in pence. [format][size]
const ARTWORK_PRICES = {
  'poster':          { small:  999, medium: 1299, large: 1699 },
  'canvas-standard': { small: 2699, medium: 3199, large: 4499 },
  'canvas-gallery':  { small: 2899, medium: 3399, large: 4699 },
};

const ORIENTATIONS = new Set(['landscape', 'portrait']);
const FORMAT_IDS = new Set(ARTWORK_FORMATS.map((f) => f.id));
const SIZE_IDS = new Set(ARTWORK_SIZES.map((s) => s.id));

/** Is this a wall-art cart line? (productType set by the PDP.) */
function isWallArt(item) {
  return (item && item.productType === 'wallart') || String((item && item.id) || '').startsWith('wallart-');
}

/**
 * Authoritative price lookup (pence). Throws on an unknown combo so the
 * checkout function fails closed rather than charging a wrong/zero amount.
 */
function artworkPrice(format, size) {
  if (!FORMAT_IDS.has(format)) throw new Error(`Unknown artwork format: ${format}`);
  if (!SIZE_IDS.has(size)) throw new Error(`Unknown artwork size: ${size}`);
  return ARTWORK_PRICES[format][size];
}

/**
 * 'landscape' or 'portrait' from an image's pixel width and height (a square
 * counts as landscape). Missing or bad dimensions fall back to landscape and
 * call onMissing so the caller can log which piece it was.
 */
function orientationFromDimensions(width, height, onMissing) {
  const w = Number(width);
  const h = Number(height);
  if (!(w > 0) || !(h > 0)) {
    if (typeof onMissing === 'function') onMissing();
    return 'landscape';
  }
  return w >= h ? 'landscape' : 'portrait';
}

/** A known orientation, else landscape (old carts and old Stripe sessions carry none). */
function normOrientation(orientation) {
  return ORIENTATIONS.has(orientation) ? orientation : 'landscape';
}

/** "18x12" for a landscape Medium, "12x18" for a portrait one; '' for an unknown size. */
function artworkDimensions(size, orientation = 'landscape') {
  const s = ARTWORK_SIZES.find((x) => x.id === size);
  if (!s) return '';
  const [long, short] = s.inches;
  return normOrientation(orientation) === 'landscape' ? `${long}x${short}` : `${short}x${long}`;
}

/** The customer-facing dimensions, e.g. `18 x 12"` (landscape) or `12 x 18"` (portrait). */
function artworkSizeInches(size, orientation = 'landscape') {
  const d = artworkDimensions(size, orientation);
  return d ? `${d.replace('x', ' x ')}"` : '';
}

/** Human label for a format+size, e.g. "Canvas — Gallery Frame · Large (16 x 24")". */
function artworkVariantLabel(format, size, orientation = 'landscape') {
  const f = ARTWORK_FORMATS.find((x) => x.id === format);
  const s = ARTWORK_SIZES.find((x) => x.id === size);
  if (!f || !s) return `${format} / ${size}`;
  return `${f.label} · ${s.label} (${artworkSizeInches(size, orientation)})`;
}

/** £ string from pence, e.g. 4499 -> "£44.99". */
function formatGBP(pence) {
  return `£${(pence / 100).toFixed(2)}`;
}

/** Lowest price across all formats, for a "from £x.xx" badge. */
const ARTWORK_FROM_PRICE = Math.min(
  ...Object.values(ARTWORK_PRICES).flatMap((row) => Object.values(row))
);

/** The cart line id: wallart-{slug}-{format}-{size}. */
function wallArtLineId(slug, format, size) {
  return `wallart-${slug}-${format}-${size}`;
}

/**
 * The slug inside a wall-art line id, or '' if the id doesn't end in this
 * line's own format and size (so a tampered id can't name another piece).
 */
function slugFromLineId(id, format, size) {
  const raw = String(id || '');
  const suffix = `-${format}-${size}`;
  if (!raw.startsWith('wallart-') || !raw.endsWith(suffix)) return '';
  return raw.slice('wallart-'.length, raw.length - suffix.length);
}

export {
  ARTWORK_FORMATS,
  ARTWORK_SIZES,
  ARTWORK_PRICES,
  ARTWORK_FROM_PRICE,
  isWallArt,
  artworkPrice,
  orientationFromDimensions,
  normOrientation,
  artworkDimensions,
  artworkSizeInches,
  artworkVariantLabel,
  formatGBP,
  wallArtLineId,
  slugFromLineId,
};
