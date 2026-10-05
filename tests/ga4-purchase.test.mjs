// Tests for the GA4 server-side purchase (src/lib/ga4-purchase.cjs), the shared
// item_variant rule (src/lib/ga4-item.mjs) and the webhook brand guard
// (src/lib/brand-guard.cjs). fetch is stubbed, so nothing leaves the machine.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sendPurchase, buildPurchasePayload } = require('../src/lib/ga4-purchase.cjs');
const { itemVariant, validGaIds } = require('../src/lib/ga4-item.mjs');
const { isOurSession } = require('../src/lib/brand-guard.cjs');

const ENV = { GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 'secret' };

// A live session: £25 tee + £16.99 poster, £6.95 shipping, no tax.
const session = (overrides = {}) => ({
  id: 'cs_live_abc123',
  livemode: true,
  currency: 'gbp',
  amount_total: 4894,
  shipping_cost: { amount_total: 695 },
  total_details: { amount_shipping: 695, amount_tax: 0, amount_discount: 0 },
  metadata: { brand: 'thefuglys', ga_client_id: '123456789.1700000000', ga_session_id: '1700000000' },
  ...overrides,
});

const lineItems = {
  data: [
    {
      description: 'Axel - Run Fast T-Shirt — Black (M)', quantity: 1,
      amount_subtotal: 2500, amount_discount: 0, amount_total: 2500,
      price: { product: { metadata: {
        printful_variant_id: '101', item_slug: 'axel-run-fast', item_name: 'Axel - Run Fast',
        item_type: 'tshirt', item_colour: 'Black', item_size: 'M',
      } } },
    },
    {
      description: 'Wasteland Sunset — Poster Print · Large', quantity: 1,
      amount_subtotal: 1699, amount_discount: 0, amount_total: 1699,
      price: { product: { metadata: {
        fulfilment: 'inhouse', wallart_slug: 'wasteland-sunset', wallart_format: 'poster', wallart_size: 'large',
        item_slug: 'wasteland-sunset', item_name: 'Wasteland Sunset', item_type: 'wallart',
        item_format: 'poster', item_size: 'large',
      } } },
    },
  ],
};

// Records the request; answers 204 like the Measurement Protocol does.
function stubFetch() {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 204 }; };
  return { calls, fetchImpl };
}

test('sends one purchase with the shopper ids and ads consent denied', async () => {
  const { calls, fetchImpl } = stubFetch();
  const r = await sendPurchase({ session: session(), lineItems, env: ENV, fetchImpl });
  assert.deepEqual(r, { sent: true });
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /^https:\/\/www\.google-analytics\.com\/mp\/collect\?measurement_id=G-TEST&api_secret=secret$/);
  const { client_id, consent, events } = calls[0].body;
  assert.equal(client_id, '123456789.1700000000');
  assert.deepEqual(consent, { ad_user_data: 'DENIED', ad_personalization: 'DENIED' });
  assert.equal(events[0].name, 'purchase');
  assert.equal(events[0].params.transaction_id, 'cs_live_abc123');
  assert.equal(events[0].params.engagement_time_msec, 1);
  assert.equal(events[0].params.currency, 'GBP');
});

test('skips without env vars, client id or livemode, never calling fetch', async () => {
  const { calls, fetchImpl } = stubFetch();
  const cases = [
    [{ session: session(), env: {} }, 'not-configured'],
    [{ session: session(), env: { GA4_MEASUREMENT_ID: 'G-TEST' } }, 'not-configured'],
    [{ session: session(), env: { GA4_API_SECRET: 'secret' } }, 'not-configured'],
    [{ session: session({ metadata: { brand: 'thefuglys' } }), env: ENV }, 'no-client-id'],
    [{ session: session({ metadata: { brand: 'thefuglys', ga_client_id: 'GA1.1.abc' } }), env: ENV }, 'no-client-id'],
    [{ session: session({ livemode: false }), env: ENV }, 'not-livemode'],
  ];
  for (const [opts, reason] of cases) {
    assert.deepEqual(await sendPurchase({ ...opts, lineItems, fetchImpl }), { sent: false, reason });
  }
  assert.equal(calls.length, 0);
});

test('skips a Stripe retry whose order was already logged', async () => {
  const { calls, fetchImpl } = stubFetch();
  const r = await sendPurchase({ session: session(), lineItems, env: ENV, fetchImpl, alreadySent: Promise.resolve(true) });
  assert.deepEqual(r, { sent: false, reason: 'duplicate' });
  assert.equal(calls.length, 0);
});

test('never throws: bad input, failing fetch, failing lookups, GA errors', async () => {
  const boom = async () => { throw new Error('network down'); };
  assert.deepEqual(await sendPurchase(), { sent: false, reason: 'not-configured' });
  assert.deepEqual(await sendPurchase({ session: null, env: ENV }), { sent: false, reason: 'not-livemode' });
  assert.deepEqual(await sendPurchase({ session: session(), lineItems, env: ENV, fetchImpl: boom }), { sent: false, reason: 'error' });
  assert.deepEqual(
    await sendPurchase({ session: session(), lineItems, env: ENV, fetchImpl: async () => ({ ok: false, status: 500 }) }),
    { sent: false, reason: 'http-500' },
  );
  const stripe = { checkout: { sessions: { listLineItems: boom } } };
  assert.deepEqual(await sendPurchase({ session: session(), stripe, env: ENV, fetchImpl: stubFetch().fetchImpl }), { sent: false, reason: 'error' });
  // A rejected dedupe check counts as "not sent before".
  assert.deepEqual(
    await sendPurchase({ session: session(), lineItems, env: ENV, fetchImpl: stubFetch().fetchImpl, alreadySent: Promise.reject(new Error('x')) }),
    { sent: true },
  );
});

test('gives up at the deadline instead of delaying the webhook', async () => {
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const started = Date.now();
  const r = await sendPurchase({ session: session(), lineItems, env: ENV, fetchImpl: hang, timeoutMs: 50 });
  assert.deepEqual(r, { sent: false, reason: 'timeout' });
  assert.ok(Date.now() - started < 1000);
  // The deadline also covers a slow Stripe lookup.
  const slowStripe = { checkout: { sessions: { listLineItems: () => new Promise(() => {}) } } };
  assert.deepEqual(
    await sendPurchase({ session: session(), stripe: slowStripe, env: ENV, fetchImpl: stubFetch().fetchImpl, timeoutMs: 50 }),
    { sent: false, reason: 'timeout' },
  );
});

test('fetches line items from Stripe when the webhook has none', async () => {
  const { calls, fetchImpl } = stubFetch();
  const stripe = { checkout: { sessions: { listLineItems: async () => lineItems } } };
  await sendPurchase({ session: session(), lineItems: { data: [] }, stripe, env: ENV, fetchImpl });
  assert.equal(calls[0].body.events[0].params.items.length, 2);
});

test('value is what Stripe charged excluding shipping; shipping and tax separate', () => {
  const { params } = buildPurchasePayload(session(), lineItems).events[0];
  assert.equal(params.value, 41.99);
  assert.equal(params.shipping, 6.95);
  assert.equal(params.tax, 0);
  const sum = params.items.reduce((s, i) => s + i.price * i.quantity, 0);
  assert.equal(Math.round(sum * 100) / 100, params.value);
});

test('items carry the charged price after discount and the per-unit discount', () => {
  const discounted = {
    data: [{
      description: 'Badge Set 1', quantity: 2, amount_subtotal: 1600, amount_discount: 400, amount_total: 1200,
      price: { product: { metadata: { item_slug: 'badge-set-1', item_name: 'Badge Set 1', item_type: 'pin', item_colour: '', item_size: 'One Size' } } },
    }],
  };
  const s = session({ amount_total: 1200 + 695, total_details: { amount_shipping: 695, amount_tax: 0, amount_discount: 400 } });
  const { params } = buildPurchasePayload(s, discounted).events[0];
  assert.deepEqual(params.items[0], {
    item_id: 'badge-set-1', item_name: 'Badge Set 1', item_category: 'pin',
    item_variant: 'One Size', price: 6, quantity: 2, discount: 2,
  });
  assert.equal(params.value, 12);
});

test('session_id is included only when valid', () => {
  const meta = (ga_session_id) => ({ brand: 'thefuglys', ga_client_id: '123.456', ga_session_id });
  const sid = (s) => buildPurchasePayload(session({ metadata: meta(s) }), lineItems).events[0].params.session_id;
  assert.equal(sid('1700000000'), '1700000000');
  assert.equal(sid(undefined), undefined);
  assert.equal(sid(''), undefined);
  assert.equal(sid('17000x'), undefined);
  assert.equal(sid('123456789012345678901'), undefined); // 21 digits
  // Never a session id without a valid client id.
  assert.deepEqual(validGaIds('nope', '1700000000'), {});
  assert.deepEqual(validGaIds('123.456', 'abc'), { ga_client_id: '123.456' });
  assert.deepEqual(validGaIds('123.456', '42'), { ga_client_id: '123.456', ga_session_id: '42' });
});

test('item_variant: clothing "<colour> / <size>", colourless "<size>", wall art "<format> / <size>"', () => {
  assert.equal(itemVariant({ productType: 'tshirt', colour: 'Black', size: 'M' }), 'Black / M');
  assert.equal(itemVariant({ productType: 'pin', colour: '', size: 'One Size' }), 'One Size');
  assert.equal(itemVariant({ productType: 'sticker', size: '4″×4″' }), '4″×4″');
  assert.equal(itemVariant({ productType: 'wallart', format: 'poster', size: 'medium' }), 'poster / medium');
  assert.equal(itemVariant({ productType: 'wallart', format: 'canvas-gallery', size: 'large' }), 'canvas-gallery / large');

  // The server builds the same strings from Stripe line metadata.
  const { items } = buildPurchasePayload(session(), lineItems).events[0].params;
  assert.deepEqual(items.map((i) => [i.item_id, i.item_category, i.item_variant]), [
    ['axel-run-fast', 'tshirt', 'Black / M'],
    ['wasteland-sunset', 'wallart', 'poster / large'],
  ]);
});

test('item_variant falls back to the older line metadata keys', () => {
  const legacy = { data: [
    { description: 'Tee', quantity: 1, amount_subtotal: 2500, price: { product: { metadata: { fuglys_colour: 'White', fuglys_size: 'L' } } } },
    { description: 'Art', quantity: 1, amount_subtotal: 999, price: { product: { metadata: { fulfilment: 'inhouse', wallart_slug: 'x', wallart_format: 'poster', wallart_size: 'small' } } } },
  ] };
  const { items } = buildPurchasePayload(session(), legacy).events[0].params;
  assert.equal(items[0].item_variant, 'White / L');
  assert.equal(items[1].item_variant, 'poster / small');
  assert.equal(items[1].item_id, 'x');
});

test('brand guard: only sessions stamped thefuglys are processed', () => {
  assert.equal(isOurSession({ metadata: { brand: 'thefuglys', source: 'thefuglys-web' } }), true);
  for (const brand of ['catsoncrack', 'labrats', 'bikerbabies', 'fuglys', '', undefined]) {
    assert.equal(isOurSession({ metadata: { brand } }), false, String(brand));
  }
  assert.equal(isOurSession({ metadata: { source: 'thefuglys-web' } }), false);
  assert.equal(isOurSession({}), false);
  assert.equal(isOurSession(null), false);
});
