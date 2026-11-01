// Wall-art orientation end to end: create-checkout reads it from the piece's
// master image dimensions in Sanity (never from the browser) and stamps the
// Stripe line name and metadata; stripe-webhook labels the order email from
// that metadata. Medium is 18x12 (was 16x12), 12x18 for a portrait piece.
//
// Stripe and fetch are stubbed, so nothing leaves the machine.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
console.warn = () => {}; console.log = () => {};

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

let sessionParams = null;
const stripePath = require.resolve('stripe');
const realStripe = require('stripe');
require.cache[stripePath] = {
  id: stripePath, filename: stripePath, loaded: true,
  exports: () => ({ checkout: { sessions: { create: async (p) => { sessionParams = p; return { url: 'https://stripe.test/s' }; } } } }),
};
const checkout = require('../netlify/functions/create-checkout.cjs');
require.cache[stripePath].exports = realStripe;
const { inhouseLineLabel } = require('../netlify/functions/stripe-webhook.cjs');

const SANITY = [
  { slug: 'tall-one', w: 1024, h: 1536 },
  { slug: 'wide-one', w: 1536, h: 1024 },
  { slug: 'no-dims' },
];
const line = (slug, format, size, extra = {}) => ({
  id: `wallart-${slug}-${format}-${size}`, title: slug, productType: 'wallart', format, size, price: 1, quantity: 1, ...extra,
});

async function post(items, fetchImpl) {
  sessionParams = null;
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url, opts) => { urls.push(String(url)); return fetchImpl(String(url), opts); };
  try {
    const res = await checkout.handler({ httpMethod: 'POST', body: JSON.stringify({ items, country: 'GB' }) });
    return { status: res.statusCode, urls };
  } finally {
    globalThis.fetch = realFetch;
  }
}
const sanityOk = async () => ({ ok: true, json: async () => ({ result: SANITY }) });
const lines = () => sessionParams.line_items.map((li) => li.price_data.product_data);

test('checkout labels portrait and landscape pieces from the Sanity image size, at unchanged prices', async () => {
  const { status, urls } = await post([
    line('tall-one', 'poster', 'medium'),
    line('wide-one', 'canvas-gallery', 'medium'),
    line('no-dims', 'canvas-standard', 'large'),
  ], sanityOk);
  assert.equal(status, 200);
  const [tall, wide, none] = lines();
  assert.match(tall.name, /Poster Print · Medium \(12 x 18"\)$/);
  assert.match(wide.name, /Canvas — Gallery Frame · Medium \(18 x 12"\)$/);
  assert.match(none.name, /Canvas — Standard Frame · Large \(24 x 16"\)$/);
  assert.deepEqual([tall, wide, none].map((p) => [p.metadata.wallart_size, p.metadata.wallart_orientation, p.metadata.wallart_dims]),
    [['medium', 'portrait', '12x18'], ['medium', 'landscape', '18x12'], ['large', 'landscape', '24x16']]);
  assert.deepEqual(sessionParams.line_items.map((li) => li.price_data.unit_amount), [1299, 3399, 4499]);
  assert.ok(urls.some((u) => decodeURIComponent(u).includes('"tall-one"')), 'asked Sanity for the pieces in the cart');
});

test('checkout ignores an orientation sent by the browser', async () => {
  await post([line('wide-one', 'poster', 'medium', { orientation: 'portrait' })], sanityOk);
  assert.equal(lines()[0].metadata.wallart_orientation, 'landscape');
});

test('a failed orientation lookup still checks out, labelled landscape', async () => {
  const { status } = await post([line('tall-one', 'poster', 'medium')], async () => ({ ok: false, status: 503, json: async () => ({}) }));
  assert.equal(status, 200);
  assert.match(lines()[0].name, /Medium \(18 x 12"\)$/);
  assert.equal(sessionParams.line_items[0].price_data.unit_amount, 1299);
});

test('wallArtOrientations logs pieces without image dimensions', () => {
  const warned = [];
  const o = checkout.wallArtOrientations(SANITY, ['tall-one', 'wide-one', 'no-dims', 'missing'], (s) => warned.push(s));
  assert.deepEqual(o, { 'tall-one': 'portrait', 'wide-one': 'landscape', 'no-dims': 'landscape', missing: 'landscape' });
  assert.equal(warned.length, 2);
});

test('the order email labels a line from the orientation checkout stamped', () => {
  const li = (metadata) => ({ description: 'x', price: { product: { metadata: { fulfilment: 'inhouse', ...metadata } } } });
  assert.equal(inhouseLineLabel(li({ wallart_format: 'poster', wallart_size: 'medium', wallart_orientation: 'portrait' })), 'Poster Print · Medium (12 x 18")');
  assert.equal(inhouseLineLabel(li({ wallart_format: 'poster', wallart_size: 'medium', wallart_orientation: 'landscape' })), 'Poster Print · Medium (18 x 12")');
  // A session from before orientation was stamped.
  assert.equal(inhouseLineLabel(li({ wallart_format: 'poster', wallart_size: 'medium' })), 'Poster Print · Medium (18 x 12")');
});
