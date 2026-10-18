// Delivery is tied to the destination (src/lib/shipping-regions.mjs and
// netlify/functions/create-checkout.cjs): the basket's country decides the one
// rate offered and the one country Stripe accepts; unknown or missing
// countries and lines Printful won't ship there are refused before Stripe.
//
// Stripe and the Sanity fetch are stubbed, so nothing leaves the machine.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  SHIPPING_REGIONS, ALLOWED_COUNTRIES, regionFor, deliveryPence, shippingOptionFor, unshippableLines, guessCountry,
} from '../src/lib/shipping-regions.mjs';

const require = createRequire(import.meta.url);
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
let sessionParams = null;
require.cache[require.resolve('stripe')] = {
  exports: () => ({ checkout: { sessions: { create: async (p) => { sessionParams = p; return { url: 'https://stripe.test/s' }; } } } }),
};
const SHIP_TO = require('../src/data/ship-to.json');
const { handler } = require('../netlify/functions/create-checkout.cjs');

const PRODUCTS = [{
  _id: 'product-daisy', slug: 'daisy', name: 'Daisy', active: true,
  variants: [
    { label: 'T-Shirt', productType: 'tshirt', basePrice: 25, sizePrices: [{ size: 'M', price: 25 }],
      printfulVariants: [{ size: 'M', colour: 'Black', syncVariantId: '101' }] },
    { label: 'Hoodie', productType: 'hoodie', basePrice: 49.5, sizePrices: [{ size: 'M', price: 49.5 }],
      printfulVariants: [{ size: 'M', colour: 'Black', syncVariantId: '201' }] },
  ],
}];
const tee = (extra = {}) => ({ id: 'product-daisy-tshirt-Black-M', title: 'Daisy T-Shirt', productType: 'tshirt',
  colour: 'Black', size: 'M', price: 25, quantity: 1, ...extra });
const hoodie = () => tee({ id: 'product-daisy-hoodie-Black-M', productType: 'hoodie', price: 49.5 });

async function post(body) {
  sessionParams = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: PRODUCTS }) });
  try {
    const res = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
    return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
  } finally {
    globalThis.fetch = realFetch;
  }
}
const rateOf = () => sessionParams.shipping_options.map((o) => [o.shipping_rate_data.display_name, o.shipping_rate_data.fixed_amount.amount]);

/* ── The region table ──────────────────────────────────────────────────── */

// The checkout's list before delivery was tied to the destination (Oct 2026).
const OLD_ALLOWED = [
  'GB', 'US', 'CA',
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
  'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
  'SI', 'ES', 'SE', 'AL', 'BA', 'GE', 'GI', 'XK', 'MK', 'MD', 'MC', 'ME',
  'RS', 'SM', 'UA', 'VA', 'AD', 'AZ', 'KZ', 'IS', 'LI', 'NO', 'CH',
  'AU', 'NZ', 'JP', 'BR',
  'MX', 'SG', 'KR', 'IN', 'ZA', 'AE', 'SA', 'TH', 'MY', 'PH', 'ID',
  'AR', 'CL', 'CO', 'PE', 'HK', 'TW', 'IL', 'TR', 'NG', 'KE', 'GH',
];

test('regions: the same 76 countries as before, each in exactly one region', () => {
  assert.deepEqual([...ALLOWED_COUNTRIES].sort(), [...OLD_ALLOWED].sort());
  assert.equal(new Set(ALLOWED_COUNTRIES).size, ALLOWED_COUNTRIES.length);
  assert.deepEqual(SHIPPING_REGIONS.map((r) => [r.name, r.pence]), [
    ['UK Standard', 695], ['Europe', 995], ['USA / Canada', 1095], ['Australia / NZ / Japan / Brazil', 1195], ['Rest of World', 1495],
  ]);
});

test('regions: lookups, the free-UK threshold and unknown countries', () => {
  assert.equal(regionFor('gb').id, 'uk');
  assert.equal(regionFor(' de ').id, 'europe');
  assert.equal(regionFor('ZA').id, 'world');
  assert.equal(regionFor('FR').name, 'Europe');
  assert.equal(regionFor('KP'), null);
  assert.equal(regionFor(''), null);
  assert.equal(deliveryPence('GB', 7499), 695);
  assert.equal(deliveryPence('GB', 7500), 0);
  assert.equal(deliveryPence('US', 20000), 1095); // free delivery is UK only
  assert.equal(shippingOptionFor('XX', 100), null);
});

test('guessCountry: from browser language tags, only where we deliver', () => {
  assert.equal(guessCountry(['en-GB', 'en']), 'GB');
  assert.equal(guessCountry(['en', 'de-DE']), 'DE');
  assert.equal(guessCountry(['en-001', 'fr']), null);
  assert.equal(guessCountry(['ko-KP']), null);
  assert.equal(guessCountry(undefined), null);
});

test('unshippableLines: by productType and country', () => {
  const shipTo = { blocked: { tumbler: ['ZA', 'IN'] } };
  const lines = [tee(), tee({ productType: 'tumbler', title: 'Tumbler' })];
  assert.deepEqual(unshippableLines(lines, 'za', shipTo).map((l) => l.title), ['Tumbler']);
  assert.deepEqual(unshippableLines(lines, 'GB', shipTo), []);
  assert.deepEqual(unshippableLines(lines, 'ZA', { blocked: {} }), []);
});

/* ── The checkout ──────────────────────────────────────────────────────── */

test('checkout: only the chosen country, and only its region rate', async () => {
  for (const [country, name, pence] of [['GB', 'UK Standard', 695], ['DE', 'Europe', 995], ['US', 'USA / Canada', 1095],
    ['JP', 'Australia / NZ / Japan / Brazil', 1195], ['ZA', 'Rest of World', 1495]]) {
    const r = await post({ items: [tee()], country });
    assert.equal(r.status, 200, country);
    assert.deepEqual(sessionParams.shipping_address_collection.allowed_countries, [country]);
    assert.deepEqual(rateOf(), [[name, pence]], country);
    assert.equal(sessionParams.metadata.delivery_country, country);
  }
});

test('checkout: free UK delivery from £75 at server prices; never free abroad', async () => {
  await post({ items: [hoodie(), tee({ quantity: 2 })], country: 'GB' }); // £99.50
  assert.deepEqual(rateOf(), [['UK Standard (FREE)', 0]]);
  await post({ items: [hoodie(), tee({ quantity: 2 })], country: 'IE' });
  assert.deepEqual(rateOf(), [['Europe', 995]]);
  await post({ items: [tee({ price: 80 })], country: 'GB' }); // a claimed £80 is still a £25 tee
  assert.deepEqual(rateOf(), [['UK Standard', 695]]);
});

test('checkout: lower-case and padded country codes are accepted', async () => {
  assert.equal((await post({ items: [tee()], country: ' gb ' })).status, 200);
  assert.deepEqual(sessionParams.shipping_address_collection.allowed_countries, ['GB']);
});

test('checkout: no country, or one we do not deliver to, is refused before Stripe', async () => {
  for (const country of [undefined, '', 'KP', 'XX', 'GBR', 42]) {
    const r = await post({ items: [tee()], country });
    assert.equal(r.status, 400, String(country));
    assert.equal(sessionParams, null);
  }
});

test('checkout: old and new catalogue both check out (can glass and badge until they go; tumbler and mug after)', async () => {
  const OLD_AND_NEW = [{
    _id: 'product-daisy', slug: 'daisy', name: 'Daisy', active: true,
    variants: [
      { label: '16oz Can Glass', productType: 'glass', basePrice: 11.5, sizePrices: [{ size: '16 oz', price: 11.5 }],
        printfulVariants: [{ size: '16 oz', colour: '', syncVariantId: '301' }] },
      { label: '20oz Tumbler', productType: 'tumbler', basePrice: 32.95, sizePrices: [{ size: '20 oz', price: 32.95 }],
        printfulVariants: [{ size: '20 oz', colour: 'White', syncVariantId: '401' }, { size: '20 oz', colour: 'Black', syncVariantId: '402' }] },
      { label: '11oz Mug', productType: 'mug', basePrice: 12.95, sizePrices: [{ size: '11 oz', price: 12.95 }],
        printfulVariants: [{ size: '11 oz', colour: '', syncVariantId: '501' }] },
    ],
  }, {
    _id: 'product-badge-set-1', slug: 'badge-set-1', name: 'Badge Set 1', active: true,
    variants: [{ label: 'Pin Badge', productType: 'pin', basePrice: 9.95, sizePrices: [{ size: '2.25″', price: 9.95 }],
      printfulVariants: [{ size: '2.25″', colour: 'White', syncVariantId: '601' }] }],
  }];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: OLD_AND_NEW }) });
  try {
    const line = (id, productType, colour, size, price) => ({ id, title: id, productType, colour, size, price, quantity: 1 });
    sessionParams = null;
    const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ country: 'DE', items: [
      line('product-daisy-glass--16 oz', 'glass', '', '16 oz', 11.5),
      line('product-daisy-tumbler-Black-20 oz', 'tumbler', 'Black', '20 oz', 32.95),
      line('product-daisy-mug--11 oz', 'mug', '', '11 oz', 12.95),
      line('product-badge-set-1-pin-White-2.25″', 'pin', 'White', '2.25″', 9.95),
    ] }) });
    assert.equal(res.statusCode, 200, res.body);
    assert.deepEqual(sessionParams.line_items.map((l) => [l.price_data.unit_amount, l.price_data.product_data.metadata.printful_variant_id]),
      [[1150, '301'], [3295, '402'], [1295, '501'], [995, '601']]);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('checkout: a line Printful will not ship to that country is refused, and named', async () => {
  const realBlocked = SHIP_TO.blocked;
  SHIP_TO.blocked = { hoodie: ['ZA'] };
  try {
    const r = await post({ items: [tee(), hoodie()], country: 'ZA' });
    assert.equal(r.status, 422);
    assert.deepEqual(r.body.items, ['Daisy T-Shirt (M)']);
    assert.equal(sessionParams, null);
    assert.equal((await post({ items: [tee(), hoodie()], country: 'GB' })).status, 200);
  } finally {
    SHIP_TO.blocked = realBlocked;
  }
});
