// The Sanity order log is written with SANITY_API_TOKEN (the name Netlify and the
// site use), falling back to SANITY_TOKEN. Covers stripe-webhook's saveOrder()
// and printful-webhook's status sync. fetch is stubbed, so nothing leaves the
// machine.
//
//   npm test
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
const { saveOrder } = require('../netlify/functions/stripe-webhook.cjs');
const { default: printfulHandler } = await import('../netlify/functions/printful-webhook.mjs');

const session = {
  id: 'cs_test_order_log_token', created: 1700000000, amount_total: 3195, currency: 'gbp',
  shipping_cost: { amount_total: 695 }, customer_details: { name: 'Axel', email: 'axel@example.com' },
};
const lineItems = { data: [{ id: 'li_1', description: 'Tee', quantity: 1, amount_total: 2500, price: { product: { metadata: {} } } }] };

let calls;
let realFetch;
const saved = {};
beforeEach(() => {
  for (const k of ['SANITY_API_TOKEN', 'SANITY_TOKEN', 'RESEND_API_KEY', 'PRINTFUL_WEBHOOK_SECRET']) { saved[k] = process.env[k]; delete process.env[k]; }
  calls = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), auth: (init.headers || {}).Authorization, method: init.method || 'GET' });
    // Order lookups: no earlier order; mutations: ok; Printful order query: one order.
    return { ok: true, status: 200, text: async () => '', json: async () => ({ result: String(url).includes('printfulOrderId') ? { _id: 'order.x', orderRef: 'X' } : 0 }) };
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

const mutations = () => calls.filter((c) => c.url.includes('/data/mutate/'));

test('stripe-webhook order log uses SANITY_API_TOKEN when only that is set', async () => {
  process.env.SANITY_API_TOKEN = 'api-token';
  await saveOrder(session, lineItems, 'fulfilled', '123');
  assert.equal(mutations().length, 1);
  assert.ok(calls.length >= 2, 'looks up the existing order id, then writes');
  for (const c of calls) assert.equal(c.auth, 'Bearer api-token', c.url);
});

test('stripe-webhook order log still works with only SANITY_TOKEN', async () => {
  process.env.SANITY_TOKEN = 'legacy-token';
  await saveOrder(session, lineItems, 'fulfilled', '123');
  assert.equal(mutations().length, 1);
  for (const c of calls) assert.equal(c.auth, 'Bearer legacy-token');
});

test('stripe-webhook prefers SANITY_API_TOKEN when both are set', async () => {
  process.env.SANITY_API_TOKEN = 'api-token';
  process.env.SANITY_TOKEN = 'legacy-token';
  await saveOrder(session, lineItems, 'fulfilled', '123');
  for (const c of calls) assert.equal(c.auth, 'Bearer api-token');
});

test('stripe-webhook skips the order log when neither token is set', async () => {
  await saveOrder(session, lineItems, 'fulfilled', '123');
  assert.equal(calls.length, 0);
});

const shipped = () => new Request('https://thefuglys.com/.netlify/functions/printful-webhook', {
  method: 'POST',
  body: JSON.stringify({ type: 'package_shipped', data: { order: { id: 987 }, shipment: { carrier: 'Royal Mail', tracking_number: 'RM1' } } }),
});

test('printful-webhook status sync uses SANITY_API_TOKEN when only that is set', async () => {
  process.env.SANITY_API_TOKEN = 'api-token';
  const res = await printfulHandler(shipped());
  assert.equal(res.status, 200);
  assert.equal(mutations().length, 1);
  for (const c of calls) assert.equal(c.auth, 'Bearer api-token');
});

test('printful-webhook status sync still works with only SANITY_TOKEN', async () => {
  process.env.SANITY_TOKEN = 'legacy-token';
  await printfulHandler(shipped());
  assert.equal(mutations().length, 1);
  for (const c of calls) assert.equal(c.auth, 'Bearer legacy-token');
});
