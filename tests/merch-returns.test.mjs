// Merchandise (Printful) returns, switched on in feat/merch-returns:
// change of mind by prepaid label (X1 / X2), faulty items as Printful claims
// with no label, windows from Printful's ship date, mixed requests split by
// route. Shared: the same file in every repo that has the shipping modules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSanity, fakeResend, quiet } from './_fake-sanity.mjs';
import {
  evaluateReturn, pickLines, returnRoutes, printfulShipDates, isExcludedLine, longDate,
  MERCH_WINDOW_DAYS, PRINTFUL_CLAIM_DAYS, UNKNOWN_SHIP_ALLOWANCE_DAYS, MERCH_NOT_SHIPPED, OVERSEAS_EMAIL_US, CLOTHING_EMAIL_US, FAULTY,
} from '../netlify/functions/_shared/returns-eligibility.mjs';
import { merchBandOf, returnBandFor, merchPackingNote, MERCH_BAND_BY_TYPE } from '../netlify/functions/_shared/parcel-plan.mjs';
import { handleReturns } from '../netlify/functions/_shared/returns-api.mjs';
import { processReturn } from '../netlify/functions/_shared/shipping-returns.mjs';
import { routeFor } from '../netlify/functions/_shared/orders-router.mjs';
import { flag, SITE_CONFIG } from '../netlify/functions/_shared/site-config.mjs';

const ENV = { SHIPPING_SECRET: 'test-shipping-secret' };
const SITE = SITE_CONFIG.SITE_URL;
const TEAM = SITE_CONFIG.TEAM_EMAIL;
const SHIPPED = '2026-11-04T09:00:00Z';
const NOW = Date.parse('2026-11-10T12:00:00Z');

const addDays = (ymd, n) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
// The last day to ask, and the first day it's too late, for a 4 Nov ship date.
const LAST_DAY = addDays('2026-11-04', MERCH_WINDOW_DAYS);
const TOO_LATE = addDays('2026-11-04', MERCH_WINDOW_DAYS + 1);

const poster = (key, size = 'large') => ({ _key: key, _type: 'lineItem', title: `Art ${key} — Poster Print · ${size}`, colour: 'poster', size, quantity: 1, price: 16.99, fulfilment: 'inhouse' });
const merch = (key, title, over = {}) => ({ _key: key, _type: 'lineItem', title, colour: 'Black', size: 'L', quantity: 1, price: 24.99, fulfilment: 'printful', ...over });
const tee = (key = 't') => merch(key, 'Squad Tee — Black (L)', { productType: 'tshirt' });
const hoodie = (key = 'h') => merch(key, 'Squad Hoodie — Black (L)', { productType: 'hoodie', price: 39.99 });

const order = (over = {}) => ({
  _id: 'order.abc', _type: 'order', orderRef: 'ZQ9XK2BT', stripeSessionId: 'cs_test_aaaaaaaazq9xk2bt',
  placedAt: '2026-11-01T10:00:00Z', customerName: 'Ada Lovelace', customerEmail: 'ada@example.com',
  status: 'shipped', printfulOrderId: '987', shippedAt: SHIPPED,
  shippingAddress: { name: 'Ada Lovelace', line1: '2 Road', city: 'Leeds', postalCode: 'LS1 1AA', country: 'GB' },
  items: [tee()],
  ...over,
});

/* ------------------------------------------------------------------ switch & bands */

test('merch returns: switched on in site-config', () => {
  assert.equal(flag('RETURNS_CLOTHING', {}), true);
  assert.equal(SITE_CONFIG.PRINTFUL_CLAIM_DAYS, '30');
  assert.equal(PRINTFUL_CLAIM_DAYS, 30);
});

test('bands: X1 flat garments, X2 hoodies / trainers / boxed; by product type, then by title; unclear is null', () => {
  assert.equal(merchBandOf({ productType: 'tshirt' }), 'X1');
  assert.equal(merchBandOf({ productType: 'socks' }), 'X1');
  assert.equal(merchBandOf({ productType: 'hoodie' }), 'X2');
  assert.equal(merchBandOf({ productType: 'hightopmens' }), 'X2', 'trainers');
  assert.equal(merchBandOf({ productType: 'mug' }), 'X2', 'boxed');
  assert.equal(merchBandOf({ productType: 'cap' }), null, 'a type not in the list is never guessed');
  assert.equal(merchBandOf({ title: 'Lab Rat Kids Sweatshirt — Grey (7-8)' }), 'X2', 'sweatshirt is not "shirt"');
  assert.equal(merchBandOf({ title: 'Squad Tee — Black (L)' }), 'X1');
  assert.equal(merchBandOf({ title: 'Sticker Set 5 Sticker — White (5.5″×5.5″)' }), 'X1');
  assert.equal(merchBandOf({ title: 'Mystery Tote' }), null);
  for (const b of Object.values(MERCH_BAND_BY_TYPE)) assert.ok(['X1', 'X2'].includes(b));
  // One merchandise parcel: X2 if anything is bulky; unclear -> Alan chooses.
  assert.equal(returnBandFor([{ ...tee(), quantity: 1 }, { ...hoodie(), quantity: 1 }]), 'X2');
  assert.equal(returnBandFor([{ ...tee(), quantity: 2 }]), 'X1');
  assert.equal(returnBandFor([{ ...merch('c', 'Cap', { productType: 'cap' }), quantity: 1 }]), null);
  assert.match(merchPackingNote([{ ...tee(), quantity: 2 }]), /2 items in one X1 mailer/);
  assert.match(merchPackingNote([{ ...merch('c', 'Cap', { productType: 'cap' }), quantity: 1 }]), /Choose the band/);
  assert.equal(merchPackingNote([{ ...tee(), quantity: 1 }]), null);
});

/* ------------------------------------------------------------------ windows */

test(`window: change of mind until the end of day ${MERCH_WINDOW_DAYS} after Printful's ship date, UK time`, () => {
  const lastEvening = Date.parse(`${LAST_DAY}T23:30:00Z`); // GMT in November: still the last day
  const v = evaluateReturn(order(), { now: lastEvening, clothing: true });
  assert.equal(v.merchWindowEndsOn, LAST_DAY);
  assert.equal(v.lines[0].returnable, 1);
  const late = evaluateReturn(order(), { now: Date.parse(`${TOO_LATE}T00:30:00Z`), clothing: true });
  assert.equal(late.lines[0].returnable, 0);
  assert.match(late.lines[0].why, new RegExp(`ended on ${longDate(LAST_DAY)}`));
  assert.equal(late.lines[0].claimable, 1, 'a faulty item can still be reported after the window');
  assert.equal(late.eligible, true);
});

test('window: a ship date late in the evening counts as the next UK day in summer time', () => {
  // 23:30 UTC on 24 Oct is 00:30 BST on 25 Oct.
  const v = evaluateReturn(order({ shippedAt: '2026-10-24T23:30:00Z' }), { now: Date.parse('2026-10-26T12:00:00Z'), clothing: true });
  assert.equal(v.merchWindowEndsOn, addDays('2026-10-25', MERCH_WINDOW_DAYS));
});

test('window: several packages -> change of mind from the latest, Printful claim deadline from the earliest', () => {
  const o = order({
    shippedAt: '2026-11-06T09:00:00Z',
    printfulShipments: [{ shippedAt: '2026-11-03T09:00:00Z' }, { shippedAt: '2026-11-06T09:00:00Z' }],
  });
  assert.deepEqual(printfulShipDates(o), { first: '2026-11-03T09:00:00.000Z', last: '2026-11-06T09:00:00.000Z' });
  const v = evaluateReturn(o, { now: NOW, clothing: true });
  assert.equal(v.merchWindowEndsOn, addDays('2026-11-06', MERCH_WINDOW_DAYS));
  assert.equal(v.claimDeadline, addDays('2026-11-03', PRINTFUL_CLAIM_DAYS));
});

test('window: not shipped -> email us to cancel, nothing to report; shipped with no date -> order date + allowance, flagged', () => {
  const unshipped = evaluateReturn(order({ status: 'fulfilled', shippedAt: undefined }), { now: NOW, clothing: true });
  assert.equal(unshipped.eligible, false);
  assert.equal(unshipped.reason, MERCH_NOT_SHIPPED);
  assert.equal(unshipped.lines[0].claimable, 0);
  const legacy = evaluateReturn(order({ shippedAt: undefined }), { now: NOW, clothing: true });
  assert.equal(legacy.shipDateUnknown, true);
  assert.equal(legacy.merchWindowEndsOn, addDays('2026-11-01', MERCH_WINDOW_DAYS + UNKNOWN_SHIP_ALLOWANCE_DAYS));
  assert.equal(legacy.claimDeadline, null);
  assert.equal(legacy.lines[0].returnable, 1);
});

test('exclusions, overseas and the switch off', () => {
  assert.equal(isExcludedLine({ title: 'Personalised Name Tee' }), true);
  assert.equal(isExcludedLine({ title: 'Gift Card £25' }), true);
  assert.equal(isExcludedLine({ title: 'Final Sale Hoodie' }), true);
  assert.equal(isExcludedLine({ title: 'Squad Tee' }), false);
  const ex = evaluateReturn(order({ items: [merch('p', 'Personalised Name Tee', { productType: 'tshirt' })] }), { now: NOW, clothing: true });
  assert.equal(ex.lines[0].returnable, 0, 'no change of mind on a personalised item');
  assert.equal(ex.lines[0].claimable, 1, 'but a fault can be reported');

  const abroad = evaluateReturn(order({ shippingAddress: { country: 'FR' } }), { now: NOW, clothing: true });
  assert.equal(abroad.lines[0].why, OVERSEAS_EMAIL_US);
  assert.equal(abroad.lines[0].claimable, 1, 'a claim needs no label, so it works abroad');

  const off = evaluateReturn(order(), { now: NOW, clothing: false });
  assert.equal(off.eligible, false);
  assert.equal(off.reason, CLOTHING_EMAIL_US);
});

test('pickLines: per-item reasons; faulty only on merchandise; routes split by kind', () => {
  const v = evaluateReturn(order({ items: [poster('a'), tee(), hoodie()], inhouseStatus: 'dispatched' }), { now: NOW, clothing: true });
  const art = pickLines(v, [{ lineKey: 'a', quantity: 1, reason: FAULTY }]);
  assert.match(art.error, /faulty or damaged print, email/);
  const picked = pickLines(v, [
    { lineKey: 'a', quantity: 1, reason: 'changed_mind' },
    { lineKey: 't', quantity: 1, reason: 'wrong_choice' },
    { lineKey: 'h', quantity: 1, reason: FAULTY },
  ]);
  assert.equal(picked.error, undefined);
  assert.deepEqual(returnRoutes(picked.lines).map((r) => [r.kind, r.lines.map((l) => l.lineKey)]), [['claim', ['h']], ['art', ['a']], ['merch', ['t']]]);
  assert.equal(picked.lines.find((l) => l.lineKey === 't').band, 'X1');
});

/* ------------------------------------------------------------------ the API */

function returnsReq(body) { return new Request(`${SITE}/api/returns`, { method: 'POST', body: JSON.stringify(body), headers: { 'x-nf-client-connection-ip': '1.2.3.4' } }); }

function setup(doc) {
  const sanity = fakeSanity({ [doc._id]: doc }, {
    fetch: async (q, params, store) => {
      if (q.includes('returnRequest')) return [...store.values()].filter((d) => d._type === 'returnRequest' && d.orderId === params.id);
      const o = store.get(doc._id);
      if (params.r) return params.r === o.orderRef && params.e === o.customerEmail ? o : null;
      return params.id === o._id ? o : null;
    },
  });
  const resend = fakeResend();
  const quotes = [];
  const deps = {
    sanity, getResend: () => resend, shippingOn: true, clothing: true, env: ENV, now: () => NOW, log: quiet,
    turnstile: async () => ({ ok: true }), rateLimit: async () => true,
    quote: async (b) => { quotes.push(b); return { price: b.band === 'X2' ? 4.2 : b.band === 'X1' ? 2.95 : 3.5, currency: 'GBP' }; },
  };
  return { sanity, resend, quotes, deps };
}

async function lookup(deps) {
  const r = await handleReturns(returnsReq({ action: 'lookup', orderRef: '#ZQ9XK2BT', email: 'ada@example.com', turnstile: 't' }), deps);
  assert.equal(r.status, 200);
  return r.body;
}
const submit = (deps, session, lines, extra = {}) => handleReturns(returnsReq({ action: 'submit', session, lines, mv_ret_ts_load: 0, mv_ret_ts_submit: 10000, ...extra }), deps);
const returnsIn = (sanity) => [...sanity.store.values()].filter((d) => d._type === 'returnRequest').sort((a, b) => a.returnNumber.localeCompare(b.returnNumber));

test('change of mind on a tee: quote shown before submit (X1), request with band, label bought and postage deducted', async () => {
  const { sanity, resend, quotes, deps } = setup(order());
  const found = await lookup(deps);
  assert.equal(found.lines[0].merch, true);
  assert.equal(found.lines[0].returnable, 1);
  assert.equal(found.merchWindowEndsOn, longDate(LAST_DAY));
  assert.equal(found.faulty.key, FAULTY);

  const lines = [{ lineKey: 't', quantity: 1, reason: 'wrong_choice' }];
  const q = await handleReturns(returnsReq({ action: 'quote', session: found.session, lines }), deps);
  assert.equal(q.body.postage, 2.95);
  assert.equal(q.body.claim, false);
  assert.deepEqual(quotes[0], { band: 'X1', postalCode: 'LS1 1AA', countryCode: 'GB' });

  const s = await submit(deps, found.session, lines, { shownParts: { merch: 2.95 } });
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.returnNumbers, ['#ZQ9XK2BT-R1']);
  const [ret] = returnsIn(sanity);
  assert.equal(ret.type, 'return');
  assert.equal(ret.band, 'X1');
  assert.equal(ret.quotedPostage, 2.95);
  assert.equal(ret.shippedAt, '2026-11-04T09:00:00.000Z');
  assert.equal(ret.windowEndsOn, longDate(LAST_DAY));
  assert.equal(ret.deliveryDateUnknown, false);
  assert.equal(resend.sent.length, 1, 'team email only');
  assert.equal(resend.sent[0].to[0], TEAM);

  // Alan approves: the label is bought in band X1 and the deduction emailed.
  sanity.store.get(ret._id).status = 'approved';
  const calls = [];
  const resend2 = fakeResend();
  const r = await processReturn(ret._id, {
    sanity, getResend: () => resend2, log: quiet, now: () => NOW, fetchLabel: async () => Buffer.from('%PDF'),
    shipping: async (path, body) => { calls.push({ path, body }); return { carrier: 'inpost_gb', labelId: 'RL9', trackingNumber: 'IP9', quotedPrice: { amount: 2.95, currency: 'GBP' }, customerInstructions: 'Drop at any InPost Locker' }; },
  });
  assert.equal(r.outcome, 'label_sent');
  assert.equal(calls[0].path, 'create-return');
  assert.equal(calls[0].body.band, 'X1');
  assert.equal(sanity.store.get(ret._id).postageDeduction, 2.95);
  assert.match(resend2.sent[0].html, /£2\.95 return postage will be deducted/);
  assert.equal(resend2.sent[0].attachments.length, 1);
});

test('faulty hoodie: a Printful claim, no label, no quote; photo by reply; approve -> replacement email; refund instead', async () => {
  const { sanity, resend, quotes, deps } = setup(order({ items: [hoodie()] }));
  const found = await lookup(deps);
  assert.equal(found.lines[0].claimable, 1);
  const lines = [{ lineKey: 'h', quantity: 1, reason: FAULTY }];
  const q = await handleReturns(returnsReq({ action: 'quote', session: found.session, lines }), deps);
  assert.equal(q.body.postage, 0);
  assert.equal(q.body.claim, true);
  assert.equal(quotes.length, 0, 'nothing is posted back, so nothing is quoted');

  const s = await submit(deps, found.session, lines, { notes: 'Print peeling after one wear' });
  assert.equal(s.status, 200);
  assert.equal(s.body.claim, true);
  assert.equal(s.body.label, false);
  const [claim] = returnsIn(sanity);
  assert.equal(claim.type, 'printfulClaim');
  assert.equal(claim.band, undefined);
  assert.equal(claim.printfulOrderId, '987');
  assert.equal(claim.claimDeadline, addDays('2026-11-04', PRINTFUL_CLAIM_DAYS));
  assert.equal(claim.claimOverdue, false);
  assert.equal(claim.claimResolution, 'replacement');
  assert.equal(claim.refundAmount, 39.99);
  const team = resend.sent.find((m) => m.to[0] === TEAM);
  assert.match(team.subject, /Printful claim #ZQ9XK2BT-R1/);
  assert.match(team.html, /#987/);
  assert.match(team.html, new RegExp(longDate(claim.claimDeadline)));
  const cust = resend.sent.find((m) => m.to[0] === 'ada@example.com');
  assert.match(cust.html, /reply to this email with a photo/i);
  assert.equal(cust.reply_to, SITE_CONFIG.EMAIL_REPLY_TO, 'the photo comes back to the brand inbox');

  // The router starts the job once when it is approved.
  assert.deepEqual(routeFor({ ...claim, status: 'approved', before: { status: 'requested' } }).actions, ['shipping-return']);
  assert.deepEqual(routeFor({ ...claim, status: 'approved', claimEmailSentAt: 'x', before: { status: 'approved' } }).actions, []);

  sanity.store.get(claim._id).status = 'approved';
  const out = fakeResend();
  let bought = 0;
  const deps2 = { sanity, getResend: () => out, log: quiet, now: () => NOW, fetchLabel: async () => { throw new Error('no label'); }, shipping: async () => { bought += 1; return {}; } };
  assert.equal((await processReturn(claim._id, deps2)).outcome, 'replacement_sent');
  assert.equal(bought, 0, 'no label is ever bought for a claim');
  assert.match(out.sent[0].subject, /replacement is on its way/);
  assert.doesNotMatch(out.sent[0].html, /refund/i);
  assert.equal(sanity.store.get(claim._id).status, 'replacement_sent');
  assert.equal((await processReturn(claim._id, deps2)).outcome, 'ignored', 'emailed once');

  // Refund instead.
  const s2 = setup(order({ items: [hoodie()] }));
  const f2 = await lookup(s2.deps);
  await submit(s2.deps, f2.session, lines);
  const [c2] = returnsIn(s2.sanity);
  Object.assign(s2.sanity.store.get(c2._id), { status: 'approved', claimResolution: 'refund' });
  const out2 = fakeResend();
  assert.equal((await processReturn(c2._id, { ...deps2, sanity: s2.sanity, getResend: () => out2 })).outcome, 'refund_due');
  assert.match(out2.sent[0].html, /£39\.99/);
  assert.equal(s2.sanity.store.get(c2._id).status, 'refund_due');
});

test('faulty report past Printful\'s deadline is still taken, flagged overdue', async () => {
  const late = Date.parse(`${addDays('2026-11-04', PRINTFUL_CLAIM_DAYS + 2)}T12:00:00Z`);
  const { sanity, resend, deps } = setup(order({ items: [hoodie()] }));
  deps.now = () => late;
  const found = await lookup(deps);
  assert.equal(found.lines[0].returnable, 0);
  assert.equal(found.lines[0].claimable, 1);
  await submit(deps, found.session, [{ lineKey: 'h', quantity: 1, reason: FAULTY }]);
  const [claim] = returnsIn(sanity);
  assert.equal(claim.claimOverdue, true);
  assert.match(resend.sent.find((m) => m.to[0] === TEAM).html, /Past Printful's deadline/);
});

test('mixed request: wall art + tee by label, faulty hoodie as a claim — one request per route, postage summed', async () => {
  const doc = order({
    items: [poster('a'), tee(), hoodie()],
    hasInhouse: true, inhouseStatus: 'dispatched',
    shipmentResult: { dispatchedAt: '2026-11-03T10:00:00Z', deliveredAt: '2026-11-05T10:00:00Z' },
  });
  const { sanity, resend, quotes, deps } = setup(doc);
  const found = await lookup(deps);
  const lines = [
    { lineKey: 'a', quantity: 1, reason: 'doesnt_suit' },
    { lineKey: 't', quantity: 1, reason: 'changed_mind' },
    { lineKey: 'h', quantity: 1, reason: FAULTY },
  ];
  const q = await handleReturns(returnsReq({ action: 'quote', session: found.session, lines }), deps);
  assert.deepEqual(q.body.parts.map((x) => [x.kind, x.band, x.postage]), [['art', 'P4', 3.5], ['merch', 'X1', 2.95]]);
  assert.equal(q.body.postage, 6.45);
  assert.equal(q.body.claim, true);
  assert.deepEqual(quotes.map((x) => x.band), ['P4', 'X1']);

  const s = await submit(deps, found.session, lines, { shownParts: { art: 3.5, merch: 2.95 } });
  assert.deepEqual(s.body.returnNumbers, ['#ZQ9XK2BT-R1', '#ZQ9XK2BT-R2', '#ZQ9XK2BT-R3']);
  const [claim, art, mer] = returnsIn(sanity);
  assert.equal(claim.type, 'printfulClaim');
  assert.deepEqual(claim.lines.map((l) => l.lineKey), ['h']);
  assert.equal(art.type, 'return');
  assert.equal(art.band, 'P4');
  assert.equal(art.quotedPostage, 3.5);
  assert.equal(art.deliveryDateUnknown, false);
  assert.deepEqual(mer.lines.map((l) => l.lineKey), ['t']);
  assert.equal(mer.band, 'X1');
  assert.equal(mer.quotedPostage, 2.95);
  // Three team emails and the claim's photo request.
  assert.equal(resend.sent.filter((m) => m.to[0] === TEAM).length, 3);
  assert.equal(resend.sent.filter((m) => m.to[0] === 'ada@example.com').length, 1);

  // Asking again: nothing left to return or report.
  const again = await lookup(deps);
  assert.equal(again.eligible, false);
});
