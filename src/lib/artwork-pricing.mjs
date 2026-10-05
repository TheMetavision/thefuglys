// artwork-pricing.mjs
// -----------------------------------------------------------------------------
// Single source of truth for in-house WALL ART pricing, formats and sizes.
// Mirrored from Comic Strip Canvas (ready-made prints; no personalisation).
//
// An ES module so BOTH consumers load this one file:
//   - Astro / Vite (ESM):        import { artworkPrice } from '../lib/artwork-pricing.mjs'
//   - Netlify functions (CJS):   const { artworkPrice } = require('../../src/lib/artwork-pricing.mjs')
//     (esbuild bundles it into each function — netlify.toml [functions]
//      node_bundler = "esbuild"; Node 22.12+ also loads it with require().)
//
// Money is in GBP **pence** (integers) to match Stripe and avoid float drift.
//
// SHIPPING IS NOT DEFINED HERE.
// Wall art ships in-house but WORLDWIDE, using the brand's EXISTING cart-level
// shipping options (free over £75, else £6.95 UK; plus EU / USA / RoW rates),
// exactly like POD. See netlify/functions/create-checkout.cjs. No geo restriction.
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

const ARTWORK_SIZES = [
  { id: 'small',  label: 'Small',  inches: '12 x 8"'  },
  { id: 'medium', label: 'Medium', inches: '16 x 12"' },
  { id: 'large',  label: 'Large',  inches: '24 x 16"' },
];

// Prices in pence. [format][size]
const ARTWORK_PRICES = {
  'poster':          { small:  999, medium: 1299, large: 1699 },
  'canvas-standard': { small: 2699, medium: 3199, large: 4499 },
  'canvas-gallery':  { small: 2899, medium: 3399, large: 4699 },
};

const FORMAT_IDS = new Set(ARTWORK_FORMATS.map((f) => f.id));
const SIZE_IDS = new Set(ARTWORK_SIZES.map((s) => s.id));

/** Is this a wall-art cart line? (productType set by the PDP.) */
function isWallArt(item) {
  return (item && item.productType === 'wallart') || String(item && item.id || '').startsWith('wallart-');
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

/** Human label for a format+size, e.g. "Canvas — Gallery Frame · Large (24 x 16")". */
function artworkVariantLabel(format, size) {
  const f = ARTWORK_FORMATS.find((x) => x.id === format);
  const s = ARTWORK_SIZES.find((x) => x.id === size);
  if (!f || !s) return `${format} / ${size}`;
  return `${f.label} · ${s.label} (${s.inches})`;
}

/** £ string from pence, e.g. 4499 -> "£44.99". */
function formatGBP(pence) {
  return `£${(pence / 100).toFixed(2)}`;
}

/** Lowest price across all formats, for a "from £x.xx" badge. */
const ARTWORK_FROM_PRICE = Math.min(
  ...Object.values(ARTWORK_PRICES).flatMap((row) => Object.values(row))
);

export {
  ARTWORK_FORMATS,
  ARTWORK_SIZES,
  ARTWORK_PRICES,
  ARTWORK_FROM_PRICE,
  isWallArt,
  artworkPrice,
  artworkVariantLabel,
  formatGBP,
};
