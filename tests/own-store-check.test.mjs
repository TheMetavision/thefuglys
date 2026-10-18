// The webhook places a Printful order only when every line's variant is in
// this site's own Printful store (netlify/functions/stripe-webhook.cjs,
// ownStoreCheck). Otherwise nothing is ordered, the merchant alert says which
// variant isn't ours, and the order log records why. Test-mode sessions are
// flagged in the log and the alert.
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
const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

async function fakeFetch(url, init = {}) {
  const u = new URL(String(url));
  if (u.hostname === 'api.resend.com') { emails.push(JSON.parse(init.body)); return json(200, { id: 'em' }); }
  if (u.hostname === 'api.printful.com' && u.pathname.startsWith('/store/variants/')) {
    const id = decodeURIComponent(u.pathname.split('/').pop());
    variantChecks.push(id);
    if (variantStatus) return json(variantStatus, { error: { message: 'down' } });
    return OURS.has(id) ? json(200, { result: { id } }) : json(404, { error: { message: 'Not Found' } });
  }
  if (u.hostname === 'api.printful.com' && u.pathname === '/orders') {
    ordersPlaced.push({ ...JSON.parse(init.body), confirmParam: u.searchParams.get('confirm') });
    return json(200, { result: { id: 555 } });
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

test('every variant ours: each is checked, then the order is placed', async () => {
  lineItems = { data: [line('li_1', '101'), line('li_2', '102')] };
  assert.equal((await deliver()).statusCode, 200);
  assert.deepEqual(variantChecks, ['101', '102']);
  assert.equal(ordersPlaced.length, 1);
  assert.equal(order().status, 'fulfilled');
  assert.equal(order().failureReason, undefined);
});

test('one variant from another store: nothing is ordered, the alert and the log say which', async () => {
  lineItems = { data: [line('li_1', '101'), line('li_2', '5346616824')] };
  const res = await deliver();
  assert.equal(res.statusCode, 200); // never make Stripe retry
  assert.equal(ordersPlaced.length, 0);
  assert.equal(order().status, 'fulfilment-failed');
  assert.match(order().failureReason, /5346616824: not in this Printful store/);
  assert.doesNotMatch(order().failureReason, /101/);
  assert.match(alert().subject, /ACTION NEEDED/);
  assert.match(alert().html, /NOT OUR VARIANT/);
  assert.match(alert().html, /5346616824/);
});

test('the check itself failing counts as not ours: nothing is ordered', async () => {
  lineItems = { data: [line('li_1', '101')] };
  variantStatus = 503;
  await deliver();
  assert.equal(ordersPlaced.length, 0);
  assert.equal(order().status, 'fulfilment-failed');
  assert.match(order().failureReason, /could not be checked \(Printful 503\)/);
});

test('a Stripe test-mode session is flagged TEST in the log and the alert', async () => {
  lineItems = { data: [line('li_1', '101')] };
  await deliver(session({ id: 'cs_test_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6', livemode: false }));
  assert.equal(order().test, true);
  assert.match(alert().subject, /^\[TEST\] /);
  assert.match(alert().html, /TEST MODE/);
});

/* ── Confirm or draft ───────────────────────────────────────────────────── */

test('confirm: live payment with PRINTFUL_AUTO_CONFIRM=true is confirmed', async () => {
  lineItems = { data: [line('li_1', '101')] };
  process.env.PRINTFUL_AUTO_CONFIRM = 'true';
  await deliver();
  assert.equal(ordersPlaced[0].confirmParam, 'true');
  assert.match(alert().html, /CONFIRMED order/);
});

test('confirm: without the flag (or any other value) the order is a draft, always said explicitly', async () => {
  for (const flag of [undefined, '', 'TRUE', '1', 'yes']) {
    docs = {}; emails = []; ordersPlaced = [];
    if (flag === undefined) delete process.env.PRINTFUL_AUTO_CONFIRM; else process.env.PRINTFUL_AUTO_CONFIRM = flag;
    lineItems = { data: [line('li_1', '101')] };
    await deliver();
    assert.equal(ordersPlaced[0].confirmParam, 'false', `flag ${flag}`);
    assert.match(alert().html, /DRAFT: confirm it in Printful/);
  }
});

test('confirm: a Stripe test-mode payment is a draft even with the flag set', async () => {
  lineItems = { data: [line('li_1', '101')] };
  process.env.PRINTFUL_AUTO_CONFIRM = 'true';
  await deliver(session({ id: 'cs_test_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6', livemode: false }));
  assert.equal(ordersPlaced[0].confirmParam, 'false');
  assert.equal(order().test, true);
});

test('a live session is not flagged as a test', async () => {
  lineItems = { data: [line('li_1', '101')] };
  await deliver();
  assert.equal(order().test, undefined);
  assert.doesNotMatch(alert().subject, /TEST/);
});
