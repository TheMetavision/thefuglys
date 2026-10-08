// Tests for the server-side pricing in netlify/functions/create-checkout.cjs
// (ported from Wyrmfuel's fix/server-side-pricing).
//
// buildPodLineItems() is pure. The handler tests stub Stripe and the Sanity
// fetch, so nothing leaves the machine.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';

// Capture what the handler would send to Stripe.
let sessionParams = null;
require.cache[require.resolve('stripe')] = {
  exports: () => ({ checkout: { sessions: { create: async (p) => { sessionParams = p; return { url: 'https://stripe.test/s' }; } } } }),
};
const checkout = require('../netlify/functions/create-checkout.cjs');
const { buildPodLineItems, handler } = checkout;

// Shaped like the checkout's Sanity query result (prices as in Sanity, Oct 2026)
const PRODUCTS = [
  {
    _id: 'product-axel-run-fast', slug: 'axel-run-fast', name: 'Axel - Run Fast', active: true,
    variants: [
      { label: 'T-Shirt', productType: 'tshirt', basePrice: 25,
        sizePrices: [{ size: 'M', price: 25 }, { size: '2XL', price: 27 }],
        printfulVariants: [
          { size: 'M', colour: 'Black', syncVariantId: '101' },
          { size: '2XL', colour: 'Black', syncVariantId: '102' },
        ] },
      { label: 'Hoodie', productType: 'hoodie', basePrice: 49.5, sizePrices: [{ size: 'M', price: 49.5 }],
        printfulVariants: [{ size: 'M', colour: 'Black', syncVariantId: '201' }] },
    ],
  },
  {
    _id: 'product-badge-set-1', slug: 'badge-set-1', name: 'Badge Set 1', active: true,
    variants: [{ label: 'Badge', productType: 'badge', basePrice: 8, sizePrices: [],
      printfulVariants: [{ size: 'One Size', colour: null, syncVariantId: '301' }] }],
  },
];

// Cart ids are product-{slug}-{type}-{colour}-{size} (the PDP), as the drawer posts them.
const tee = (size, price, extra = {}) => ({
  id: `product-axel-run-fast-tshirt-Black-${size}`, title: 'Axel - Run Fast T-Shirt',
  productType: 'tshirt', colour: 'Black', size, price, quantity: 1, ...extra,
});
const badge = (price, extra = {}) => ({
  id: 'product-badge-set-1-badge--One Size', title: 'Badge Set 1', productType: 'badge',
  colour: '', size: 'One Size', price, quantity: 1, ...extra,
});
const art = (format, size, price, extra = {}) => ({
  id: `wallart-axel-run-fast-${format}-${size}`, title: 'Axel - Run Fast',
  productType: 'wallart', format, size, price, quantity: 1, ...extra,
});

/* ── buildPodLineItems ─────────────────────────────────────────────────── */

test('correct cart: charges the Sanity price', () => {
  const r = buildPodLineItems(PRODUCTS, [tee('M', 25)]);
  assert.equal(r.line_items[0].price_data.unit_amount, 2500);
  assert.equal(r.line_items[0].price_data.product_data.metadata.printful_variant_id, '101');
  assert.equal(r.cartTotalPence, 2500);
  assert.deepEqual(r.corrections, []);
});

test('uses the size price, not the base price', () => {
  assert.equal(buildPodLineItems(PRODUCTS, [tee('2XL', 27)]).line_items[0].price_data.unit_amount, 2700);
});

test('tampered price: charges Sanity and records the correction', () => {
  const r = buildPodLineItems(PRODUCTS, [tee('M', 0.01), badge(1)]);
  assert.deepEqual(r.line_items.map((l) => l.price_data.unit_amount), [2500, 800]);
  assert.equal(r.corrections.length, 2);
  assert.deepEqual(r.corrections[0], { item: 'Axel - Run Fast T-Shirt — Black M', clientPence: 1, unitPence: 2500 });
});

test('missing or non-numeric cart price still charges the Sanity price', () => {
  const r = buildPodLineItems(PRODUCTS, [tee('M', undefined), tee('2XL', 'free')]);
  assert.deepEqual(r.line_items.map((l) => l.price_data.unit_amount), [2500, 2700]);
});

test('productType picks the garment: hoodie M is the hoodie price and sync id', () => {
  const r = buildPodLineItems(PRODUCTS, [{ ...tee('M', 49.5), productType: 'hoodie', id: 'product-axel-run-fast-hoodie-Black-M' }]);
  assert.equal(r.line_items[0].price_data.unit_amount, 4950);
  assert.equal(r.line_items[0].price_data.product_data.metadata.printful_variant_id, '201');
});

test('single-size product falls back to basePrice', () => {
  const r = buildPodLineItems(PRODUCTS, [badge(8, { quantity: 3 })]);
  assert.equal(r.line_items[0].price_data.unit_amount, 800);
  assert.equal(r.cartTotalPence, 2400);
});

test('rejects quantities that are not whole numbers from 1 to 99', () => {
  for (const quantity of [0, -1, 1.5, 100, 'lots', 1e9, NaN, '', '-2', '2.5', '1e1', true, [3], { n: 2 }]) {
    const r = buildPodLineItems(PRODUCTS, [tee('M', 25, { quantity })]);
    assert.equal(r.invalid.length, 1, `quantity ${quantity}`);
    assert.equal(r.line_items.length, 0);
  }
});

test('accepts whole-number quantities sent as numbers or digit strings', () => {
  for (const quantity of [2, '2', ' 2 ']) {
    const r = buildPodLineItems(PRODUCTS, [tee('M', 25, { quantity })]);
    assert.equal(r.invalid.length, 0, `quantity ${JSON.stringify(quantity)}`);
    assert.equal(r.line_items[0].quantity, 2);
    assert.equal(typeof r.line_items[0].quantity, 'number');
  }
});

test('unknown product, unknown size or missing Sanity price is unresolved', () => {
  const noPrice = structuredClone(PRODUCTS);
  noPrice[0].variants[0].basePrice = null;
  noPrice[0].variants[0].sizePrices = [];
  assert.equal(buildPodLineItems(PRODUCTS, [{ ...tee('M', 25), id: 'product-nope-tshirt-Black-M' }]).unresolved.length, 1);
  assert.equal(buildPodLineItems(PRODUCTS, [tee('XS', 25)]).unresolved.length, 1);
  assert.equal(buildPodLineItems(noPrice, [tee('M', 25)]).unresolved.length, 1);
});

test('inactive product is rejected; active items still resolve', () => {
  for (const active of [false, undefined, null]) {
    const retired = structuredClone(PRODUCTS);
    retired[0].active = active;
    const r = buildPodLineItems(retired, [tee('M', 25), badge(8)]);
    assert.deepEqual(r.inactive, ['Axel - Run Fast T-Shirt — Black M'], `active: ${active}`);
    assert.equal(r.line_items.length, 1);
  }
});

/* ── handler (Stripe and Sanity stubbed) ───────────────────────────────── */

async function post(items, products = PRODUCTS, extra = {}) {
  sessionParams = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ result: products }) });
  try {
    const res = await handler({ httpMethod: 'POST', body: JSON.stringify({ items, ...extra }) });
    return { status: res.statusCode, body: JSON.parse(res.body || '{}') };
  } finally {
    globalThis.fetch = realFetch;
  }
}

test('handler: tampered POD price reaches Stripe at the Sanity price', async () => {
  const r = await post([tee('M', 1)]);
  assert.equal(r.status, 200);
  assert.equal(sessionParams.line_items[0].price_data.unit_amount, 2500);
});

test('handler: wall art is still priced from the artwork matrix', async () => {
  const r = await post([art('canvas-gallery', 'large', 0.5)]);
  assert.equal(r.status, 200);
  assert.equal(sessionParams.line_items[0].price_data.unit_amount, 4699);
  assert.equal(sessionParams.line_items[0].price_data.product_data.metadata.fulfilment, 'inhouse');
});

test('handler: free UK shipping only when server prices reach £75', async () => {
  // Cart claims £80 for a £25 tee: no free shipping.
  await post([tee('M', 80)]);
  assert.equal(sessionParams.shipping_options[0].shipping_rate_data.fixed_amount.amount, 695);
  // Mixed cart at real prices: £49.50 hoodie + £46.99 canvas = £96.49 → free.
  await post([{ ...tee('M', 1), id: 'product-axel-run-fast-hoodie-Black-M', productType: 'hoodie' }, art('canvas-gallery', 'large', 1)]);
  assert.equal(sessionParams.shipping_options[0].shipping_rate_data.fixed_amount.amount, 0);
});

test('handler: wall-art quantities outside 1-99 are refused; valid ones keep the matrix price', async () => {
  // (NaN is not listed here: JSON sends it as null, which means "missing" = 1)
  for (const quantity of [0, -1, 1.5, 100, 'lots', 1e9, '', '-2', '2.5', '1e1', true, [3], { n: 2 }]) {
    const r = await post([art('poster', 'small', 9.99, { quantity })]);
    assert.equal(r.status, 422, `quantity ${quantity}`);
    assert.equal(sessionParams, null);
  }
  const ok = await post([art('poster', 'small', 0.01, { quantity: 99 })]);
  assert.equal(ok.status, 200);
  assert.equal(sessionParams.line_items[0].price_data.unit_amount, 999);
  assert.equal(sessionParams.line_items[0].quantity, 99);
  // A missing quantity still means one.
  await post([art('poster', 'small', 9.99, { quantity: undefined })]);
  assert.equal(sessionParams.line_items[0].quantity, 1);
});

test('handler: inactive, unknown and bad-quantity lines are refused with 422', async () => {
  const retired = structuredClone(PRODUCTS);
  retired[1].active = false;
  assert.equal((await post([badge(8)], retired)).status, 422);
  assert.equal((await post([{ ...tee('M', 25), id: 'product-nope-tshirt-Black-M' }])).status, 422);
  assert.equal((await post([tee('M', 25, { quantity: 500 })])).status, 422);
  assert.equal(sessionParams, null); // no Stripe session was created
});

/* ── GA4: ids in session metadata, item details on each line ───────────── */

test('handler: stores valid GA ids only, and a session id only with a client id', async () => {
  const meta = async (ga) => { await post([tee('M', 25)], PRODUCTS, ga === undefined ? {} : { ga }); return sessionParams.metadata; };
  assert.deepEqual(await meta({ clientId: '123.456', sessionId: '1700000000' }),
    { source: 'thefuglys-web', brand: 'thefuglys', ga_client_id: '123.456', ga_session_id: '1700000000' });
  assert.deepEqual(await meta({ clientId: '123.456', sessionId: 'abc' }),
    { source: 'thefuglys-web', brand: 'thefuglys', ga_client_id: '123.456' });
  assert.deepEqual(await meta({ clientId: 'GA1.2.3', sessionId: '1700000000' }), { source: 'thefuglys-web', brand: 'thefuglys' });
  assert.deepEqual(await meta(undefined), { source: 'thefuglys-web', brand: 'thefuglys' });
});

test('handler: each line carries slug, type, colour, size and wall-art format', async () => {
  await post([tee('M', 25), badge(8), art('canvas-gallery', 'large', 46.99)]);
  const m = sessionParams.line_items.map((l) => l.price_data.product_data.metadata);
  assert.deepEqual(
    m.map(({ item_slug, item_name, item_type, item_colour, item_size, item_format }) => ({ item_slug, item_name, item_type, item_colour, item_size, item_format })),
    [
      { item_slug: 'axel-run-fast', item_name: 'Axel - Run Fast', item_type: 'tshirt', item_colour: 'Black', item_size: 'M', item_format: undefined },
      { item_slug: 'badge-set-1', item_name: 'Badge Set 1', item_type: 'badge', item_colour: '', item_size: 'One Size', item_format: undefined },
      { item_slug: 'axel-run-fast', item_name: 'Axel - Run Fast', item_type: 'wallart', item_colour: undefined, item_size: 'large', item_format: 'canvas-gallery' },
    ],
  );
});
