/**
 * netlify/functions/create-checkout.cjs  (The Fuglys)
 *
 * Ported from the Cats On Crack / Wyrmfuel function. Matching/pricing logic is
 * brand-agnostic; only the marked CONFIG / SHIPPING / metadata values change.
 *
 * Flow: resolve every cart item to its exact Printful sync_variant_id (by id
 * prefix product-{slug}- then productType+size+colour against the
 * printfulVariants matrix) and PRICE it from that same Sanity variant (the
 * size's sizePrices entry, else basePrice). The browser's price is never
 * charged, only compared and logged. Products not marked active, quantities
 * outside 1-99 (on every line, wall art included), and anything unresolvable or
 * unpriced reject the whole checkout (422). buildPodLineItems() is pure and
 * tested (tests/create-checkout.test.mjs), as on Wyrmfuel. Wall art keeps its
 * price matrix (src/lib/artwork-pricing.cjs). Then build Stripe line items with
 * ad-hoc price_data (NO Stripe Price objects) and stash printful_variant_id on
 * each line item's product metadata for the webhook to read.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Shared wall-art pricing (single source of truth, also imported by Astro).
// Path assumes netlify/functions/ -> src/lib/. Adjust if your lib lives elsewhere.
const { artworkPrice, artworkVariantLabel, isWallArt } = require('../../src/lib/artwork-pricing.cjs');

/* ── CONFIG (The Fuglys) ─────────────────────────────────────────────── */
/* Brand key stamped on every Checkout Session. The stripe-webhook's BRAND
   GUARD only processes sessions where metadata.brand matches — this is what
   stops the other IP brands' webhooks (shared Stripe account) from firing on
   Fuglys orders and vice versa. Deploy together with stripe-webhook.js. */
const BRAND_KEY = 'thefuglys';

const SANITY_PROJECT_ID = process.env.SANITY_PROJECT_ID || 'ngx60q2x';
const SANITY_DATASET    = process.env.SANITY_DATASET || 'production';
const SANITY_API_VER    = '2024-01-01';

/* ── SHIPPING (Wyrmfuel model — unchanged across brands) ──────────────────
   UK £6.95, free over £75; EU £9.95; USA/Canada £10.95;
   Australia/NZ/Japan/Brazil £11.95; Rest of World £14.95.
   Keep FREE_THRESHOLD_PENCE in sync with FREE_SHIPPING_THRESHOLD in cart.ts. */
const FREE_THRESHOLD_PENCE = 7500; // £75.00
const UK_RATE_PENCE        = 695;  // £6.95

const ALLOWED_COUNTRIES = [
  'GB', 'US', 'CA',
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE', 'AL', 'BA', 'GE', 'GI', 'XK', 'MK', 'MD', 'MC', 'ME',
  'RS', 'SM', 'UA', 'VA', 'AD', 'AZ', 'KZ', 'IS', 'LI', 'NO', 'CH',
  'AU', 'NZ', 'JP', 'BR',
  'MX', 'SG', 'KR', 'IN', 'ZA', 'AE', 'SA', 'TH', 'MY', 'PH', 'ID',
  'AR', 'CL', 'CO', 'PE', 'HK', 'TW', 'IL', 'TR', 'NG', 'KE', 'GH',
];

function buildShippingOptions(cartTotalPence) {
  const ukOption = {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: cartTotalPence >= FREE_THRESHOLD_PENCE ? 0 : UK_RATE_PENCE, currency: 'gbp' },
      display_name: cartTotalPence >= FREE_THRESHOLD_PENCE ? 'UK Standard (FREE)' : 'UK Standard',
      delivery_estimate: { minimum: { unit: 'business_day', value: 5 }, maximum: { unit: 'business_day', value: 10 } },
    },
  };
  return [
    ukOption,
    { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: 995, currency: 'gbp' }, display_name: 'Europe',
      delivery_estimate: { minimum: { unit: 'business_day', value: 10 }, maximum: { unit: 'business_day', value: 20 } } } },
    { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: 1095, currency: 'gbp' }, display_name: 'USA / Canada',
      delivery_estimate: { minimum: { unit: 'business_day', value: 10 }, maximum: { unit: 'business_day', value: 20 } } } },
    { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: 1195, currency: 'gbp' }, display_name: 'Australia / NZ / Japan / Brazil',
      delivery_estimate: { minimum: { unit: 'business_day', value: 10 }, maximum: { unit: 'business_day', value: 25 } } } },
    { shipping_rate_data: { type: 'fixed_amount', fixed_amount: { amount: 1495, currency: 'gbp' }, display_name: 'Rest of World',
      delivery_estimate: { minimum: { unit: 'business_day', value: 14 }, maximum: { unit: 'business_day', value: 30 } } } },
  ];
}

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

async function fetchSanityVariantData() {
  const groq = `*[_type == "product"]{
    _id, "slug": slug.current, name, active,
    variants[]{
      label, productType, printfulVariantId, basePrice,
      sizePrices[]{ size, price },
      printfulVariants[]{ size, colour, syncVariantId }
    }
  }`;
  // The API host, not apicdn: prices and the active flag must be what is published now.
  const url = `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VER}/data/query/${SANITY_DATASET}?query=${encodeURIComponent(groq)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Sanity query failed (${res.status})`);
  return (await res.json()).result || [];
}

function findProduct(products, item) {
  const id = String(item.id || '');
  let best = null, bestLen = -1;
  for (const p of products) {
    if (!p.slug) continue;
    if (id.startsWith(`product-${p.slug}-`) || id === p._id) {
      if (p.slug.length > bestLen) { best = p; bestLen = p.slug.length; }
    }
  }
  return best;
}

/* Within a product, the printfulVariants entry for productType + size + colour.
   Returns the sync id and the Sanity variant it came from (which carries the price). */
function findVariantMatch(product, item) {
  const wantType = norm(item.productType);
  const wantSize = norm(item.size), wantColour = norm(item.colour);
  const narrowed = (product.variants || []).filter((v) =>
    !wantType ? true : norm(v.productType) === wantType || norm(v.label) === wantType
  );
  const searchSet = narrowed.length ? narrowed : (product.variants || []);
  for (const v of searchSet) {
    const matrix = v.printfulVariants || [];
    let hit = matrix.find((pv) => norm(pv.size) === wantSize && norm(pv.colour) === wantColour);
    if (!hit && !wantColour) hit = matrix.find((pv) => norm(pv.size) === wantSize && !norm(pv.colour));
    if (!hit && matrix.length === 1) hit = matrix[0];
    if (hit && hit.syncVariantId) return { syncVariantId: String(hit.syncVariantId), variant: v };
  }
  return null;
}

/* Cart quantity as a whole number from 1 to 99 (missing = 1), else null.
   Applies to both tracks: print-on-demand and wall art. */
function cartQuantity(item) {
  const quantity = item.quantity == null ? 1 : Number(item.quantity);
  return Number.isInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
}

/* The price for this size, in pence, from Sanity: the matching sizePrices
   entry, else basePrice. null if Sanity has no usable price. */
function sanityPricePence(variant, item) {
  const wantSize = norm(item.size);
  const sizePrice = (variant.sizePrices || []).find((sp) => norm(sp.size) === wantSize);
  const price = sizePrice ? sizePrice.price : variant.basePrice;
  return typeof price === 'number' && Number.isFinite(price) && price > 0 ? Math.round(price * 100) : null;
}

/**
 * Resolve every print-on-demand cart line against Sanity and build its Stripe
 * line item at the Sanity price (Wyrmfuel's buildLineItems). Pure (no network).
 * Returns { line_items, cartTotalPence, unresolved, invalid, inactive, corrections }.
 */
function buildPodLineItems(products, items) {
  const unresolved = [], invalid = [], inactive = [], corrections = [], line_items = [];
  let cartTotalPence = 0;

  for (const item of items) {
    const label = `${item.title || item.name || item.id || 'item'} — ${item.colour || ''} ${item.size || ''}`.trim();
    const quantity = cartQuantity(item);
    if (quantity == null) { invalid.push(label); continue; }

    const product = findProduct(products, item);
    if (product && product.active !== true) { inactive.push(label); continue; }
    const match = product ? findVariantMatch(product, item) : null;
    const unitPence = match ? sanityPricePence(match.variant, item) : null;
    if (!match || unitPence == null) { unresolved.push(label); continue; }

    const clientPence = Math.round(Number(item.price) * 100);
    if (clientPence !== unitPence) {
      corrections.push({ item: label, clientPence: Number.isFinite(clientPence) ? clientPence : null, unitPence });
    }

    const title = item.title || item.name || 'The Fuglys item';
    const colourLabel = item.colour ? ` — ${item.colour}` : '';
    line_items.push({
      price_data: {
        currency: 'gbp',
        unit_amount: unitPence, // SANITY price, in pence
        product_data: {
          name: `${title}${colourLabel} (${item.size})`,
          metadata: {
            printful_variant_id: match.syncVariantId,
            fuglys_size: String(item.size || ''),
            fuglys_colour: String(item.colour || ''),
          },
        },
      },
      quantity,
    });
    cartTotalPence += unitPence * quantity;
  }
  return { line_items, cartTotalPence, unresolved, invalid, inactive, corrections };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  if (!process.env.STRIPE_SECRET_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Stripe not configured' }) };

  try {
    const { items } = JSON.parse(event.body || '{}');
    if (!items || items.length === 0) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cart is empty' }) };

    const SITE_URL = process.env.SITE_URL || process.env.PUBLIC_SITE_URL || 'https://thefuglys.com';

    // Split the cart: POD garments (resolved to Printful) vs in-house WALL ART.
    const podItems = items.filter((it) => !isWallArt(it));
    const artItems = items.filter((it) => isWallArt(it));

    // ── POD: resolve each line to its Printful sync variant and Sanity price ─
    let pod = { line_items: [], cartTotalPence: 0, unresolved: [], invalid: [], inactive: [], corrections: [] };
    if (podItems.length > 0) {
      let sanityProducts;
      try {
        sanityProducts = await fetchSanityVariantData();
      } catch (err) {
        console.error('Sanity lookup failed during checkout:', err.message || err);
        return { statusCode: 503, headers, body: JSON.stringify({ error: 'Could not verify product availability. Please try again in a moment.' }) };
      }

      pod = buildPodLineItems(sanityProducts, podItems);

      if (pod.inactive.length > 0) {
        return { statusCode: 422, headers, body: JSON.stringify({
          error: 'Some items in your cart are no longer available. Please remove them to continue.',
          items: pod.inactive,
        }) };
      }
      if (pod.invalid.length > 0) {
        return { statusCode: 422, headers, body: JSON.stringify({
          error: 'Some quantities in your cart are not valid. Please update your cart.',
          items: pod.invalid,
        }) };
      }
      if (pod.unresolved.length > 0) {
        console.error('Checkout blocked — unresolved Printful variants or prices:', pod.unresolved);
        return { statusCode: 422, headers, body: JSON.stringify({
          error: 'Some items in your cart are temporarily unavailable. Please remove and re-add them, or contact us.',
          items: pod.unresolved,
        }) };
      }
      if (pod.corrections.length > 0) {
        console.warn('Checkout: cart prices differed from Sanity; charging Sanity prices:', pod.corrections);
      }
    }

    // ── WALL ART: price server-side from the matrix; never trust client price ─
    // Quantity bound first (1-99, as for POD); pricing below is unchanged.
    const badArtQty = artItems
      .filter((item) => cartQuantity(item) == null)
      .map((item) => `${item.title || item.name || item.id || 'wall art'} — ${item.format || '?'} / ${item.size || '?'}`);
    if (badArtQty.length > 0) {
      return { statusCode: 422, headers, body: JSON.stringify({
        error: 'Some quantities in your cart are not valid. Please update your cart.',
        items: badArtQty,
      }) };
    }

    const badArt = [];
    const resolvedArt = artItems.map((item) => {
      try {
        const pricePence = artworkPrice(item.format, item.size); // throws on a bad combo
        const label = artworkVariantLabel(item.format, item.size);
        // slug is deterministic: id === `wallart-${slug}-${format}-${size}`
        const suffix = `-${item.format}-${item.size}`;
        const rawId = String(item.id || '');
        const slug = rawId.startsWith('wallart-') && rawId.endsWith(suffix)
          ? rawId.slice('wallart-'.length, rawId.length - suffix.length)
          : '';
        return { item, pricePence, label, slug };
      } catch (e) {
        badArt.push(`${item.title || item.id || 'wall art'} — ${item.format || '?'} / ${item.size || '?'}`);
        return { item, pricePence: 0, label: '', slug: '' };
      }
    });

    if (badArt.length > 0) {
      console.error('Checkout blocked — invalid wall-art options:', badArt);
      return { statusCode: 422, headers, body: JSON.stringify({
        error: 'Some wall-art options in your cart are invalid. Please remove and re-add them.',
        items: badArt,
      }) };
    }

    // ── Build Stripe line items ──────────────────────────────────────────────
    const artLineItems = resolvedArt.map(({ item, pricePence, label, slug }) => ({
      price_data: {
        currency: 'gbp',
        unit_amount: pricePence, // SERVER price, in pence
        product_data: {
          name: `${item.title} — ${label}`,
          metadata: {
            fulfilment: 'inhouse',
            wallart_slug: slug,
            wallart_format: String(item.format || ''),
            wallart_size: String(item.size || ''),
          },
        },
      },
      quantity: cartQuantity(item),
    }));

    const line_items = [...pod.line_items, ...artLineItems];

    // Cart total for the free-shipping threshold: both tracks at server prices
    // (POD from Sanity, wall art from the matrix).
    const cartTotalPence =
      pod.cartTotalPence +
      resolvedArt.reduce((sum, { item, pricePence }) => sum + pricePence * cartQuantity(item), 0);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items,
      shipping_address_collection: { allowed_countries: ALLOWED_COUNTRIES },
      shipping_options: buildShippingOptions(cartTotalPence),
      success_url: `${SITE_URL}/order-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/merch`,
      metadata: { source: 'thefuglys-web', brand: BRAND_KEY },
    });

    return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error('Stripe checkout error:', err.message || err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Checkout failed' }) };
  }
};

// For tests: the pure resolver/pricer.
exports.buildPodLineItems = buildPodLineItems;
