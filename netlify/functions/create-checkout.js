/**
 * netlify/functions/create-checkout.js  (The Fuglys)
 *
 * Ported from the Cats On Crack / Wyrmfuel function. Matching/pricing logic is
 * brand-agnostic; only the marked CONFIG / SHIPPING / metadata values change.
 *
 * Flow: resolve every cart item to its exact Printful sync_variant_id (by id
 * prefix product-{slug}- then productType+size+colour against the
 * printfulVariants matrix), reject the whole checkout (422) if anything is
 * unresolvable, then build Stripe line items with ad-hoc price_data (NO Stripe
 * Price objects) and stash printful_variant_id on each line item's product
 * metadata for the webhook to read.
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
    _id, "slug": slug.current, name,
    variants[]{ label, productType, printfulVariantId, printfulVariants[]{ size, colour, syncVariantId } }
  }`;
  const url = `https://${SANITY_PROJECT_ID}.apicdn.sanity.io/v${SANITY_API_VER}/data/query/${SANITY_DATASET}?query=${encodeURIComponent(groq)}`;
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

function findSyncVariantId(product, item) {
  const wantType = norm(item.productType), wantSize = norm(item.size), wantColour = norm(item.colour);
  const narrowed = (product.variants || []).filter((v) =>
    !wantType ? true : norm(v.productType) === wantType || norm(v.label) === wantType
  );
  const searchSet = narrowed.length ? narrowed : (product.variants || []);
  for (const v of searchSet) {
    const matrix = v.printfulVariants || [];
    let hit = matrix.find((pv) => norm(pv.size) === wantSize && norm(pv.colour) === wantColour);
    if (!hit && !wantColour) hit = matrix.find((pv) => norm(pv.size) === wantSize && !norm(pv.colour));
    if (!hit && matrix.length === 1) hit = matrix[0];
    if (hit && hit.syncVariantId) return String(hit.syncVariantId);
  }
  return null;
}

function resolveSyncVariantId(products, item) {
  const product = findProduct(products, item);
  return product ? findSyncVariantId(product, item) : null;
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

    // ── POD: resolve each line to its exact Printful sync_variant_id ─────────
    let resolvedPod = [];
    if (podItems.length > 0) {
      let sanityProducts;
      try {
        sanityProducts = await fetchSanityVariantData();
      } catch (err) {
        console.error('Sanity lookup failed during checkout:', err.message || err);
        return { statusCode: 503, headers, body: JSON.stringify({ error: 'Could not verify product availability. Please try again in a moment.' }) };
      }

      const unresolved = [];
      resolvedPod = podItems.map((item) => {
        const syncVariantId = resolveSyncVariantId(sanityProducts, item);
        if (!syncVariantId) unresolved.push(`${item.title || item.id || 'item'} — ${item.colour || ''} ${item.size || ''}`.trim());
        return { item, syncVariantId };
      });

      if (unresolved.length > 0) {
        console.error('Checkout blocked — unresolved Printful variants:', unresolved);
        return { statusCode: 422, headers, body: JSON.stringify({
          error: 'Some items in your cart are temporarily unavailable. Please remove and re-add them, or contact us.',
          items: unresolved,
        }) };
      }
    }

    // ── WALL ART: price server-side from the matrix; never trust client price ─
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
    const podLineItems = resolvedPod.map(({ item, syncVariantId }) => {
      const colourLabel = item.colour ? ` — ${item.colour}` : '';
      return {
        price_data: {
          currency: 'gbp',
          unit_amount: Math.round(item.price * 100),
          product_data: {
            name: `${item.title}${colourLabel} (${item.size})`,
            metadata: {
              printful_variant_id: syncVariantId,
              fuglys_size: String(item.size || ''),
              fuglys_colour: String(item.colour || ''),
            },
          },
        },
        quantity: item.quantity || 1,
      };
    });

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
      quantity: item.quantity || 1,
    }));

    const line_items = [...podLineItems, ...artLineItems];

    // Cart total for the free-shipping threshold: POD at client price (existing
    // behaviour), wall art at the authoritative server price.
    const cartTotalPence =
      podItems.reduce((sum, item) => sum + Math.round(item.price * 100) * (item.quantity || 1), 0) +
      resolvedArt.reduce((sum, { item, pricePence }) => sum + pricePence * (item.quantity || 1), 0);

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
