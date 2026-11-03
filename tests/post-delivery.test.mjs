// The post-delivery sequence and referral programme, end to end against
// fakes (ported from Pixel8): the cart's opt-out box -> marketingConsent ->
// the buyer's referral code and the MailerLite "<XX> - Customers" group at the
// FIRST shipping email (Printful's or the wall-art dispatch email, whichever
// comes first) -> the thank-you code when a friend uses theirs.
//
// Brand-neutral: identical in thefuglys, labrats, catsoncrack and
// bikerbabies. Brand values come from each repo's site-config.mjs.
//
// Stripe, MailerLite, Resend and Sanity are all fakes; nothing leaves the
// machine.
//
//   npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fakeSanity, fakeResend, quiet } from './_fake-sanity.mjs';
import { SITE_CONFIG } from '../netlify/functions/_shared/site-config.mjs';
import {
  codeBody, friendCodeFor, issueReward, referralsFrom, ensureCoupon, isFriendCode, isRewardCode,
  couponName, COUPON_NAME_MAX,
  KIND_FRIEND, KIND_REWARD, referralConfig,
} from '../netlify/functions/_shared/referral.mjs';
import { optOutMetadata, consentFromSession, marketingRefused, referralEmailAllowed } from '../netlify/functions/_shared/marketing-consent.mjs';
import { customerPayload, addShippedCustomer, productTitleFor, contentsFor, fieldKeys } from '../netlify/functions/_shared/mailerlite-customer.mjs';
import { startPostDelivery, EARLIER_CODE_QUERY } from '../netlify/functions/_shared/post-delivery.mjs';
import {
  rewardReferrer, rewardEmail, checkReferral, referralNote, normEmail, EARLIER_ORDER_QUERY,
  SELF_REFERRAL, REPEAT_CUSTOMER, LOOKUP_FAILED,
} from '../netlify/functions/_shared/referral-reward.mjs';
import { sendDispatchEmail, afterDispatchEmail } from '../netlify/functions/_shared/dispatch-email.mjs';
import { createHandler } from '../netlify/functions/printful-webhook.mjs';

const require = createRequire(import.meta.url);
// Never a real key: everything below injects its own Stripe and MailerLite.
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
delete process.env.MAILERLITE_API_KEY;
const { isWelcomeCode, readDiscount, WELCOME_CODES } = require('../src/lib/promo-codes.cjs');
process.env.ORDER_NOTIFICATION_TO = process.env.ORDER_NOTIFICATION_TO || 'team@example.com';
const stripeWebhook = require('../netlify/functions/stripe-webhook.cjs');

const C = SITE_CONFIG;
const P = C.MAILERLITE_FIELD_PREFIX;
const NOW = Date.parse('2026-11-02T12:00:00Z');

// Line endings normalised: with core.autocrlf the working copy may be CRLF.
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
// Source with comments removed, so a check can't be satisfied by a comment.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

/* ------------------------------------------------------------------ fakes */

function fakeStripe({ couponExists = false, clashes = 0, failPromos = false } = {}) {
  const calls = { couponsCreated: [], promos: [] };
  let clashLeft = clashes;
  let n = 0;
  return {
    calls,
    coupons: {
      retrieve: async (id) => {
        if (couponExists || calls.couponsCreated.some((c) => c.id === id)) return { id };
        throw Object.assign(new Error('No such coupon'), { statusCode: 404, code: 'resource_missing' });
      },
      create: async (c) => {
        // As Stripe does: this is what stopped every IP brand's referral codes.
        if (String(c.name || '').length > 40) {
          throw Object.assign(new Error(`Invalid string: ${c.name}; must be at most 40 characters`), { statusCode: 400, code: 'parameter_invalid_string' });
        }
        calls.couponsCreated.push(c);
        return c;
      },
    },
    promotionCodes: {
      create: async (p) => {
        if (failPromos) throw Object.assign(new Error('Stripe is down'), { statusCode: 500 });
        if (clashLeft-- > 0) throw new Error('A promotion code with this code already exists');
        calls.promos.push(p);
        return { id: `promo_${++n}`, ...p };
      },
    },
  };
}

const SESSION_KEY = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6';
const ORDER_ID = `order.${SESSION_KEY}`;
const order = (over = {}) => ({
  _type: 'order',
  orderRef: 'M3N4O5P6',
  stripeSessionId: `cs_live_${SESSION_KEY}`,
  placedAt: '2026-11-01T10:00:00Z',
  customerName: 'Ada Lovelace',
  customerEmail: 'Ada@Example.com',
  status: 'fulfilled',
  printfulOrderId: '987654',
  hasInhouse: true,
  inhouseStatus: 'to-make',
  items: [
    { _key: 'a', title: 'Logo Tee', fulfilment: 'printful', quantity: 1 },
    { _key: 'b', title: 'Poster', fulfilment: 'inhouse', quantity: 1 },
  ],
  ...over,
});

/** Answers the GROQ the code under test runs, against the fake's store. */
function groq(q, p, store) {
  const all = [...store.values()].filter((d) => d._type === 'order' && !String(d._id).startsWith('drafts.'));
  if (q === EARLIER_CODE_QUERY) {
    const hit = all
      .filter((d) => d._id !== p.id && String(d.customerEmail || '').toLowerCase() === p.email && d.referralCode != null)
      .sort((a, b) => String(a._createdAt || '').localeCompare(String(b._createdAt || '')))[0];
    return hit ? hit.referralCode : null;
  }
  if (q === EARLIER_ORDER_QUERY) {
    return all
      .filter((d) => d._id !== p.docId && d.stripeSessionId !== p.sid && String(d.customerEmail || '').toLowerCase() === p.email)
      .filter((d) => !['other-brand', 'cancelled', 'refunded'].includes(d.status) && (p.test || d.test !== true))
      .sort((a, b) => String(a.placedAt || '').localeCompare(String(b.placedAt || '')))
      .map((d) => ({ _id: d._id, orderRef: d.orderRef, placedAt: d.placedAt }))[0] || null;
  }
  if (q.includes('printfulOrderId == $pid')) return all.find((d) => d.printfulOrderId === p.pid) || null;
  if (q.includes('_id in [$a, $b]')) return store.get(p.a) || store.get(p.b) || null;
  return null;
}

/** startPostDelivery deps: a fake Stripe and a recording MailerLite. */
function pd({ stripe = fakeStripe(), mlResult = { ok: true, status: 201 } } = {}) {
  const ml = [];
  return {
    stripe, ml,
    deps: {
      stripeKey: 'sk_test', makeStripe: async () => stripe, now: () => NOW,
      addCustomer: async (o, extra) => { ml.push({ order: o, ...extra }); return mlResult; },
    },
  };
}

// Resend for printful-webhook's "It's shipped" email goes over fetch.
let shippedEmails;
beforeEach(() => {
  shippedEmails = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).startsWith('https://api.resend.com')) {
      shippedEmails.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: 'em' }), text: async () => '' };
    }
    throw new Error('unexpected fetch ' + url);
  };
  process.env.SANITY_API_TOKEN = 'sk_api';
  process.env.RESEND_API_KEY = 're_test';
  delete process.env.PRINTFUL_WEBHOOK_SECRET;
});

const printfulReq = (shipment) => new Request(`${C.SITE_URL}/api/printful-webhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ type: 'package_shipped', data: { order: { id: 987654, external_id: SESSION_KEY }, shipment } }),
});
const PKG1 = { id: 1, carrier: 'ROYAL MAIL', tracking_number: 'RM111', tracking_url: 'https://track.test/RM111', shipped_at: 1790000000 };
const PKG2 = { id: 2, carrier: 'ROYAL MAIL', tracking_number: 'RM222', tracking_url: 'https://track.test/RM222', shipped_at: 1790000100 };

/** The Printful webhook and the wall-art dispatch email, both wired to the real post-delivery start with fakes. */
function wired(sanity, d) {
  const start = (a) => startPostDelivery(a, d.deps);
  const printful = createHandler({ getSanity: () => sanity, start });
  const resend = fakeResend();
  const dispatch = () => sendDispatchEmail({
    id: ORDER_ID, sanity, getResend: () => resend, log: quiet, now: () => NOW,
    after: (doc, ctx) => afterDispatchEmail(doc, { ...ctx, log: quiet, start }),
  });
  const markWallArtDispatched = () => Object.assign(sanity.store.get(ORDER_ID), { inhouseStatus: 'dispatched', wallArtTrackingNumber: 'WA123', wallArtCarrier: 'royal-mail' });
  return { printful, dispatch, resend, markWallArtDispatched };
}

/* ------------------------------------------------------------------ config */

test('site-config: this brand\'s prefixes, coupons, group and field prefix line up', () => {
  assert.match(C.BRAND_KEY, /^(thefuglys|labrats|catsoncrack|bikerbabies)$/);
  const expected = {
    thefuglys: ['FUG', 'FGTHX', 'fg', 'FG - Customers', '200065121519666669'],
    labrats: ['RAT', 'LRTHX', 'lr', 'LR - Customers', '200061471544051345'],
    catsoncrack: ['MEOW', 'COCTHX', 'coc', 'COC - Customers', '200065134059587076'],
    bikerbabies: ['BIKE', 'BBTHX', 'bb', 'BB - Customers', '200045611492312401'],
  }[C.BRAND_KEY];
  assert.deepEqual(
    [C.REFERRAL_FRIEND_PREFIX, C.REFERRAL_REWARD_PREFIX, C.MAILERLITE_FIELD_PREFIX, C.MAILERLITE_CUSTOMERS_GROUP, C.MAILERLITE_CUSTOMERS_GROUP_ID],
    expected,
  );
  assert.equal(C.REFERRAL_FRIEND_COUPON_ID, `${P}-referral-friend-10`);
  assert.equal(C.REFERRAL_REWARD_COUPON_ID, `${P}-referral-reward-10`);
});

test('site-config BRAND_KEY is the brand the checkout stamps and the webhook guards on', () => {
  const sources = [read('../netlify/functions/stripe-webhook.cjs')];
  if (existsSync(new URL('../src/lib/brand-guard.cjs', import.meta.url))) sources.push(read('../src/lib/brand-guard.cjs'));
  const keys = sources.map((s) => (s.match(/const BRAND_KEY = '([a-z]+)'/) || [])[1]).filter(Boolean);
  assert.ok(keys.length >= 1);
  for (const k of keys) assert.equal(k, C.BRAND_KEY);
  assert.equal(stripeWebhook.rewardStep.length >= 3, true);
});

/* ------------------------------------------------------------------ codes */

test('codes: no look-alike characters', () => {
  for (let i = 0; i < 200; i++) assert.match(codeBody(), /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$/);
});

test('friend code: brand prefix, brand coupon created on first use, first order only, brand + kind on code and coupon', async () => {
  const stripe = fakeStripe();
  const c = await friendCodeFor(stripe, { email: ' Ada@Example.com ', orderRef: '#M3N4O5P6' });
  assert.match(c, new RegExp(`^${C.REFERRAL_FRIEND_PREFIX}-[A-Z2-9]{6}$`));
  assert.deepEqual(stripe.calls.couponsCreated.map((x) => [x.id, x.percent_off, x.duration, x.metadata.brand, x.metadata.kind]),
    [[C.REFERRAL_FRIEND_COUPON_ID, 10, 'once', C.BRAND_KEY, KIND_FRIEND]]);
  const promo = stripe.calls.promos[0];
  assert.equal(promo.coupon, C.REFERRAL_FRIEND_COUPON_ID);
  assert.deepEqual(promo.restrictions, { first_time_transaction: true });
  assert.equal(promo.max_redemptions, undefined, 'a friend code can be shared with many friends');
  assert.deepEqual(promo.metadata, { brand: C.BRAND_KEY, kind: KIND_FRIEND, referrer_email: 'ada@example.com', referrer_order: '#M3N4O5P6' });
});

test('friend code: an existing one is reused, nothing created; a clashing random code is retried', async () => {
  const stripe = fakeStripe();
  assert.equal(await friendCodeFor(stripe, { email: 'a@b.c', existingCode: `${C.REFERRAL_FRIEND_PREFIX}-OLD123` }), `${C.REFERRAL_FRIEND_PREFIX}-OLD123`);
  assert.equal(stripe.calls.promos.length + stripe.calls.couponsCreated.length, 0);
  const clashing = fakeStripe({ couponExists: true, clashes: 2 });
  await friendCodeFor(clashing, { email: 'a@b.c' });
  assert.equal(clashing.calls.promos.length, 1);
  assert.equal(clashing.calls.couponsCreated.length, 0, 'the coupon already existed');
});

test('coupon names fit the Stripe 40-character limit for this brand and the longest IP brand name', async () => {
  for (const brandName of [C.BRAND_NAME, 'The Biker Babies', 'Cats On Crack', 'Labrats', 'The Fuglys']) {
    const cfg = { ...referralConfig(), brandName };
    const stripe = fakeStripe();
    await friendCodeFor(stripe, { email: 'a@b.c', orderRef: '#X' }, cfg);
    await issueReward(stripe, { referrerEmail: 'r@b.c', referredOrder: '#Y' }, cfg);
    assert.deepEqual(stripe.calls.couponsCreated.map((c) => c.name),
      [`${brandName}: referral 10% off`, `${brandName}: thank-you 10% off`]);
    for (const c of stripe.calls.couponsCreated) assert.ok(c.name.length <= COUPON_NAME_MAX, c.name);
  }
  assert.equal(couponName('A very long brand name indeed, far too long', 'referral 10% off').length, COUPON_NAME_MAX);
  const passed = fakeStripe();
  await ensureCoupon(passed, 'x', { name: 'y'.repeat(60), brand: 'b', kind: 'k' });
  assert.equal(passed.calls.couponsCreated[0].name, 'y'.repeat(40), 'ensureCoupon clamps whatever a caller passes');
});

test('ensureCoupon: a rival creating it first is fine; other errors are not swallowed', async () => {
  const rival = { coupons: {
    retrieve: async () => { throw Object.assign(new Error('missing'), { statusCode: 404 }); },
    create: async () => { throw Object.assign(new Error('exists'), { code: 'resource_already_exists' }); },
  } };
  assert.equal(await ensureCoupon(rival, 'x', { name: 'n', brand: 'b', kind: 'k' }), 'x');
  const down = { coupons: { retrieve: async () => { throw Object.assign(new Error('Stripe down'), { statusCode: 500 }); } } };
  await assert.rejects(ensureCoupon(down, 'x', { name: 'n', brand: 'b', kind: 'k' }), /Stripe down/);
});

test('reward code: brand prefix, single use, brand reward coupon, brand + kind recorded', async () => {
  const stripe = fakeStripe();
  const c = await issueReward(stripe, { referrerEmail: 'Ref@Example.com', referredOrder: '#ZZZZ9999' });
  assert.match(c, new RegExp(`^${C.REFERRAL_REWARD_PREFIX}-[A-Z2-9]{6}$`));
  const promo = stripe.calls.promos[0];
  assert.equal(promo.coupon, C.REFERRAL_REWARD_COUPON_ID);
  assert.equal(promo.max_redemptions, 1);
  assert.equal(promo.restrictions, undefined);
  assert.deepEqual(promo.metadata, { brand: C.BRAND_KEY, kind: KIND_REWARD, referrer_email: 'ref@example.com', referred_order: '#ZZZZ9999' });
  assert.equal(stripe.calls.couponsCreated[0].metadata.kind, KIND_REWARD);
});

const friendPromo = (over = {}) => ({
  id: 'promo_f', code: `${C.REFERRAL_FRIEND_PREFIX}-ABC234`, restrictions: { first_time_transaction: true },
  metadata: { brand: C.BRAND_KEY, kind: KIND_FRIEND, referrer_email: 'ref@example.com', referrer_order: '#REF00001' }, ...over,
});
const otherBrand = C.BRAND_KEY === 'labrats' ? 'thefuglys' : 'labrats';

test('referralsFrom: only this brand\'s friend codes, never your own, never without a referrer', () => {
  const promos = [
    friendPromo(),
    friendPromo({ id: 'p2', code: 'OTHER-1', metadata: { brand: otherBrand, kind: KIND_FRIEND, referrer_email: 'x@y.z' } }),
    friendPromo({ id: 'p3', code: 'MINE-1', metadata: { brand: C.BRAND_KEY, kind: KIND_FRIEND, referrer_email: 'buyer@example.com' } }),
    friendPromo({ id: 'p4', code: 'NOREF-1', metadata: { brand: C.BRAND_KEY, kind: KIND_FRIEND } }),
    { id: 'p5', code: WELCOME_CODES[0], restrictions: { first_time_transaction: true }, metadata: { brand: C.BRAND_KEY } },
    { id: 'p6', code: `${C.REFERRAL_REWARD_PREFIX}-X`, metadata: { brand: C.BRAND_KEY, kind: KIND_REWARD } },
  ];
  assert.deepEqual(referralsFrom(promos, 'Buyer@Example.com'),
    [{ code: `${C.REFERRAL_FRIEND_PREFIX}-ABC234`, referrerEmail: 'ref@example.com', referrerOrder: '#REF00001' }]);
  assert.ok(isFriendCode(promos[1]) && !isFriendCode(promos[1], C.BRAND_KEY));
  assert.ok(isRewardCode(promos[5], C.BRAND_KEY));
});

test('isWelcomeCode: metadata.kind first — friend and reward codes never read as the welcome code', () => {
  assert.equal(isWelcomeCode({ code: WELCOME_CODES[0] }), true);
  assert.equal(isWelcomeCode({ code: 'ANYTHING', restrictions: { first_time_transaction: true } }), true, 'first-order-only codes without a kind still count');
  assert.equal(isWelcomeCode({ code: 'X', metadata: { kind: 'welcome' } }), true);
  assert.equal(isWelcomeCode(friendPromo()), false, 'first-time-only, but a friend code');
  assert.equal(isWelcomeCode(friendPromo({ code: WELCOME_CODES[0] })), false, 'kind wins even over the name');
  assert.equal(isWelcomeCode({ code: 'R', metadata: { kind: KIND_REWARD } }), false);
});

test('readDiscount returns the expanded promotion codes; friend codes are not welcome codes; other brands still flagged', async () => {
  const other = friendPromo({ id: 'promo_o', code: 'OTHER-ZZZ999', metadata: { brand: otherBrand, kind: KIND_FRIEND, referrer_email: 'o@x.y' } });
  const stripe = {
    checkout: { sessions: { retrieve: async () => ({ total_details: { breakdown: { discounts: [
      { discount: { promotion_code: 'promo_f', coupon: { id: C.REFERRAL_FRIEND_COUPON_ID } } },
      { discount: { promotion_code: other, coupon: { id: 'x' } } },
    ] } } }) } },
    promotionCodes: { retrieve: async (id) => (id === 'promo_f' ? friendPromo() : null) },
  };
  const out = await readDiscount(stripe, { id: 'cs_1', total_details: { amount_discount: 500 } }, C.BRAND_KEY);
  assert.deepEqual(out.promos.map((p) => p.id), ['promo_f', 'promo_o']);
  assert.deepEqual(out.welcomeCodes, []);
  assert.deepEqual(out.otherBrand, [{ code: 'OTHER-ZZZ999', brand: otherBrand }]);
});

/* ------------------------------------------------------------------ consent */

test('consent: only a literal true opts out; refused = no marketing', () => {
  assert.equal(optOutMetadata(true), 'true');
  for (const v of [false, 'true', 1, undefined, null]) assert.equal(optOutMetadata(v), 'false');
  assert.equal(consentFromSession({ metadata: { marketing_opt_out: 'true' } }), 'refused');
  assert.equal(consentFromSession({ metadata: { marketing_opt_out: 'false' } }), 'not_asked');
  assert.equal(consentFromSession({}), 'not_asked');
  assert.ok(marketingRefused('refused'));
  assert.ok(!marketingRefused('not_asked') && !marketingRefused(undefined));
});

test('stripe-webhook records marketingConsent with the same rule as consentFromSession', async () => {
  const bodies = [];
  globalThis.fetch = async (url, init = {}) => {
    if (String(url).includes('/data/mutate/')) bodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({ result: 0 }), text: async () => '' };
  };
  const session = (meta) => ({
    id: `cs_live_${SESSION_KEY}`, created: 1790000000, amount_total: 2500, currency: 'gbp',
    customer_details: { name: 'Ada', email: 'ada@example.com' }, metadata: { brand: C.BRAND_KEY, ...meta },
  });
  for (const meta of [{ marketing_opt_out: 'true' }, { marketing_opt_out: 'false' }, {}]) {
    const id = await stripeWebhook.saveOrder(session(meta), { data: [] }, 'paid', null, {});
    assert.equal(id, ORDER_ID, 'saveOrder returns the order id for the reward step');
    const set = bodies.at(-1).mutations[1].patch.set;
    assert.equal(set.marketingConsent, consentFromSession(session(meta)));
  }
  assert.deepEqual(bodies.map((b) => b.mutations[1].patch.set.marketingConsent), ['refused', 'not_asked', 'not_asked']);
});

/* ------------------------------------------------------------------ MailerLite */

test('MailerLite payload: the brand group, the built-in name (first name) and brand-prefixed fields; no status, no CSC fields', () => {
  const body = customerPayload(order({ marketingConsent: 'not_asked' }), {
    referralCode: `${C.REFERRAL_FRIEND_PREFIX}-AAA222`, firstShipped: 'merch', groupId: C.MAILERLITE_CUSTOMERS_GROUP_ID, prefix: P,
  });
  assert.equal(body.email, 'Ada@Example.com');
  assert.deepEqual(body.groups, [C.MAILERLITE_CUSTOMERS_GROUP_ID]);
  assert.equal(body.status, undefined);
  assert.deepEqual(body.fields, {
    name: 'Ada',
    [`${P}_order_id`]: '#M3N4O5P6',
    [`${P}_product`]: 'Logo Tee and 1 more',
    [`${P}_last_order_date`]: '2026-11-01',
    [`${P}_referral_code`]: `${C.REFERRAL_FRIEND_PREFIX}-AAA222`,
    [`${P}_contents`]: 'both',
    [`${P}_first_shipped`]: 'merch',
    [`${P}_marketing_ok`]: 'yes',
  });
  for (const k of Object.keys(body.fields)) assert.ok(k === 'name' || k.startsWith(`${P}_`), k);
  for (const csc of ['order_id', 'product', 'last_order_date', 'referral_code', 'marketing_ok', 'tracking_url']) {
    assert.ok(!(csc in body.fields), csc);
  }
  assert.deepEqual(['name', ...Object.values(fieldKeys(P))].sort(), Object.keys(body.fields).sort());
  assert.equal(customerPayload(order({ customerName: '  ' }), { groupId: 'g', prefix: P }).fields.name, '');
  assert.equal(customerPayload(order({ customerName: undefined }), { groupId: 'g', prefix: P }).fields.name, '');
});

test('MailerLite payload: contents merch / wallart / both, first shipped wallart, product titles', () => {
  assert.equal(contentsFor(order({ items: [{ title: 'Tee', fulfilment: 'printful' }], hasInhouse: false })), 'merch');
  assert.equal(contentsFor(order({ items: [{ title: 'Poster', fulfilment: 'inhouse' }] })), 'wallart');
  assert.equal(contentsFor(order()), 'both');
  assert.equal(contentsFor({ items: [{ title: 'Old line, no fulfilment' }] }), 'merch');
  assert.equal(productTitleFor([{ title: 'Only One' }]), 'Only One');
  assert.equal(productTitleFor([]), 'your order');
  const body = customerPayload(order(), { firstShipped: 'wallart', groupId: 'g', prefix: P });
  assert.equal(body.fields[`${P}_first_shipped`], 'wallart');
  assert.equal(body.fields[`${P}_referral_code`], '');
});

test('MailerLite add: one upsert to the committed group; refused, unconfigured or bad email never calls', async () => {
  const sent = [];
  const fetchFn = async (url, init) => { sent.push({ url, init }); return { ok: true, status: 200, text: async () => '' }; };
  const r = await addShippedCustomer(order(), { referralCode: 'X', firstShipped: 'merch' }, { MAILERLITE_API_KEY: 'k' }, fetchFn);
  assert.deepEqual(r, { ok: true, status: 200 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://connect.mailerlite.com/api/subscribers');
  assert.equal(sent[0].init.method, 'POST');
  assert.equal(sent[0].init.headers.Authorization, 'Bearer k');
  const body = JSON.parse(sent[0].init.body);
  assert.deepEqual(body.groups, [C.MAILERLITE_CUSTOMERS_GROUP_ID]);
  assert.equal(body.status, undefined, 'never resubscribes anyone');

  assert.match((await addShippedCustomer(order({ marketingConsent: 'refused' }), {}, { MAILERLITE_API_KEY: 'k' }, fetchFn)).skipped, /refused/);
  assert.match((await addShippedCustomer(order(), {}, {}, fetchFn)).skipped, /not set/);
  assert.match((await addShippedCustomer(order({ customerEmail: 'nope' }), {}, { MAILERLITE_API_KEY: 'k' }, fetchFn)).skipped, /email/);
  assert.equal(sent.length, 1);
  const failing = async () => ({ ok: false, status: 422, text: async () => 'bad field' });
  assert.deepEqual(await addShippedCustomer(order(), {}, { MAILERLITE_API_KEY: 'k' }, failing), { ok: false, status: 422, error: 'bad field' });
  const throwing = async () => { throw new Error('network'); };
  assert.deepEqual(await addShippedCustomer(order(), {}, { MAILERLITE_API_KEY: 'k' }, throwing), { ok: false, error: 'network' });
});

/* ------------------------------------------------------------------ orders from before the box */

test('referralEmailAllowed: only an order that recorded not_asked (box seen, left unticked)', () => {
  assert.equal(referralEmailAllowed('not_asked'), true);
  for (const v of [undefined, null, '', 'refused', 'opt_out', 'anything']) assert.equal(referralEmailAllowed(v), false, String(v));
});

test('MailerLite payload: an order with no marketingConsent (before the box) sends marketing_ok = no', () => {
  const ok = (over) => customerPayload(order(over), { groupId: 'g', prefix: P }).fields[`${P}_marketing_ok`];
  assert.equal(ok({ marketingConsent: 'not_asked' }), 'yes');
  assert.equal(ok({}), 'no', 'no marketingConsent recorded');
  assert.equal(ok({ marketingConsent: null }), 'no');
  assert.equal(ok({ marketingConsent: '' }), 'no');
});

test('post-delivery: an order from before the box is still added (service emails) but with marketing_ok = no', async () => {
  const pre = order();
  assert.equal('marketingConsent' in pre, false, 'the fixture predates the box');
  const sanity = fakeSanity({ [ORDER_ID]: pre }, { fetch: groq });
  const sent = [];
  const fetchFn = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 201, text: async () => '' }; };
  const d = pd();
  const deps = { ...d.deps, addCustomer: (o, x) => addShippedCustomer(o, x, { MAILERLITE_API_KEY: 'k' }, fetchFn) };
  const r = await startPostDelivery({ sanity, id: ORDER_ID, trigger: 'merch', log: quiet }, deps);
  assert.equal(r.mailerlite.ok, true);
  assert.equal(sent.length, 1, 'still added to the Customers group');
  assert.deepEqual(sent[0].groups, [C.MAILERLITE_CUSTOMERS_GROUP_ID]);
  assert.equal(sent[0].fields[`${P}_marketing_ok`], 'no');
  assert.equal(sent[0].fields.name, 'Ada');
  assert.ok(sanity.store.get(ORDER_ID).postDeliveryStartedAt);
});

test('post-delivery: a new order with the box left unticked sends marketing_ok = yes', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order({ marketingConsent: 'not_asked' }) }, { fetch: groq });
  const sent = [];
  const fetchFn = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 201, text: async () => '' }; };
  const deps = { ...pd().deps, addCustomer: (o, x) => addShippedCustomer(o, x, { MAILERLITE_API_KEY: 'k' }, fetchFn) };
  await startPostDelivery({ sanity, id: ORDER_ID, trigger: 'wallart', log: quiet }, deps);
  assert.equal(sent[0].fields[`${P}_marketing_ok`], 'yes');
});

test('an order from before the box, through both triggers: both shipping emails go, one start, marketing_ok = no', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() }, { fetch: groq });
  const d = pd();
  const w = wired(sanity, d);
  await w.printful(printfulReq(PKG1));
  w.markWallArtDispatched();
  await w.dispatch();
  assert.equal(shippedEmails.length, 1);
  assert.equal(w.resend.sent.length, 1);
  assert.equal(d.ml.length, 1);
  assert.equal(customerPayload(d.ml[0].order, { groupId: 'g', prefix: P }).fields[`${P}_marketing_ok`], 'no');
});

/* ------------------------------------------------------------------ startPostDelivery */

test('post-delivery: code created and saved, buyer added, once only', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() }, { fetch: groq });
  const d = pd();
  const r = await startPostDelivery({ sanity, id: ORDER_ID, trigger: 'merch', log: quiet }, d.deps);
  assert.match(r.referralCode, new RegExp(`^${C.REFERRAL_FRIEND_PREFIX}-`));
  const doc = sanity.store.get(ORDER_ID);
  assert.equal(doc.referralCode, r.referralCode);
  assert.equal(doc.postDeliveryStartedAt, new Date(NOW).toISOString());
  assert.equal(doc.postDeliveryError, undefined);
  assert.equal(d.ml.length, 1);
  assert.equal(d.ml[0].referralCode, r.referralCode);
  assert.equal(d.ml[0].firstShipped, 'merch');
  assert.equal(d.ml[0].order.customerEmail, 'Ada@Example.com', 'the fresh full order, not a projection');
  assert.deepEqual(await startPostDelivery({ sanity, id: ORDER_ID, trigger: 'wallart', log: quiet }, d.deps), { skipped: 'already started' });
  assert.equal(d.ml.length, 1);
  assert.equal(d.stripe.calls.promos.length, 1);
});

test('post-delivery: a buyer who refused gets no claim, no code, no MailerLite', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order({ marketingConsent: 'refused' }) }, { fetch: groq });
  const d = pd();
  assert.deepEqual(await startPostDelivery({ sanity, id: ORDER_ID, trigger: 'merch', log: quiet }, d.deps), { skipped: 'refused' });
  assert.equal(sanity.writes.length, 0);
  assert.equal(d.stripe.calls.promos.length, 0);
  assert.equal(d.ml.length, 0);
});

test('post-delivery: a code from an earlier order (same email, any case) is reused, nothing created in Stripe', async () => {
  const earlier = `${C.REFERRAL_FRIEND_PREFIX}-EARLY2`;
  const sanity = fakeSanity({
    'order.earlier': order({ customerEmail: 'ADA@example.COM', referralCode: earlier, _createdAt: '2026-01-01T00:00:00Z' }),
    [ORDER_ID]: order({ _createdAt: '2026-11-01T00:00:00Z' }),
  }, { fetch: groq });
  const d = pd();
  const r = await startPostDelivery({ sanity, id: ORDER_ID, trigger: 'merch', log: quiet }, d.deps);
  assert.equal(r.referralCode, earlier);
  assert.equal(sanity.store.get(ORDER_ID).referralCode, earlier);
  assert.equal(d.stripe.calls.promos.length + d.stripe.calls.couponsCreated.length, 0);
  assert.equal(d.ml[0].referralCode, earlier);
});

test('post-delivery: Stripe down still adds the buyer (no code); problems recorded for Studio', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() }, { fetch: groq });
  const d = pd({ stripe: fakeStripe({ failPromos: true }), mlResult: { ok: false, status: 422, error: 'unknown field' } });
  const r = await startPostDelivery({ sanity, id: ORDER_ID, trigger: 'wallart', log: quiet }, d.deps);
  assert.equal(r.referralCode, '');
  assert.equal(d.ml.length, 1);
  assert.equal(d.ml[0].referralCode, '');
  const err = sanity.store.get(ORDER_ID).postDeliveryError;
  assert.match(err, /referral code: Stripe is down/);
  assert.match(err, /MailerLite: 422 unknown field/);
  // Still claimed: a later shipping email doesn't start it again.
  assert.ok(sanity.store.get(ORDER_ID).postDeliveryStartedAt);
});

test('post-delivery: no STRIPE_SECRET_KEY is a recorded problem, not a crash', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() }, { fetch: groq });
  const d = pd();
  await startPostDelivery({ sanity, id: ORDER_ID, trigger: 'merch', log: quiet }, { ...d.deps, stripeKey: '' });
  assert.match(sanity.store.get(ORDER_ID).postDeliveryError, /STRIPE_SECRET_KEY is not set/);
  assert.equal(d.ml.length, 1);
});

test('post-delivery: never throws, even when Sanity does; drafts, missing ids and no client are skipped', async () => {
  const broken = { getDocument: async () => { throw new Error('Sanity 500'); } };
  assert.match((await startPostDelivery({ sanity: broken, id: ORDER_ID, trigger: 'merch', log: quiet }, pd().deps)).error, /Sanity 500/);
  assert.deepEqual(await startPostDelivery({ sanity: broken, id: `drafts.${ORDER_ID}`, trigger: 'merch', log: quiet }), { skipped: 'no published order' });
  assert.deepEqual(await startPostDelivery({ sanity: broken, id: '', trigger: 'merch', log: quiet }), { skipped: 'no published order' });
  assert.deepEqual(await startPostDelivery({ id: ORDER_ID, trigger: 'merch', log: quiet }), { skipped: 'no Sanity client' });
  const empty = fakeSanity({}, { fetch: groq });
  assert.deepEqual(await startPostDelivery({ sanity: empty, id: ORDER_ID, trigger: 'merch', log: quiet }, pd().deps), { skipped: 'order not found' });
});

test('post-delivery: an open Studio draft gets the claim and the code too', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order(), [`drafts.${ORDER_ID}`]: { ...order(), _id: `drafts.${ORDER_ID}` } }, { fetch: groq });
  const d = pd();
  await startPostDelivery({ sanity, id: ORDER_ID, trigger: 'merch', log: quiet }, d.deps);
  const draft = sanity.store.get(`drafts.${ORDER_ID}`);
  assert.ok(draft.postDeliveryStartedAt);
  assert.equal(draft.referralCode, sanity.store.get(ORDER_ID).referralCode);
});

/* ------------------------------------------------------------------ the two triggers */

test('Printful first: the first package email starts it (merch); the second package and the wall-art email do not', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() }, { fetch: groq });
  const d = pd();
  const w = wired(sanity, d);
  assert.equal((await w.printful(printfulReq(PKG1))).status, 200);
  assert.equal(shippedEmails.length, 1);
  assert.equal(d.ml.length, 1);
  assert.equal(d.ml[0].firstShipped, 'merch');
  assert.equal((await w.printful(printfulReq(PKG2))).status, 200);
  assert.equal(shippedEmails.length, 2, 'the second package still gets its email');
  w.markWallArtDispatched();
  assert.equal((await w.dispatch()).sent, true);
  assert.equal(w.resend.sent.length, 1, 'the wall-art email still goes');
  assert.equal(d.ml.length, 1);
  assert.equal(d.stripe.calls.promos.length, 1);
});

test('wall art first: the dispatch email starts it (wallart); Printful packages after do not', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() }, { fetch: groq });
  const d = pd();
  const w = wired(sanity, d);
  w.markWallArtDispatched();
  assert.equal((await w.dispatch()).sent, true);
  assert.equal(d.ml.length, 1);
  assert.equal(d.ml[0].firstShipped, 'wallart');
  await w.printful(printfulReq(PKG1));
  await w.printful(printfulReq(PKG2));
  assert.equal(shippedEmails.length, 2);
  assert.equal(d.ml.length, 1);
  assert.equal(d.stripe.calls.promos.length, 1);
});

test('multi-package mixed order, everything at once: two package emails, one wall-art email, exactly one start', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() }, { fetch: groq });
  const d = pd();
  const w = wired(sanity, d);
  w.markWallArtDispatched();
  const [a, b, c] = await Promise.all([w.printful(printfulReq(PKG1)), w.printful(printfulReq(PKG2)), w.dispatch()]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(c.sent, true);
  assert.equal(shippedEmails.length, 2);
  assert.equal(w.resend.sent.length, 1);
  assert.equal(d.ml.length, 1);
  assert.equal(d.stripe.calls.promos.length, 1);
  const doc = sanity.store.get(ORDER_ID);
  assert.deepEqual(doc.printfulShipments.map((p) => p.trackingNumber).sort(), ['RM111', 'RM222']);
  assert.ok(doc.postDeliveryStartedAt);
});

test('merchandise-only order: Printful starts it with contents merch', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order({ hasInhouse: false, inhouseStatus: undefined, items: [{ _key: 'a', title: 'Tee', fulfilment: 'printful' }] }) }, { fetch: groq });
  const d = pd();
  await wired(sanity, d).printful(printfulReq(PKG1));
  assert.equal(d.ml.length, 1);
  assert.equal(customerPayload(d.ml[0].order, { firstShipped: d.ml[0].firstShipped, groupId: 'g', prefix: P }).fields[`${P}_contents`], 'merch');
});

test('refusal through both triggers: emails go, no code, no MailerLite, no claim', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order({ marketingConsent: 'refused' }) }, { fetch: groq });
  const d = pd();
  const w = wired(sanity, d);
  await w.printful(printfulReq(PKG1));
  w.markWallArtDispatched();
  await w.dispatch();
  assert.equal(shippedEmails.length, 1);
  assert.equal(w.resend.sent.length, 1);
  assert.equal(d.ml.length + d.stripe.calls.promos.length, 0);
  const doc = sanity.store.get(ORDER_ID);
  assert.equal(doc.postDeliveryStartedAt, undefined);
  assert.equal(doc.referralCode, undefined);
});

test('failures never block emails: Stripe and MailerLite down, both shipping emails still go', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() }, { fetch: groq });
  const d = pd({ stripe: fakeStripe({ failPromos: true }), mlResult: { ok: false, error: 'network' } });
  const w = wired(sanity, d);
  assert.equal((await w.printful(printfulReq(PKG1))).status, 200);
  assert.equal(shippedEmails.length, 1);
  w.markWallArtDispatched();
  const r = await w.dispatch();
  assert.equal(r.sent, true);
  assert.equal(r.status, 200);
  assert.equal(w.resend.sent.length, 1);
  assert.ok(sanity.store.get(ORDER_ID).dispatchEmailSentAt);
  assert.match(sanity.store.get(ORDER_ID).postDeliveryError, /Stripe is down/);
});

test('failures never block emails: a post-delivery start that throws outright', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() }, { fetch: groq });
  const boom = async () => { throw new Error('boom'); };
  assert.equal((await createHandler({ getSanity: () => sanity, start: boom })(printfulReq(PKG1))).status, 200);
  assert.equal(shippedEmails.length, 1);
  Object.assign(sanity.store.get(ORDER_ID), { inhouseStatus: 'dispatched', wallArtTrackingNumber: 'WA1' });
  const resend = fakeResend();
  const r = await sendDispatchEmail({
    id: ORDER_ID, sanity, getResend: () => resend, log: quiet, now: () => NOW,
    after: (doc, ctx) => afterDispatchEmail(doc, { ...ctx, log: quiet, start: boom }),
  });
  assert.equal(r.sent, true);
  assert.equal(resend.sent.length, 1);
});

test('afterDispatchEmail without a Sanity client does nothing (and never throws)', async () => {
  await afterDispatchEmail({ _id: ORDER_ID }, { log: quiet });
  await afterDispatchEmail(undefined, { log: quiet });
});

/* ------------------------------------------------------------------ the reward */

const rewardArgs = (sanity, stripe, resend, promos, over = {}) => ({
  stripe, sanity, resend, docId: ORDER_ID, ref: '#M3N4O5P6', promos, buyerEmail: 'buyer@example.com', log: quiet, ...over,
});

test('reward: thank-you code issued, recorded on the order and emailed to the referrer only', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() });
  const stripe = fakeStripe();
  const resend = fakeResend();
  const r = await rewardReferrer(rewardArgs(sanity, stripe, resend, [friendPromo()]));
  assert.equal(r.rewarded, true);
  assert.match(r.rewardCode, new RegExp(`^${C.REFERRAL_REWARD_PREFIX}-`));
  assert.deepEqual(sanity.store.get(ORDER_ID).referredBy, {
    code: `${C.REFERRAL_FRIEND_PREFIX}-ABC234`, referrerEmail: 'ref@example.com', referrerOrder: '#REF00001', rewardCode: r.rewardCode,
  });
  assert.equal(resend.sent.length, 1);
  assert.deepEqual(resend.sent[0].to, ['ref@example.com']);
  assert.equal(resend.sent[0].from, C.EMAIL_FROM);
  assert.match(resend.sent[0].html, new RegExp(r.rewardCode));
});

test('reward: once only — a second delivery (or a racing one) issues nothing more', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() });
  const stripe = fakeStripe();
  const resend = fakeResend();
  const [a, b] = await Promise.all([
    rewardReferrer(rewardArgs(sanity, stripe, resend, [friendPromo()])),
    rewardReferrer(rewardArgs(sanity, stripe, resend, [friendPromo()])),
  ]);
  assert.equal([a, b].filter((x) => x.rewarded).length, 1);
  assert.equal(stripe.calls.promos.length, 1);
  assert.equal(resend.sent.length, 1);
  assert.equal((await rewardReferrer(rewardArgs(sanity, stripe, resend, [friendPromo()]))).skipped, 'already rewarded');
});

test('reward: nothing for no code, the welcome code or another brand\'s friend code', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() });
  const stripe = fakeStripe();
  const resend = fakeResend();
  for (const promos of [
    [],
    [{ id: 'w', code: WELCOME_CODES[0], restrictions: { first_time_transaction: true }, metadata: { brand: C.BRAND_KEY } }],
    [friendPromo({ metadata: { ...friendPromo().metadata, brand: otherBrand } })],
  ]) {
    assert.deepEqual(await rewardReferrer(rewardArgs(sanity, stripe, resend, promos)), { rewarded: false });
  }
  assert.equal(stripe.calls.promos.length + resend.sent.length + sanity.writes.length, 0);
});

test('reward: a failed send is recorded on the order, never thrown', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() });
  const r = await rewardReferrer(rewardArgs(sanity, fakeStripe(), fakeResend({ fail: true }), [friendPromo()]));
  assert.equal(r.rewarded, false);
  assert.match(sanity.store.get(ORDER_ID).referralError, /refused/);
  const r2 = await rewardReferrer(rewardArgs(fakeSanity({ [ORDER_ID]: order() }), fakeStripe(), null, [friendPromo()]));
  assert.match(r2.error, /RESEND_API_KEY/);
});

test('reward email: the code and the site link only — no shop button', () => {
  const { subject, html } = rewardEmail(`${C.REFERRAL_REWARD_PREFIX}-QQQ777`);
  assert.match(subject, /10%/);
  assert.match(html, new RegExp(`${C.REFERRAL_REWARD_PREFIX}-QQQ777`));
  const links = [...html.matchAll(/<a\s[^>]*href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(links, [C.SITE_URL], 'the footer site link is the only link');
});

test('stripe-webhook rewardStep: rewards through the shared module; nothing to do without promos; never throws', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() });
  const stripe = fakeStripe();
  const resend = fakeResend();
  const session = { id: `cs_live_${SESSION_KEY}`, customer_details: { email: 'buyer@example.com' } };
  const r = await stripeWebhook.rewardStep(session, ORDER_ID, { promos: [friendPromo()] }, { sanity, resend, stripe });
  assert.equal(r.rewarded, true);
  assert.equal(sanity.store.get(ORDER_ID).referredBy.referrerOrder, '#REF00001');
  assert.deepEqual(await stripeWebhook.rewardStep(session, ORDER_ID, { promos: [] }, { sanity, resend, stripe }), { rewarded: false });
  const broken = { getDocument: async () => { throw new Error('down'); } };
  const r3 = await stripeWebhook.rewardStep(session, ORDER_ID, { promos: [friendPromo()] }, { sanity: broken, resend, stripe });
  assert.equal(r3.rewarded, false);
});

/* ------------------------------------------------------------------ new customers only */

const EARLIER_ID = 'order.zzEARLIERzz';
const earlierOrder = (over = {}) => ({ _type: 'order', orderRef: 'EARLY001', stripeSessionId: 'cs_live_earlier', placedAt: '2026-10-01T10:00:00Z', customerEmail: 'buyer@example.com', status: 'shipped', ...over });
const nothingIssued = (stripe, resend) => { assert.equal(stripe.calls.promos.length, 0, 'no reward code'); assert.equal(resend.sent.length, 0, 'no reward email'); };

test('new customers only: a new customer on a friend code is rewarded and emailed', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order({ customerEmail: 'buyer@example.com' }) }, { fetch: groq });
  const stripe = fakeStripe();
  const resend = fakeResend();
  const r = await rewardReferrer(rewardArgs(sanity, stripe, resend, [friendPromo()], { sessionId: `cs_live_${SESSION_KEY}` }));
  assert.equal(r.rewarded, true);
  assert.deepEqual(resend.sent[0].to, ['ref@example.com']);
  assert.equal(sanity.store.get(ORDER_ID).referralError, undefined);
});

test('new customers only: the code owner on their own code gets nothing; referralError self_referral', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() }, { fetch: groq });
  const stripe = fakeStripe();
  const resend = fakeResend();
  const r = await rewardReferrer(rewardArgs(sanity, stripe, resend, [friendPromo()], { buyerEmail: 'ref@example.com' }));
  assert.deepEqual(r, { rewarded: false, refused: SELF_REFERRAL });
  nothingIssued(stripe, resend);
  assert.equal(sanity.store.get(ORDER_ID).referralError, 'self_referral');
  assert.equal(sanity.store.get(ORDER_ID).referredBy, undefined);
});

test('new customers only: a repeat buyer on a friend code gets nothing; referralError repeat_customer', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order({ customerEmail: 'buyer@example.com' }), [EARLIER_ID]: earlierOrder() }, { fetch: groq });
  const stripe = fakeStripe();
  const resend = fakeResend();
  const r = await rewardReferrer(rewardArgs(sanity, stripe, resend, [friendPromo()], { sessionId: `cs_live_${SESSION_KEY}` }));
  assert.deepEqual(r, { rewarded: false, refused: REPEAT_CUSTOMER });
  nothingIssued(stripe, resend);
  assert.equal(sanity.store.get(ORDER_ID).referralError, 'repeat_customer');
});

test('new customers only: this order, another brand\'s misrouted order and a preview test order are not "earlier"', async () => {
  const docs = {
    [ORDER_ID]: order({ customerEmail: 'buyer@example.com' }),
    'order.misrouted': earlierOrder({ stripeSessionId: 'cs_live_m', status: 'other-brand' }),
    'order.preview': earlierOrder({ stripeSessionId: 'cs_test_p', test: true }),
    [`drafts.${EARLIER_ID}`]: earlierOrder(),
  };
  const args = { promos: [friendPromo()], buyerEmail: 'buyer@example.com', docId: ORDER_ID, sessionId: `cs_live_${SESSION_KEY}`, log: quiet };
  const live = await checkReferral({ ...args, sanity: fakeSanity(docs, { fetch: groq }) });
  assert.equal(live.eligible, true);
  // From a test checkout, earlier test orders do count (so previews behave like live).
  const fromTest = await checkReferral({ ...args, sanity: fakeSanity(docs, { fetch: groq }), test: true });
  assert.equal(fromTest.reason, REPEAT_CUSTOMER);
});

test('new customers only: case and whitespace in either email are the same email', async () => {
  assert.equal(normEmail(' Contact@TheMetavision.co.uk '), 'contact@themetavision.co.uk');
  const own = friendPromo({ metadata: { ...friendPromo().metadata, referrer_email: 'contact@themetavision.co.uk ' } });
  const self = await checkReferral({ sanity: fakeSanity({}, { fetch: groq }), promos: [own], buyerEmail: ' Contact@TheMetavision.co.uk ', docId: ORDER_ID, log: quiet });
  assert.equal(self.reason, SELF_REFERRAL);
  const seen = [];
  const sanity = fakeSanity({ [EARLIER_ID]: earlierOrder({ customerEmail: 'Buyer@Example.com' }) }, { fetch: (q, p, store) => { seen.push(p); return groq(q, p, store); } });
  const repeat = await checkReferral({ sanity, promos: [friendPromo()], buyerEmail: '  BUYER@example.COM ', docId: ORDER_ID, sessionId: 'cs_live_now', log: quiet });
  assert.equal(repeat.reason, REPEAT_CUSTOMER);
  assert.equal(seen[0].email, 'buyer@example.com');
  assert.match(EARLIER_ORDER_QUERY, /lower\(customerEmail\) == \$email/);
});

test('new customers only: a failed Sanity lookup skips the reward, is recorded and never thrown', async () => {
  const sanity = fakeSanity({ [ORDER_ID]: order() }, { fetch: async () => { throw new Error('Sanity is down'); } });
  const stripe = fakeStripe();
  const resend = fakeResend();
  const r = await rewardReferrer(rewardArgs(sanity, stripe, resend, [friendPromo()]));
  assert.deepEqual(r, { rewarded: false, refused: LOOKUP_FAILED });
  nothingIssued(stripe, resend);
  assert.match(sanity.store.get(ORDER_ID).referralError, /^lookup_failed — Sanity is down/);
});

test('new customers only: the team email line names the code and the reason', () => {
  const fc = `${C.REFERRAL_FRIEND_PREFIX}-ABC234`;
  assert.equal(referralNote(null), '');
  assert.equal(referralNote({ code: fc, eligible: true }), '');
  assert.equal(referralNote({ code: fc, eligible: false, reason: SELF_REFERRAL }),
    `Friend code ${fc} used by an existing customer (the code's own owner) — no reward issued (self-referral).`);
  assert.equal(referralNote({ code: fc, eligible: false, reason: REPEAT_CUSTOMER, earlier: { orderRef: 'EARLY001' } }),
    `Friend code ${fc} used by an existing customer (earlier order EARLY001) — no reward issued (repeat customer).`);
  assert.match(referralNote({ code: fc, referrerEmail: 'ref@example.com', eligible: false, reason: LOOKUP_FAILED, error: 'down' }),
    /new-customer check failed \(down\) — no reward issued.*ref@example\.com/);
});

/** Runs sendMerchantEmail with fetch stubbed; returns what it posted to Resend. */
async function teamEmailFor(session, promo) {
  const realFetch = globalThis.fetch;
  const key = process.env.RESEND_API_KEY;
  const posted = [];
  globalThis.fetch = async (url, init) => { posted.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
  process.env.RESEND_API_KEY = 're_test';
  try {
    await stripeWebhook.sendMerchantEmail(session, { data: [] }, 'fulfilled', '1', promo);
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = key;
  }
  return posted;
}

test('stripe-webhook: the check runs before the team email, which carries the line; the reward then honours it', async () => {
  const session = { id: `cs_live_${SESSION_KEY}`, livemode: true, customer_details: { email: ' Buyer@Example.com ', name: 'B' }, amount_total: 2000 };
  const stripe = fakeStripe();
  const resend = fakeResend();
  const sanity = fakeSanity({ [ORDER_ID]: order({ customerEmail: 'Buyer@Example.com' }), [EARLIER_ID]: earlierOrder() }, { fetch: groq });
  const promo = { promos: [friendPromo()], codes: [friendPromo().code] };
  await stripeWebhook.referralCheckStep(session, ORDER_ID, promo, { sanity });
  assert.equal(promo.referral.reason, REPEAT_CUSTOMER);
  assert.match(promo.referralNote, /no reward issued \(repeat customer\)/);

  const posted = await teamEmailFor(session, promo);
  assert.equal(posted.length, 1);
  assert.match(posted[0].html, /FRIEND CODE &mdash; NO REWARD/);
  assert.match(posted[0].html, new RegExp(`Friend code ${C.REFERRAL_FRIEND_PREFIX}-ABC234 used by an existing customer`));

  const r = await stripeWebhook.rewardStep(session, ORDER_ID, promo, { sanity, resend, stripe });
  assert.deepEqual(r, { rewarded: false, refused: REPEAT_CUSTOMER });
  nothingIssued(stripe, resend);
  assert.equal(sanity.store.get(ORDER_ID).referralError, 'repeat_customer');

  const src = code(read('../netlify/functions/stripe-webhook.cjs'));
  const check = src.indexOf('await referralCheckStep(session, orderId, promo)');
  const team = src.indexOf('await sendMerchantEmail(', check);
  assert.ok(check > 0 && team > check, 'the check comes before the team email');
});

test('stripe-webhook: a new customer\'s team email has no referral warning', async () => {
  const session = { id: `cs_live_${SESSION_KEY}`, customer_details: { email: 'buyer@example.com' } };
  const promo = { promos: [friendPromo()] };
  await stripeWebhook.referralCheckStep(session, ORDER_ID, promo, { sanity: fakeSanity({ [ORDER_ID]: order() }, { fetch: groq }) });
  assert.equal(promo.referral.eligible, true);
  assert.equal(promo.referralNote, '');
  const posted = await teamEmailFor(session, promo);
  assert.doesNotMatch(posted[0].html, /NO REWARD/);
});

test('stripe-webhook: a failed lookup never blocks the team email; it carries the warning', async () => {
  const session = { id: `cs_live_${SESSION_KEY}`, customer_details: { email: 'buyer@example.com' } };
  const sanity = fakeSanity({ [ORDER_ID]: order() }, { fetch: async () => { throw new Error('Sanity is down'); } });
  const promo = { promos: [friendPromo()] };
  await stripeWebhook.referralCheckStep(session, ORDER_ID, promo, { sanity });
  assert.equal(promo.referral.reason, LOOKUP_FAILED);
  assert.match(promo.referralNote, /new-customer check failed \(Sanity is down\)/);
  const posted = await teamEmailFor(session, promo);
  assert.equal(posted.length, 1, 'the team email still goes');
  assert.match(posted[0].html, /new-customer check failed/);
});

/* ------------------------------------------------------------------ wiring in the source */

test('cart drawer: an unticked, labelled opt-out box directly above Checkout, sent with the request', () => {
  const src = code(read('../src/components/CartDrawer.tsx'));
  assert.match(src, /const \[noOffers, setNoOffers\] = useState\(false\)/);
  assert.match(src, /marketingOptOut: noOffers/);
  const box = src.indexOf('Don&rsquo;t send me offers or referral emails');
  const checkout = src.indexOf('onClick={handleCheckout}');
  assert.ok(box > 0 && checkout > box, 'the box comes before the Checkout button');
  const between = src.slice(box, checkout);
  assert.ok(!/<button/.test(between.slice(0, between.lastIndexOf('<button'))), 'nothing else between the box and Checkout');
  assert.match(src, /type="checkbox" checked=\{noOffers\}/);
});

test('checkout stamps marketing_opt_out from a literal true; never consent_collection', () => {
  const src = code(read('../netlify/functions/create-checkout.cjs'));
  assert.match(src, /marketing_opt_out: marketingOptOut === true \? 'true' : 'false'/);
  assert.doesNotMatch(src, /consent_collection/);
});

test('stripe-webhook: records consent, rewards after the emails on first delivery only', () => {
  const src = code(read('../netlify/functions/stripe-webhook.cjs'));
  assert.match(src, /payment\.marketingConsent = session\.metadata && session\.metadata\.marketing_opt_out === 'true' \? 'refused' : 'not_asked'/);
  assert.match(src, /if \(!alreadyRecorded && orderId\) await rewardStep\(session, orderId, promo\)/);
});

test('Studio: the order shows the post-delivery fields, all read-only', () => {
  const orderFile = existsSync(new URL('../sanity/schemas/order.js', import.meta.url)) ? 'order.js' : 'order.ts';
  const schema = code(read(`../sanity/schemas/${orderFile}`));
  assert.match(schema, /import \{ postDeliveryFields \} from '\.\/postDeliveryFields'/);
  assert.match(schema, /\.\.\.postDeliveryFields\(\)/);
  const fields = read('../sanity/schemas/postDeliveryFields.ts');
  for (const f of ['marketingConsent', 'referralCode', 'referredBy', 'postDeliveryStartedAt', 'postDeliveryError', 'referralError', 'printfulShipments']) {
    const at = fields.indexOf(`name: '${f}'`);
    assert.ok(at > 0, f);
    assert.match(fields.slice(at, at + 200), /readOnly: true/, f);
  }
});

test('the shared post-delivery modules carry no brand names (identical in the four repos)', () => {
  for (const f of ['post-delivery.mjs', 'referral.mjs', 'referral-reward.mjs', 'mailerlite-customer.mjs', 'marketing-consent.mjs', 'printful-shipped.mjs']) {
    const src = code(read(`../netlify/functions/_shared/${f}`));
    assert.doesNotMatch(src, /Fuglys|Labrats|Cats On Crack|Biker Babies|thefuglys|catsoncrack|bikerbabies|labrats\.uk|\bFUG-|\bRAT-|\bMEOW-|\bBIKE-|fg_|lr_|coc_|bb_/, f);
  }
});

test('referralConfig reads site-config (env override allowed, as every setting)', () => {
  assert.equal(referralConfig({}).friendPrefix, C.REFERRAL_FRIEND_PREFIX);
  assert.equal(referralConfig({ REFERRAL_FRIEND_PREFIX: 'TEST' }).friendPrefix, 'TEST');
});
