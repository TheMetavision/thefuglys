// A Stripe retry of checkout.session.completed must not undo what happened to
// the order since (netlify/functions/stripe-webhook.cjs saveOrder): it patches
// the payment fields only and leaves status and printful-webhook's shipping
// fields alone, and it doesn't resend the order confirmation or merchant
// alert. Runs both webhooks against one in-memory Sanity.
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

const SESSION_ID = 'cs_live_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6';
const SESSION_KEY = SESSION_ID.slice(-32);
const ORDER_ID = `order.${SESSION_KEY}`;

process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
// Read once when stripe-webhook loads, so it has to be set before the require.
process.env.NOTIFICATION_TO = 'owner@thefuglys.com';
delete process.env.ORDER_NOTIFICATION_TO;
// Branding both customer emails share (also read at load by stripe-webhook).
process.env.BRAND_ACCENT = '#7a0f24';
process.env.EMAIL_ACCENT = '#123456';
process.env.ORDER_EMAIL_FROM = 'The Fuglys <shop@thefuglys.com>';
process.env.NOTIFICATION_FROM = 'Shop alerts <alerts@example.com>';
const TEE = { id: 'li_1', description: 'Wasteland Tee — Black (M)', quantity: 1, amount_total: 2500,
  price: { product: { metadata: { printful_variant_id: '101', fuglys_colour: 'Black', fuglys_size: 'M' } } } };
const CANVAS = { id: 'li_2', description: 'Wasteland Sunset — Canvas', quantity: 1, amount_total: 4699,
  price: { product: { metadata: { fulfilment: 'inhouse', wallart_format: 'canvas-gallery', wallart_size: 'large' } } } };
let lineItems = { data: [TEE] };
require.cache[require.resolve('stripe')] = {
  exports: () => ({
    webhooks: { constructEvent: (body) => JSON.parse(body) },
    checkout: { sessions: { listLineItems: async () => lineItems } },
  }),
};
const stripeWebhook = require('../netlify/functions/stripe-webhook.cjs');
const { default: printfulWebhook } = await import('../netlify/functions/printful-webhook.mjs');

/* ── In-memory Sanity + Printful + Resend ──────────────────────────────── */

let docs, rev, emails, sanityMutations, printfulAccepts, gaPurchases;

function applyMutation(m) {
  if (m.createOrReplace) { docs[m.createOrReplace._id] = { ...m.createOrReplace, _rev: 'r' + ++rev }; return; }
  if (m.createIfNotExists) {
    if (!docs[m.createIfNotExists._id]) docs[m.createIfNotExists._id] = { ...m.createIfNotExists, _rev: 'r' + ++rev };
    return;
  }
  if (m.patch) {
    const doc = docs[m.patch.id];
    if (!doc) throw Object.assign(new Error('no such document'), { status: 404 });
    if (m.patch.ifRevisionID && m.patch.ifRevisionID !== doc._rev) throw Object.assign(new Error('revision mismatch'), { status: 409 });
    for (const [k, v] of Object.entries(m.patch.setIfMissing || {})) if (doc[k] === undefined) doc[k] = structuredClone(v);
    for (const [k, v] of Object.entries(m.patch.set || {})) doc[k] = structuredClone(v);
    doc._rev = 'r' + ++rev;
    return;
  }
  throw new Error('unsupported mutation ' + JSON.stringify(m));
}

const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

async function fakeFetch(url, init = {}) {
  const u = new URL(String(url));
  if (u.hostname === 'api.resend.com') { emails.push(JSON.parse(init.body)); return json(200, { id: 'em' }); }
  if (u.hostname === 'api.printful.com') {
    // First order goes through; a retry reusing the external_id is rejected.
    if (printfulAccepts) { printfulAccepts = false; return json(200, { result: { id: 987654 } }); }
    return json(400, { error: { message: 'Order with this external_id already exists' } });
  }
  if (u.hostname.endsWith('.api.sanity.io') && u.pathname.includes('/data/query/')) {
    const q = u.searchParams.get('query');
    const p = (k) => JSON.parse(u.searchParams.get('$' + k));
    const all = Object.values(docs);
    let result = null;
    if (q.startsWith('count(')) result = all.filter((d) => d._id === p('id')).length;
    else if (q.includes('printfulOrderId == $pid')) result = all.find((d) => d.printfulOrderId === p('pid')) ?? null;
    else if (q.includes('_id in [$a, $b]')) result = docs[p('a')] || docs[p('b')] || null;
    return json(200, { result: result && typeof result === 'object' ? structuredClone(result) : result });
  }
  if (u.hostname.endsWith('.api.sanity.io') && u.pathname.includes('/data/mutate/')) {
    const { mutations } = JSON.parse(init.body);
    sanityMutations.push(mutations);
    const before = structuredClone(docs);
    try { for (const m of mutations) applyMutation(m); } // a transaction: all or nothing
    catch (err) { docs = before; return json(err.status || 400, { error: err.message }); }
    return json(200, {});
  }
  if (u.hostname.includes('google-analytics.com')) { gaPurchases.push(JSON.parse(init.body)); return json(204, {}); }
  throw new Error('unexpected fetch ' + url);
}

beforeEach(() => {
  docs = {}; rev = 0; lineItems = { data: [TEE] }; emails = []; sanityMutations = []; printfulAccepts = true; gaPurchases = [];
  globalThis.fetch = fakeFetch;
  Object.assign(process.env, { RESEND_API_KEY: 're_test', PRINTFUL_API_KEY: 'pf_test', SANITY_API_TOKEN: 'sk_api' });
  for (const k of ['SANITY_TOKEN', 'PRINTFUL_WEBHOOK_SECRET', 'GA4_MEASUREMENT_ID', 'GA4_API_SECRET']) delete process.env[k];
});

/* ── Helpers ───────────────────────────────────────────────────────────── */

const session = (over = {}) => ({
  id: SESSION_ID, created: 1790000000, currency: 'gbp', amount_total: 2995,
  shipping_cost: { amount_total: 495 },
  metadata: { brand: 'thefuglys', source: 'thefuglys-web' },
  customer_details: { name: 'Grimy Gus', email: 'gus@example.com' },
  shipping_details: { name: 'Grimy Gus', address: { line1: '1 Wasteland Way', city: 'London', postal_code: 'E1 1AA', country: 'GB' } },
  ...over,
});
const stripeDelivery = (sess = session()) => stripeWebhook.handler({
  httpMethod: 'POST',
  headers: { 'stripe-signature': 't=1,v1=x' },
  body: JSON.stringify({ type: 'checkout.session.completed', data: { object: sess } }),
});
const printfulEvent = (body) => printfulWebhook(new Request('https://thefuglys.com/api/printful-webhook', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));
const SHIPMENT = { carrier: 'ROYAL MAIL', tracking_number: 'RM123456789GB', tracking_url: 'https://track.test/RM123456789GB', shipped_at: 1790100000 };
const shippedEvent = () => ({ type: 'package_shipped', data: { order: { id: 987654, external_id: SESSION_KEY }, shipment: SHIPMENT } });
const shippingEmails = () => emails.filter((e) => /has shipped/.test(e.subject));
const SHIPPING_FIELDS = ['carrier', 'trackingNumber', 'trackingUrl', 'shippedAt', 'failureReason'];
const confirmations = () => emails.filter((e) => e.to === 'gus@example.com' && /is locked in/.test(e.subject));
const merchantAlerts = () => emails.filter((e) => e.to === 'owner@thefuglys.com');

/* ── Tests ─────────────────────────────────────────────────────────────── */

test('first delivery creates the full order', async () => {
  assert.equal((await stripeDelivery()).statusCode, 200);
  const o = docs[ORDER_ID];
  assert.equal(o._type, 'order');
  assert.equal(o.status, 'fulfilled');
  assert.equal(o.printfulOrderId, '987654');
  assert.equal(o.orderRef, 'M3N4O5P6');
  assert.equal(o.customerEmail, 'gus@example.com');
  assert.equal(o.total, 29.95);
  assert.equal(o.shippingAddress.postalCode, 'E1 1AA');
  assert.equal(o.items.length, 1);
});

test('first delivery sends the customer confirmation and the merchant alert once each', async () => {
  await stripeDelivery();
  assert.equal(confirmations().length, 1);
  assert.equal(merchantAlerts().length, 1);
  assert.equal(emails.length, 2);
});

test('a Stripe retry sends neither the confirmation nor the merchant alert', async () => {
  await stripeDelivery();
  await stripeDelivery();
  await stripeDelivery(); // Stripe can retry more than once
  assert.equal(confirmations().length, 1);
  assert.equal(merchantAlerts().length, 1);
  assert.equal(emails.length, 2);
  assert.equal(sanityMutations.length, 3, 'the order log is still updated on each retry');
});

test('a retry for an old order- id is recognised too: no emails', async () => {
  const oldId = `order-${SESSION_KEY}`;
  docs[oldId] = { _id: oldId, _rev: 'r0', _type: 'order', status: 'fulfilled', orderRef: 'M3N4O5P6' };
  await stripeDelivery();
  assert.equal(emails.length, 0);
});

test('if the order log can\'t be read, both emails still go (twice beats never)', async () => {
  delete process.env.SANITY_API_TOKEN;
  await stripeDelivery();
  await stripeDelivery();
  assert.equal(confirmations().length, 2);
  assert.equal(merchantAlerts().length, 2);
});

test('a Stripe retry after shipping keeps status "shipped" and the tracking details', async () => {
  await stripeDelivery();
  assert.equal((await printfulEvent(shippedEvent())).status, 200);
  const shipped = structuredClone(docs[ORDER_ID]);
  assert.equal(shipped.status, 'shipped');
  assert.equal(shippingEmails().length, 1);

  // Retry: Printful now rejects the duplicate, so this run's own outcome is
  // "fulfilment-failed" — which must not overwrite "shipped".
  assert.equal((await stripeDelivery()).statusCode, 200);
  const after = docs[ORDER_ID];
  assert.equal(after.status, 'shipped');
  assert.equal(after.printfulOrderId, '987654');
  for (const f of SHIPPING_FIELDS) assert.deepEqual(after[f], shipped[f], f);
  assert.equal(after.trackingNumber, 'RM123456789GB');
  assert.equal(after.trackingUrl, 'https://track.test/RM123456789GB');
  assert.equal(after.carrier, 'ROYAL MAIL');
});

test('a Stripe retry after shipping does not lead to a second shipping email', async () => {
  await stripeDelivery();
  await printfulEvent(shippedEvent());
  assert.equal(shippingEmails().length, 1);

  await stripeDelivery();                 // Stripe retry
  assert.equal(shippingEmails().length, 1, 'stripe-webhook never sends the shipping email');

  await printfulEvent(shippedEvent());    // Printful repeats package_shipped
  assert.equal(shippingEmails().length, 1, 'order is still shipped with the same tracking, so the repeat is skipped');
  assert.equal(docs[ORDER_ID].status, 'shipped');
});

test('a retry writes only payment fields; status and Printful id are set only if missing', async () => {
  await stripeDelivery();
  await stripeDelivery();
  const retry = sanityMutations.at(-1);
  assert.deepEqual(retry[0], { createIfNotExists: { _id: ORDER_ID, _type: 'order' } });
  const { patch } = retry[1];
  assert.equal(patch.id, ORDER_ID);
  assert.deepEqual(Object.keys(patch.setIfMissing), ['status']); // the retry's Printful call failed, so no id to offer
  for (const f of ['status', 'printfulOrderId', 'inhouseStatus', ...SHIPPING_FIELDS]) assert.ok(!(f in patch.set), f);
  assert.ok(!sanityMutations.flat().some((m) => m.createOrReplace), 'never replaces the whole document');
});

test('a retry refreshes payment fields on an existing order', async () => {
  await stripeDelivery();
  await stripeDelivery(session({ customer_details: { name: 'Grimy Gus', email: 'gus.m@example.com' }, amount_total: 3495 }));
  assert.equal(docs[ORDER_ID].customerEmail, 'gus.m@example.com');
  assert.equal(docs[ORDER_ID].total, 34.95);
  assert.equal(docs[ORDER_ID].status, 'fulfilled');
});

test('a retry keeps a fulfilment failure and its reason', async () => {
  await stripeDelivery();
  await printfulEvent({ type: 'order_failed', data: { order: { id: 987654, external_id: SESSION_KEY }, reason: 'Address invalid' } });
  printfulAccepts = true; // even if this run's own Printful call succeeds
  await stripeDelivery();
  assert.equal(docs[ORDER_ID].status, 'fulfilment-failed');
  assert.equal(docs[ORDER_ID].failureReason, 'Address invalid');
});

test('a retry for an old order- id updates that doc instead of creating a second one', async () => {
  const oldId = `order-${SESSION_KEY}`;
  docs[oldId] = { _id: oldId, _rev: 'r0', _type: 'order', status: 'shipped', trackingNumber: 'RM1', orderRef: 'M3N4O5P6' };
  await stripeDelivery();
  assert.deepEqual(Object.keys(docs), [oldId]);
  assert.equal(docs[oldId].status, 'shipped');
  assert.equal(docs[oldId].trackingNumber, 'RM1');
  assert.equal(docs[oldId].customerEmail, 'gus@example.com');
});

test("a retry of an in-house wall-art order keeps the owner's in-house progress", async () => {
  lineItems = { data: [CANVAS] };
  await stripeDelivery();
  assert.equal(docs[ORDER_ID].status, 'inhouse');
  assert.equal(docs[ORDER_ID].inhouseStatus, 'to-make');
  assert.equal(docs[ORDER_ID].hasInhouse, true);
  docs[ORDER_ID].inhouseStatus = 'dispatched'; // the owner moves it along in Studio
  await stripeDelivery();
  assert.equal(docs[ORDER_ID].status, 'inhouse');
  assert.equal(docs[ORDER_ID].inhouseStatus, 'dispatched');
  assert.equal(merchantAlerts().length, 1, 'no second "make this" alert');
});

test('Sanity order log uses SANITY_API_TOKEN, falling back to SANITY_TOKEN', async () => {
  const sanityAuth = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('.api.sanity.io/')) sanityAuth.push({ url: String(url), auth: init.headers.Authorization });
    return fakeFetch(url, init);
  };
  const sanityCalls = async (env) => {
    docs = {}; printfulAccepts = true; sanityAuth.length = 0;
    for (const k of ['SANITY_API_TOKEN', 'SANITY_TOKEN']) delete process.env[k];
    Object.assign(process.env, env);
    assert.equal((await stripeDelivery()).statusCode, 200);
    return sanityAuth.slice();
  };
  // Both set: the API token wins, for the retry lookup and the write.
  let seen = await sanityCalls({ SANITY_API_TOKEN: 'sk_api', SANITY_TOKEN: 'sk_old' });
  assert.ok(seen.some((c) => c.url.includes('/data/mutate/')), 'order log written');
  assert.ok(seen.every((c) => c.auth === 'Bearer sk_api'));

  // Only the old name (as stripe-webhook used before): still works.
  seen = await sanityCalls({ SANITY_TOKEN: 'sk_old' });
  assert.ok(seen.some((c) => c.url.includes('/data/mutate/')));
  assert.ok(seen.every((c) => c.auth === 'Bearer sk_old'));

  // Neither: no Sanity calls at all.
  assert.equal((await sanityCalls({})).length, 0);
});

test("the shipped email has the order confirmation's sender and accent colour", async () => {
  await stripeDelivery();
  await printfulEvent(shippedEvent());
  const [confirmation] = confirmations();
  const [shipped] = shippingEmails();
  assert.equal(shipped.from, confirmation.from);
  assert.equal(shipped.from, 'The Fuglys <shop@thefuglys.com>');
  for (const mail of [confirmation, shipped]) {
    assert.match(mail.html, /#7a0f24/);
    assert.doesNotMatch(mail.html, /#123456|#99132F|#b3162e/);
  }
});

test('GA4 purchase: sent on the first delivery, not on a Stripe retry', async () => {
  Object.assign(process.env, { GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 'ga-secret' });
  const live = session({ livemode: true, metadata: { brand: 'thefuglys', ga_client_id: '123456789.1700000000', ga_session_id: '1700000000' } });
  await stripeDelivery(live);
  assert.equal(gaPurchases.length, 1);
  assert.equal(gaPurchases[0].events[0].name, 'purchase');
  await stripeDelivery(live);
  await stripeDelivery(live);
  assert.equal(gaPurchases.length, 1, 'a retry does not report the purchase again');
});

test('GA4 purchase: still sent once when the order log cannot be read', async () => {
  Object.assign(process.env, { GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 'ga-secret' });
  delete process.env.SANITY_API_TOKEN;
  await stripeDelivery(session({ livemode: true, metadata: { brand: 'thefuglys', ga_client_id: '123456789.1700000000' } }));
  assert.equal(gaPurchases.length, 1);
});

test('brand guard: another brand\'s session is ignored — no order, no emails', async () => {
  for (const metadata of [{ brand: 'bikerbabies', source: 'bikerbabies-web' }, { source: 'thefuglys-web' }, {}]) {
    assert.equal((await stripeDelivery(session({ metadata }))).statusCode, 200);
  }
  assert.deepEqual(docs, {});
  assert.equal(emails.length, 0);
});
