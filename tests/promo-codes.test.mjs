// Promotion codes at Stripe Checkout (create-checkout + stripe-webhook):
//   - checkout turns the promo box on; shipping stays a shipping rate
//   - the webhook records discountAmount/discountCode, lists lines at the
//     price sold and shows "Discount (CODE) −£x" above shipping and the real
//     total in both emails; the Printful order carries no prices, so a
//     discount can't change what's made
//   - CHAOS10 from an email with an earlier order → ⚠ REPEAT WELCOME CODE
//   - another brand's code (metadata.brand) → ⚠ OTHER BRAND'S CODE
//   - the brand guard still skips other brands' sessions
// Stripe, Sanity, Printful and Resend are faked; nothing leaves the machine.
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

/* ── Fake Stripe ───────────────────────────────────────────────────────── */
let created, sessions, promos;
require.cache[require.resolve('stripe')] = {
  exports: () => ({
    webhooks: { constructEvent: (body) => JSON.parse(body) },
    checkout: {
      sessions: {
        create: async (p) => { created.push(p); return { id: 'cs_test_new', url: 'https://checkout.stripe.test' }; },
        retrieve: async (id) => { const s = sessions[id]; if (!s) throw new Error('no session'); return s; },
        listLineItems: async (id) => sessions[id].lines,
      },
    },
    promotionCodes: {
      retrieve: async (id) => { const p = promos[id]; if (!p) throw new Error('no promo'); return p; },
    },
  }),
};
const checkout = require('../netlify/functions/create-checkout.cjs');
const webhook = require('../netlify/functions/stripe-webhook.cjs');

/* ── Fake Sanity / Printful / Resend ───────────────────────────────────── */
let docs, emails, printfulOrders;
const json = (status, body) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
async function fakeFetch(url, init = {}) {
  const u = new URL(String(url));
  if (u.hostname === 'api.resend.com') { emails.push(JSON.parse(init.body)); return json(200, { id: 'em' }); }
  if (u.hostname === 'api.printful.com') { printfulOrders.push(JSON.parse(init.body)); return json(200, { result: { id: 555 } }); }
  if (u.hostname.endsWith('.api.sanity.io') && u.pathname.includes('/data/query/')) {
    const q = u.searchParams.get('query');
    const p = (k) => JSON.parse(u.searchParams.get('$' + k));
    const all = Object.values(docs);
    if (q.startsWith('count(')) return json(200, { result: all.filter((d) => d._id === p('id')).length });
    if (q.includes('lower(customerEmail) == $email')) {
      const hit = all
        .filter((d) => String(d.customerEmail || '').toLowerCase() === p('email') && d.stripeSessionId !== p('sid'))
        .sort((a, b) => String(a.placedAt).localeCompare(String(b.placedAt)))[0];
      return json(200, { result: hit ? { _id: hit._id, orderRef: hit.orderRef, placedAt: hit.placedAt } : null });
    }
    return json(200, { result: null });
  }
  if (u.hostname.endsWith('.api.sanity.io') && u.pathname.includes('/data/mutate/')) {
    for (const m of JSON.parse(init.body).mutations) {
      if (m.createOrReplace) docs[m.createOrReplace._id] = { ...m.createOrReplace };
      if (m.createIfNotExists && !docs[m.createIfNotExists._id]) docs[m.createIfNotExists._id] = { ...m.createIfNotExists };
      if (m.patch) {
        const d = docs[m.patch.id];
        for (const [k, v] of Object.entries(m.patch.setIfMissing || {})) if (d[k] === undefined) d[k] = v;
        Object.assign(d, m.patch.set || {});
      }
    }
    return json(200, {});
  }
  if (u.hostname.includes('google-analytics.com')) return json(204, {});
  throw new Error('unexpected fetch ' + url);
}

beforeEach(() => {
  created = []; sessions = {}; promos = {}; docs = {}; emails = []; printfulOrders = [];
  globalThis.fetch = fakeFetch;
  Object.assign(process.env, { RESEND_API_KEY: 're_test', PRINTFUL_API_KEY: 'pf_test', SANITY_API_TOKEN: 'sk_api' });
});

/* ── Helpers ───────────────────────────────────────────────────────────── */
const CHAOS10 = { id: 'promo_chaos10', code: 'CHAOS10', restrictions: { first_time_transaction: true }, metadata: { brand: 'thefuglys' } };
const MEOW10 = { id: 'promo_meow10', code: 'MEOW10', restrictions: { first_time_transaction: true }, metadata: { brand: 'catsoncrack' } };

/* A paid session: one £25 tee, £4.95 shipping, optionally 10% off with `promo`. */
function paid(id, { promo, email = 'tom@example.com', brand = 'thefuglys' } = {}) {
  const discount = promo ? 250 : 0;
  const s = {
    id, created: 1790000000, currency: 'gbp', amount_total: 2500 - discount + 495,
    shipping_cost: { amount_total: 495 },
    total_details: { amount_discount: discount, amount_shipping: 495 },
    metadata: { brand },
    customer_details: { name: 'Tom Kitten', email },
    shipping_details: { name: 'Tom Kitten', address: { line1: '1 Alley Way', city: 'London', postal_code: 'E1 1AA', country: 'GB' } },
  };
  if (promo) promos[promo.id] = promo;
  sessions[id] = {
    ...s,
    total_details: { ...s.total_details, breakdown: { discounts: promo ? [{ amount: discount, discount: { promotion_code: promo.id } }] : [] } },
    lines: { data: [{ id: 'li_1', description: 'Wasteland Tee — Black (M)', quantity: 1,
      amount_subtotal: 2500, amount_discount: discount, amount_total: 2500 - discount,
      price: { product: { metadata: { printful_variant_id: '101', fuglys_colour: 'Black', fuglys_size: 'M' } } } }] },
  };
  return s;
}
const deliver = (s) => webhook.handler({
  httpMethod: 'POST', headers: { 'stripe-signature': 't=1,v1=x' },
  body: JSON.stringify({ type: 'checkout.session.completed', data: { object: s } }),
});
const orderFor = (id) => docs[`order.${id.slice(-32)}`];
const text = (html) => String(html || '').replace(/<[^>]+>/g, ' ').replace(/&minus;/g, '−').replace(/&#9888;/g, '⚠').replace(/&rsquo;/g, '’').replace(/\s+/g, ' ');
const customerMail = () => emails.find((e) => /locked in/.test(e.subject));
const merchantMail = () => emails.find((e) => e.to === 'owner@thefuglys.com');

/* ── Checkout ──────────────────────────────────────────────────────────── */
test('checkout turns the promo box on and keeps shipping as a rate, not a line', async () => {
  const res = await checkout.handler({ httpMethod: 'POST', body: JSON.stringify({ items: [
    { id: 'wallart-wasteland-poster-small', productType: 'wallart', title: 'Wasteland', format: 'poster', size: 'small', quantity: 1, price: 9.99 },
  ] }) });
  assert.equal(res.statusCode, 200);
  assert.equal(created[0].allow_promotion_codes, true);
  assert.ok(!('discounts' in created[0]));
  assert.ok(created[0].shipping_options.length > 0);
  assert.ok(!created[0].line_items.some((l) => /ship/i.test(l.price_data.product_data.name)));
  assert.equal(created[0].metadata.brand, 'thefuglys', 'brand stamp unchanged');
});

/* ── Webhook ───────────────────────────────────────────────────────────── */
test('a code is recorded on the order and shown in both emails; the line keeps its sold price', async () => {
  await deliver(paid('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1', { promo: CHAOS10 }));
  const o = orderFor('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1');
  assert.equal(o.discountAmount, 2.5);
  assert.equal(o.discountCode, 'CHAOS10');
  assert.equal(o.total, 27.45);
  assert.equal(o.shippingCost, 4.95);
  assert.equal(o.items[0].price, 25, 'line at the price sold, not after the discount');
  for (const m of [customerMail(), merchantMail()]) {
    const t = text(m.html);
    assert.match(t, /Discount \(CHAOS10\)\s*−£2\.50/);
    assert.match(t, /£25\.00/);
    assert.match(t, /Shipping\s*£4\.95/);
    assert.match(t, /£27\.45/);
  }
  assert.ok(!o.repeatWelcomeCode && !o.crossBrandCode, 'a first order with its own code raises no flag');
  assert.doesNotMatch(merchantMail().subject, /⚠ (REPEAT|OTHER)/);
});

test('the Printful order carries variant ids and quantities only — no prices for a discount to change', async () => {
  await deliver(paid('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa2', { promo: CHAOS10 }));
  assert.deepEqual(printfulOrders[0].items, [{ sync_variant_id: 101, quantity: 1 }]);
  assert.ok(!JSON.stringify(printfulOrders[0]).match(/price|retail/i));
});

test('no code: no discount fields, no discount row', async () => {
  await deliver(paid('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3'));
  const o = orderFor('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa3');
  assert.ok(!('discountAmount' in o) && !('discountCode' in o));
  assert.ok(!emails.some((e) => /Discount/.test(e.html)));
  assert.equal(o.total, 29.95);
});

test('CHAOS10 from an email with an earlier order is flagged for the team, not the customer', async () => {
  docs['order.earlier'] = { _id: 'order.earlier', _type: 'order', orderRef: 'OLD12345', placedAt: '2026-10-01T10:00:00Z',
    customerEmail: 'Tom@Example.com', stripeSessionId: 'cs_test_earlier' };
  const r = await deliver(paid('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4', { promo: CHAOS10 }));
  assert.equal(r.statusCode, 200);
  const o = orderFor('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa4');
  assert.match(o.repeatWelcomeCode, /CHAOS10.*#OLD12345/);
  assert.equal(o.status, 'fulfilled', 'not blocked');
  assert.match(merchantMail().subject, /^⚠ REPEAT WELCOME CODE — /);
  assert.match(text(merchantMail().html), /⚠ REPEAT WELCOME CODE/);
  assert.doesNotMatch(`${customerMail().subject} ${text(customerMail().html)}`, /REPEAT|OLD12345/i);
});

test("another brand's code is flagged ⚠ OTHER BRAND'S CODE, and the order stands", async () => {
  const r = await deliver(paid('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5', { promo: MEOW10 }));
  assert.equal(r.statusCode, 200);
  const o = orderFor('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa5');
  assert.match(o.crossBrandCode, /MEOW10 belongs to catsoncrack/);
  assert.equal(o.discountCode, 'MEOW10');
  assert.ok(!o.repeatWelcomeCode, 'another brand’s code is not this brand’s welcome code');
  assert.equal(printfulOrders.length, 1, 'still sent to Printful');
  assert.match(merchantMail().subject, /^⚠ OTHER BRAND’S CODE — /);
  assert.doesNotMatch(`${customerMail().subject} ${text(customerMail().html)}`, /OTHER BRAND|catsoncrack/i);
});

test('a code with no brand metadata is recorded but cannot be checked, so is not flagged', async () => {
  await deliver(paid('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6', { promo: { id: 'promo_x', code: 'SPRING5', metadata: {} } }));
  const o = orderFor('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa6');
  assert.equal(o.discountCode, 'SPRING5');
  assert.ok(!o.crossBrandCode && !o.repeatWelcomeCode);
});

test('a failed code lookup keeps the amount and never fails the order', async () => {
  const s = paid('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa7', { promo: CHAOS10 });
  delete promos.promo_chaos10;
  assert.equal((await deliver(s)).statusCode, 200);
  const o = orderFor('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa7');
  assert.equal(o.discountAmount, 2.5);
  assert.ok(!('discountCode' in o));
  assert.match(text(customerMail().html), /Discount\s*−£2\.50/);
});

test('the brand guard still skips another brand’s session untouched', async () => {
  const r = await deliver(paid('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa8', { promo: CHAOS10, brand: 'labrats' }));
  assert.equal(r.statusCode, 200);
  assert.match(r.body, /other-brand/);
  assert.equal(Object.keys(docs).length, 0);
  assert.equal(emails.length, 0);
  assert.equal(printfulOrders.length, 0);
});

test('a Stripe retry of a discounted order sends no second email and keeps the discount and status', async () => {
  const s = paid('cs_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa9', { promo: CHAOS10 });
  await deliver(s);
  assert.equal(emails.length, 2, 'first delivery: confirmation + merchant alert');
  const key = 'order.' + s.id.slice(-32);
  docs[key].status = 'shipped';                         // printful-webhook moved it on since
  await deliver(s);                                     // Stripe retries the same event
  assert.equal(emails.length, 2, 'the retry sends neither email again');
  assert.equal(docs[key].status, 'shipped', 'the retry does not undo the shipped status');
  assert.equal(docs[key].discountAmount, 2.5);
  assert.equal(docs[key].discountCode, 'CHAOS10');
  assert.ok(!docs[key].repeatWelcomeCode, 'its own earlier delivery is not "an earlier order"');
});
