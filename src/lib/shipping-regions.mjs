// src/lib/shipping-regions.mjs — delivery tied to the buyer's destination.
//
// Shared by the cart drawer (the country picker and the delivery line) and
// netlify/functions/create-checkout.cjs (the server, which is what counts).
// The buyer picks a country in the basket; the checkout then offers ONLY that
// country's region rate and Stripe accepts an address in that one country.
// The same file is in all four IP-brand sites; keep the copies identical.
//
// Money is in GBP pence, as everywhere else in the checkout.

export const FREE_UK_THRESHOLD_PENCE = 7500; // free UK delivery from £75 (cart.ts FREE_SHIPPING_THRESHOLD)

export const SHIPPING_REGIONS = [
  { id: 'uk', name: 'UK Standard', pence: 695, days: [5, 10], countries: ['GB'] },
  { id: 'europe', name: 'Europe', pence: 995, days: [10, 20], countries: [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
    'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
    'SI', 'ES', 'SE', 'AL', 'BA', 'GE', 'GI', 'XK', 'MK', 'MD', 'MC', 'ME',
    'RS', 'SM', 'UA', 'VA', 'AD', 'AZ', 'KZ', 'IS', 'LI', 'NO', 'CH',
  ] },
  { id: 'north-america', name: 'USA / Canada', pence: 1095, days: [10, 20], countries: ['US', 'CA'] },
  { id: 'anzjb', name: 'Australia / NZ / Japan / Brazil', pence: 1195, days: [10, 25], countries: ['AU', 'NZ', 'JP', 'BR'] },
  { id: 'world', name: 'Rest of World', pence: 1495, days: [14, 30], countries: [
    'MX', 'SG', 'KR', 'IN', 'ZA', 'AE', 'SA', 'TH', 'MY', 'PH', 'ID',
    'AR', 'CL', 'CO', 'PE', 'HK', 'TW', 'IL', 'TR', 'NG', 'KE', 'GH',
  ] },
];

/** Every country the checkout accepts. */
export const ALLOWED_COUNTRIES = SHIPPING_REGIONS.flatMap((r) => r.countries);

const norm = (c) => String(c == null ? '' : c).trim().toUpperCase();

/** The region for an ISO country code, or null if we don't deliver there. */
export function regionFor(country) {
  const cc = norm(country);
  return SHIPPING_REGIONS.find((r) => r.countries.includes(cc)) || null;
}

/** Delivery charge in pence for this country and goods total; null if we don't deliver there. */
export function deliveryPence(country, goodsPence) {
  const region = regionFor(country);
  if (!region) return null;
  return region.id === 'uk' && goodsPence >= FREE_UK_THRESHOLD_PENCE ? 0 : region.pence;
}

/** The one Stripe shipping option for this country (null if we don't deliver there). */
export function shippingOptionFor(country, goodsPence) {
  const region = regionFor(country);
  if (!region) return null;
  const pence = deliveryPence(country, goodsPence);
  return {
    shipping_rate_data: {
      type: 'fixed_amount',
      fixed_amount: { amount: pence, currency: 'gbp' },
      display_name: pence === 0 ? `${region.name} (FREE)` : region.name,
      delivery_estimate: {
        minimum: { unit: 'business_day', value: region.days[0] },
        maximum: { unit: 'business_day', value: region.days[1] },
      },
    },
  };
}

/**
 * Cart lines Printful won't ship to this country. `shipTo` is src/data/ship-to.json:
 * { blocked: { <productType>: [ISO2, ...] } }, generated from Printful's own answers
 * (printful-sync probe-ship-to.mjs). Wall art (made in-house) ships everywhere we do.
 */
export function unshippableLines(items, country, shipTo) {
  const cc = norm(country);
  const blocked = (shipTo && shipTo.blocked) || {};
  return (items || []).filter((it) => {
    const list = blocked[String(it && it.productType || '')];
    return Array.isArray(list) && list.includes(cc);
  });
}

/** Best guess at the shopper's country from the browser's language tags (e.g. en-GB -> GB); null if none we deliver to. */
export function guessCountry(languages) {
  for (const tag of languages || []) {
    const m = /-([A-Za-z]{2})\b/.exec(String(tag));
    if (m && regionFor(m[1])) return norm(m[1]);
  }
  return null;
}
