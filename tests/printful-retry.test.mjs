// Printful order creation retries once on a transient failure
// (src/lib/printful-order.cjs, shared by every brand): a 5xx, a timeout or a
// network error is retried after a short delay; a 4xx is not. A duplicate
// external_id means the order is already in Printful, so it counts as success.
// Every failure records the real reason in failureReason and the alert.
//
// fetch and Stripe are stubbed, so nothing leaves the machine.
//
//   npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const quiet = () => {};
console.log = quiet; console.warn = quiet; console.error = quiet;

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.NOTIFICATION_TO = 'owner@thefuglys.com';
delete process.env.ORDER_NOTIFICATION_TO;

const line = (id, variant) => ({ id, description: `Item ${variant}`, quantity: 1, amount_total: 2500,
  price: { product: { metadata: { printful_variant_id: variant, fuglys_size: 'M', fuglys_colour: 'Black' } } } });
let lineItems;
require.cache[require.resolve('stripe')] = {
  exports: () => ({
    webhooks: { constructEvent: (body) => JSON.parse(body) },
    checkout: { sessions: { listLineItems: async () => lineItems } },
  }),
};
const { handler } = require('../netlify/functions/stripe-webhook.cjs');

const OURS = new Set(['101', '102']);
let docs, emails, ordersPlaced, variantChecks, variantStatus;
let storeHang = false;
let printful, created, lookups, existingStatus;
const printfulOrderConfig = require('../src/lib/printful-order.cjs').config;
const DEFAULT_TIMING = { ...printfulOrderConfig };
printfulOrderConfig.retryDelayMs = 0;
const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

const hang = (signal) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));

async function fakeFetch(url, init = {}) {
  const u = new URL(String(url));
  if (u.hostname === 'api.resend.com') { emails.push(JSON.parse(init.body)); return json(200, { id: 'em' }); }
  if (u.hostname === 'api.printful.com' && u.pathname.startsWith('/store/variants/')) {
    const id = decodeURIComponent(u.pathname.split('/').pop());
    variantChecks.push(id);
    if (storeHang) return hang(init.signal);
    if (variantStatus) return json(variantStatus, { error: { message: 'down' } });
    return OURS.has(id) ? json(200, { result: { id } }) : json(404, { error: { message: 'Not Found' } });
  }
  if (u.hostname === 'api.printful.com' && u.pathname === '/orders') {
    ordersPlaced.push({ ...JSON.parse(init.body), confirmParam: u.searchParams.get('confirm') });
    // Printful rejects a second order with the same external_id.
    if (created) return json(400, { code: 400, result: 'Order with this External ID already exists', error: { reason: 'BadRequest', message: 'Order with this External ID already exists' } });
    const next = printful.shift() || 'ok';
    if (next === 'ok') { created = true; return json(200, { result: { id: 555, status: 'draft' } }); }
    if (next === '500' || next === '500-but-created') {
      if (next === '500-but-created') created = true;
      return json(500, { code: 500, result: 'An internal server error occurred', error: { reason: 'InternalServerError', message: 'An internal server error occurred' } });
    }
    if (next === 'timeout-but-created') { created = true; throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); }
    if (next === 'hang') return hang(init.signal);
    if (next === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    if (next === 'network') throw new TypeError('fetch failed');
    if (next === '400') return json(400, { code: 400, result: 'Recipient: Invalid address', error: { reason: 'BadRequest', message: 'Recipient: Invalid address' } });
    throw new Error('bad script ' + next);
  }
  if (u.hostname === 'api.printful.com' && u.pathname.startsWith('/orders/@')) {
    lookups.push(decodeURIComponent(u.pathname.slice('/orders/@'.length)));
    return json(200, { result: { id: 777, status: existingStatus } });
  }
  if (u.hostname.endsWith('.api.sanity.io') && u.pathname.includes('/data/query/')) return json(200, { result: null });
  if (u.hostname.endsWith('.api.sanity.io') && u.pathname.includes('/data/mutate/')) {
    for (const m of JSON.parse(init.body).mutations) {
      if (m.createIfNotExists) docs[m.createIfNotExists._id] ??= { ...m.createIfNotExists };
      if (m.patch) Object.assign(docs[m.patch.id], m.patch.setIfMissing || {}, m.patch.set || {});
    }
    return json(200, {});
  }
  throw new Error('unexpected fetch ' + url);
}

beforeEach(() => {
  docs = {}; emails = []; ordersPlaced = []; variantChecks = []; variantStatus = null;
  printful = []; created = false; lookups = []; storeHang = false; existingStatus = 'draft';
  globalThis.fetch = fakeFetch;
  Object.assign(process.env, { RESEND_API_KEY: 're_test', PRINTFUL_API_KEY: 'pf_test', SANITY_API_TOKEN: 'sk_api' });
  for (const k of ['SANITY_TOKEN', 'GA4_MEASUREMENT_ID', 'GA4_API_SECRET', 'PRINTFUL_AUTO_CONFIRM']) delete process.env[k];
});

const session = (over = {}) => ({
  id: 'cs_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6', created: 1790000000, currency: 'gbp', amount_total: 3195,
  livemode: true, shipping_cost: { amount_total: 695 }, metadata: { brand: 'thefuglys', source: 'thefuglys-web' },
  customer_details: { name: 'Grimy Gus', email: 'gus@example.com' },
  shipping_details: { name: 'Grimy Gus', address: { line1: '1 Wasteland Way', city: 'London', postal_code: 'E1 1AA', country: 'GB' } },
  ...over,
});
const deliver = (sess = session()) => handler({
  httpMethod: 'POST', headers: { 'stripe-signature': 't=1,v1=x' },
  body: JSON.stringify({ type: 'checkout.session.completed', data: { object: sess } }),
});
const order = () => Object.values(docs)[0];
const alert = () => emails.find((e) => e.to === 'owner@thefuglys.com');

const EXTERNAL_ID = session().id.slice(-32);

test('500 then success: two attempts, one order, fulfilled, no failure reason', async () => {
  lineItems = { data: [line('li_1', '101')] };
  printful = ['500', 'ok'];
  assert.equal((await deliver()).statusCode, 200);
  assert.equal(ordersPlaced.length, 2);
  assert.equal(ordersPlaced[0].external_id, EXTERNAL_ID);
  assert.equal(ordersPlaced[1].external_id, EXTERNAL_ID, 'the retry reuses the external_id');
  assert.equal(order().status, 'fulfilled');
  assert.equal(order().printfulOrderId, '555');
  assert.equal(order().failureReason, undefined);
  assert.match(alert().html, /Sent to Printful \(#555\)/);
  assert.doesNotMatch(alert().subject, /ACTION NEEDED/);
});

test('500 twice: fulfilment-failed, the Printful reason recorded and shown in the alert', async () => {
  lineItems = { data: [line('li_1', '101')] };
  printful = ['500', '500'];
  assert.equal((await deliver()).statusCode, 200, 'still 200: never make Stripe retry');
  assert.equal(ordersPlaced.length, 2, 'exactly one retry');
  assert.equal(order().status, 'fulfilment-failed');
  assert.match(order().failureReason, /Printful API 500: An internal server error occurred \(tried twice\)/);
  assert.match(alert().subject, /ACTION NEEDED/);
  assert.match(alert().html, /WHY IT FAILED/);
  assert.match(alert().html, /Printful API 500: An internal server error occurred/);
});

test('500 but Printful did create it: the duplicate on retry counts as success, existing order recorded', async () => {
  lineItems = { data: [line('li_1', '101')] };
  printful = ['500-but-created'];
  await deliver();
  assert.equal(ordersPlaced.length, 2);
  assert.deepEqual(lookups, [EXTERNAL_ID], 'the existing order is looked up by external_id');
  assert.equal(order().status, 'fulfilled');
  assert.equal(order().printfulOrderId, '777');
  assert.equal(order().failureReason, undefined);
  assert.match(alert().html, /Sent to Printful \(#777\) as a DRAFT/);
});

test('timeout but created: retried, the duplicate counts as success', async () => {
  lineItems = { data: [line('li_1', '101')] };
  printful = ['timeout-but-created'];
  await deliver();
  assert.equal(ordersPlaced.length, 2);
  assert.equal(order().status, 'fulfilled');
  assert.equal(order().printfulOrderId, '777');
});

test('network error then success: retried once', async () => {
  lineItems = { data: [line('li_1', '101')] };
  printful = ['network', 'ok'];
  await deliver();
  assert.equal(ordersPlaced.length, 2);
  assert.equal(order().status, 'fulfilled');
  assert.equal(order().printfulOrderId, '555');
});

test('network error twice: the exception message is the failure reason', async () => {
  lineItems = { data: [line('li_1', '101')] };
  printful = ['network', 'network'];
  await deliver();
  assert.equal(order().status, 'fulfilment-failed');
  assert.match(order().failureReason, /Printful request failed: fetch failed \(tried twice\)/);
  assert.match(alert().html, /fetch failed/);
});

test('4xx: not retried, failed with the Printful message', async () => {
  lineItems = { data: [line('li_1', '101')] };
  printful = ['400'];
  await deliver();
  assert.equal(ordersPlaced.length, 1, 'no retry on a 4xx');
  assert.equal(order().status, 'fulfilment-failed');
  assert.match(order().failureReason, /Printful API 400: Recipient: Invalid address/);
  assert.doesNotMatch(order().failureReason, /tried twice/);
  assert.match(alert().html, /Recipient: Invalid address/);
});

test('a Stripe redelivery of a fulfilled order is not a failure (duplicate on the first attempt)', async () => {
  lineItems = { data: [line('li_1', '101')] };
  await deliver();
  await deliver();
  assert.equal(ordersPlaced.length, 2, 'the redelivery tries once and is told it exists');
  assert.equal(order().status, 'fulfilled');
  assert.equal(order().failureReason, undefined);
});

test('the confirm flag is unchanged: both attempts send the same explicit value', async () => {
  lineItems = { data: [line('li_1', '101')] };
  process.env.PRINTFUL_AUTO_CONFIRM = 'true';
  printful = ['500', 'ok'];
  await deliver();
  assert.deepEqual(ordersPlaced.map((o) => o.confirmParam), ['true', 'true']);
  assert.match(alert().html, /CONFIRMED order/);
});

test('no shipping address: the reason is recorded', async () => {
  lineItems = { data: [line('li_1', '101')] };
  await deliver(session({ shipping_details: null }));
  assert.equal(ordersPlaced.length, 0);
  assert.equal(order().status, 'fulfilment-failed');
  assert.match(order().failureReason, /No shipping address/);
});

test("Printful timing fits inside Netlify's default 10 s function limit: 4 s per call, 1 s between, one 9 s budget", () => {
  const t = DEFAULT_TIMING;
  assert.deepEqual(t, { retryDelayMs: 1000, timeoutMs: 4000, budgetMs: 9000, minAttemptMs: 1000 });
  assert.ok(t.budgetMs < 10000);
  // A fast check, then order timeout, wait, timeout: 9 s, inside the budget.
  assert.ok(t.timeoutMs + t.retryDelayMs + t.timeoutMs <= t.budgetMs);
  // A timed-out check (4 s) and a timed-out first order attempt (4 s) leave 1 s:
  // not enough for the wait plus a retry, so it stops at 8 s instead of 13 s.
  assert.ok(t.budgetMs - 2 * t.timeoutMs < t.retryDelayMs + t.minAttemptMs);
});

test('Printful timeout twice: fulfilment-failed, the reason says it did not answer within 4 s', async () => {
  printful = ['timeout', 'timeout'];
  lineItems = { data: [line('li_1', '101')] };
  await deliver();
  assert.equal(ordersPlaced.length, 2, 'exactly one retry');
  assert.match(order().failureReason, /Printful did not answer within 4 s \(tried twice\)/);
  assert.match(alert().html, /did not answer within 4 s/);
});

/* Real (short) timeouts against a Printful that hangs until the call is aborted. */
async function withTiming(timing, fn) {
  Object.assign(printfulOrderConfig, timing);
  try { await fn(); } finally { Object.assign(printfulOrderConfig, DEFAULT_TIMING, { retryDelayMs: 0 }); }
}

test("slow store check: each call is cut off at the timeout, no retry, logged as couldn't verify, and the order still goes through", async () => {
  await withTiming({ timeoutMs: 50, minAttemptMs: 50 }, async () => {
    storeHang = true;
    const started = Date.now();
    lineItems = { data: [line('li_1', '101'), line('li_2', '102')] };
    await deliver();
    assert.ok(Date.now() - started < 1000, 'the hung checks were abandoned at the timeout');
    assert.ok(variantChecks.length >= 1);
    assert.equal(ordersPlaced.length, 1, 'the order was still placed, once');
    assert.equal(order().status, 'fulfilled');
    assert.equal(order().printfulOrderId, '555');
    assert.equal(order().failureReason, undefined);
  });
});

test('slow store check and a slow order: no time left in the budget to retry, the reason says so', async () => {
  await withTiming({ budgetMs: 300, timeoutMs: 100, minAttemptMs: 100, retryDelayMs: 100 }, async () => {
    storeHang = true;
    printful = ['hang'];
    const started = Date.now();
    lineItems = { data: [line('li_1', '101'), line('li_2', '102')] };
    await deliver();
    assert.ok(Date.now() - started < 300, 'inside the budget');
    assert.equal(ordersPlaced.length, 1, 'no retry: the budget was spent');
    assert.equal(order().status, 'fulfilment-failed');
    assert.match(order().failureReason, /Printful did not answer within \d+ s \(no time left to retry\)/);
    assert.match(alert().html, /no time left to retry/);
  });
});
