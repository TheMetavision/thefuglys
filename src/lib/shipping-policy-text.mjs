// src/lib/shipping-policy-text.mjs — the delivery figures the Shipping Policy page
// (Sanity legalPage.shipping-policy) must quote, generated from shipping-regions.mjs.
//
// The page is static Sanity text, so tests/shipping-policy.test.mjs reads the
// published page and fails if any figure here is missing from it, or if it quotes
// something the checkout doesn't offer (another price, Express, products we don't sell).
// When a rate, a time or the free-UK threshold changes in shipping-regions.mjs,
// paste the new lines from `policyLines()` into the page in Studio.
// The same file is in all four IP-brand sites; keep the copies identical.

import { SHIPPING_REGIONS, FREE_UK_THRESHOLD_PENCE } from './shipping-regions.mjs';

// Fixed names (not Intl), so a Node/ICU update can't change the expected text.
export const COUNTRY_NAMES = {
  GB: 'United Kingdom', AT: 'Austria', BE: 'Belgium', BG: 'Bulgaria', HR: 'Croatia', CY: 'Cyprus',
  CZ: 'Czechia', DK: 'Denmark', EE: 'Estonia', FI: 'Finland', FR: 'France', DE: 'Germany', GR: 'Greece',
  HU: 'Hungary', IE: 'Ireland', IT: 'Italy', LV: 'Latvia', LT: 'Lithuania', LU: 'Luxembourg', MT: 'Malta',
  NL: 'Netherlands', PL: 'Poland', PT: 'Portugal', RO: 'Romania', SK: 'Slovakia', SI: 'Slovenia',
  ES: 'Spain', SE: 'Sweden', AL: 'Albania', BA: 'Bosnia & Herzegovina', GE: 'Georgia', GI: 'Gibraltar',
  XK: 'Kosovo', MK: 'North Macedonia', MD: 'Moldova', MC: 'Monaco', ME: 'Montenegro', RS: 'Serbia',
  SM: 'San Marino', UA: 'Ukraine', VA: 'Vatican City', AD: 'Andorra', AZ: 'Azerbaijan', KZ: 'Kazakhstan',
  IS: 'Iceland', LI: 'Liechtenstein', NO: 'Norway', CH: 'Switzerland', US: 'United States', CA: 'Canada',
  AU: 'Australia', NZ: 'New Zealand', JP: 'Japan', BR: 'Brazil', MX: 'Mexico', SG: 'Singapore',
  KR: 'South Korea', IN: 'India', ZA: 'South Africa', AE: 'United Arab Emirates', SA: 'Saudi Arabia',
  TH: 'Thailand', MY: 'Malaysia', PH: 'Philippines', ID: 'Indonesia', AR: 'Argentina', CL: 'Chile',
  CO: 'Colombia', PE: 'Peru', HK: 'Hong Kong', TW: 'Taiwan', IL: 'Israel', TR: 'Türkiye', NG: 'Nigeria',
  KE: 'Kenya', GH: 'Ghana',
};

/** £6.95, £75 */
export const pounds = (pence) => `£${pence % 100 ? (pence / 100).toFixed(2) : pence / 100}`;

const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

/**
 * The exact sentences the page must carry: one per region (rate, time, countries)
 * and the free-UK-delivery sentence.
 */
export function policyLines() {
  const regions = SHIPPING_REGIONS.map((r) => {
    const days = `${r.days[0]}–${r.days[1]} business days`;
    if (r.id === 'uk') {
      return `${COUNTRY_NAMES.GB}: ${r.name} ${pounds(r.pence)}, free when your goods total is ${pounds(FREE_UK_THRESHOLD_PENCE)} or more. ${days}.`;
    }
    const names = r.countries.map((c) => COUNTRY_NAMES[c] || c).sort((a, b) => a.localeCompare(b, 'en-GB'));
    return `${r.name}: ${pounds(r.pence)}. ${days}. ${list(names)}.`;
  });
  const ukFree = `UK delivery is free when your goods total is ${pounds(FREE_UK_THRESHOLD_PENCE)} or more, before any discount code. Discount codes apply to the goods only, never to delivery.`;
  return { regions, ukFree };
}

/** Words the page must not use: services and products the checkout doesn't offer. */
export const FORBIDDEN = [/express/i, /embroider/i, /sweatshirt/i, /\bbags?\b/i, /calculated at checkout/i, /from time to time/i];

/**
 * Problems with the page's text blocks (one string per Portable Text block), [] if none:
 * a missing figure line, a forbidden word, or a £ amount the checkout doesn't charge.
 */
export function shippingPolicyProblems(blocks) {
  const { regions, ukFree } = policyLines();
  const problems = [];
  for (const line of [...regions, ukFree]) {
    if (!blocks.includes(line)) problems.push(`missing: ${line}`);
  }
  const allowed = new Set([...SHIPPING_REGIONS.map((r) => pounds(r.pence)), pounds(FREE_UK_THRESHOLD_PENCE)]);
  for (const b of blocks) {
    for (const re of FORBIDDEN) if (re.test(b)) problems.push(`forbidden ${re}: ${b}`);
    for (const m of b.match(/£\d+(?:\.\d\d)?/g) || []) if (!allowed.has(m)) problems.push(`unknown amount ${m}: ${b}`);
  }
  return problems;
}
