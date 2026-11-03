// Sendcloud wall-art dispatch, tracking and returns (metavision-shipping).
// Everything runs against fakes: no network, no Sanity, no Resend.
//
// The same file runs in The Fuglys, Labrats, Cats On Crack and The Biker
// Babies: brand values are read from _shared/site-config.mjs, never typed in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeSanity, fakeResend, quiet } from './_fake-sanity.mjs';

import {
  proposeParcelPlan, validateParcelPlan, bandOfLine, returnBandFor, parcelItems, recipientFor, mapCarrier, ALL_BANDS,
} from '../netlify/functions/_shared/parcel-plan.mjs';
import { orderRefFor, normaliseOrderRef, orderRefFromSession, bareOrderRef } from '../netlify/functions/_shared/order-ref.mjs';
import {
  signLabelLink, verifyLabelLink, shippingInternalKey, isShippingInternal, labelLinkStale, SHIPPING_INTERNAL_HEADER, returnsSessionKey,
} from '../netlify/functions/_shared/shipping-internal.mjs';
import { routeFor, runRoute, DISPATCH_EMAIL_SINCE } from '../netlify/functions/_shared/orders-router.mjs';
import { orderNotDue, buildDispatchEmail, sendDispatchEmail, MIXED_ORDER_NOTE } from '../netlify/functions/_shared/dispatch-email.mjs';
import { dispatchShipment, proposePlanPatch } from '../netlify/functions/_shared/shipping-dispatch.mjs';
import { parcelEventPatch, applyParcelEvent, applyReturnEvent } from '../netlify/functions/_shared/shipping-events.mjs';
import {
  evaluateReturn, pickLines, CLOTHING_EMAIL_US, OVERSEAS_EMAIL_US, NOT_DISPATCHED, RETURN_WINDOW_DAYS,
} from '../netlify/functions/_shared/returns-eligibility.mjs';
import { handleReturns, issueSession } from '../netlify/functions/_shared/returns-api.mjs';
import { processReturn } from '../netlify/functions/_shared/shipping-returns.mjs';
import { setting, intSetting, flag, sanityWriteToken, SITE_CONFIG } from '../netlify/functions/_shared/site-config.mjs';
import { shippingEnabled, sign, verifyShippingCallback, shippingRequest, testOrderFlag } from '../netlify/functions/_shared/shipping-client.mjs';

// The wall-art dispatch email now starts the post-delivery sequence
// (afterDispatchEmail -> post-delivery.mjs). Never with real keys from the shell.
delete process.env.STRIPE_SECRET_KEY;
delete process.env.MAILERLITE_API_KEY;

const ENV = { SHIPPING_SECRET: 'test-shipping-secret' };
const NOW = Date.parse('2026-11-10T12:00:00Z');
const TEAM = SITE_CONFIG.TEAM_EMAIL;
const BRAND = SITE_CONFIG.SHIPPING_BRAND;
const SITE = SITE_CONFIG.SITE_URL;

/* ------------------------------------------------------------------ fixtures */

// Lines as stripe-webhook.cjs writes them: format id in colour, size id in size.
const poster = (key, size, qty = 1, price = 12.99) => ({ _key: key, _type: 'lineItem', title: `Art ${key} — Poster Print · ${size}`, colour: 'poster', size, quantity: qty, price: price * qty, fulfilment: 'inhouse' });
const canvas = (key, size, kind = 'canvas-standard', qty = 1) => ({ _key: key, _type: 'lineItem', title: `Art ${key} — Canvas · ${size}`, colour: kind, size, quantity: qty, price: 44.99 * qty, fulfilment: 'inhouse' });
const tee = (key, title = 'Squad Tee (L)', qty = 1) => ({ _key: key, _type: 'lineItem', title, colour: 'Black', size: 'L', quantity: qty, price: 24.99 * qty, fulfilment: 'printful' });

const order = (over = {}) => ({
  _id: 'order.abc', _type: 'order', orderRef: 'ZQ9XK2BT', stripeSessionId: 'cs_test_aaaaaaaazq9xk2bt',
  placedAt: '2026-11-02T10:00:00Z', customerName: 'Ada Lovelace', customerEmail: 'ada@example.com',
  status: 'inhouse', hasInhouse: true, inhouseStatus: 'to-make',
  shippingAddress: { name: 'Ada Lovelace', line1: '2 Road', city: 'Leeds', postalCode: 'LS1 1AA', country: 'GB' },
  items: [poster('l1', 'large')],
  ...over,
});

// The Printful side of a mixed order, as printful-webhook.mjs leaves it.
const PRINTFUL_FIELDS = { status: 'shipped', printfulOrderId: '987', carrier: 'ROYAL MAIL', trackingNumber: 'PF-RM-1', trackingUrl: 'https://track.test/PF', shippedAt: '2026-11-04T09:00:00Z' };
const assertPrintfulUntouched = (doc) => {
  for (const [k, v] of Object.entries(PRINTFUL_FIELDS)) assert.equal(doc[k], v, `Printful's ${k} must not change`);
};

/* ------------------------------------------------------------------ config & refs */

test('site-config: committed values, env override, numbers and flags', () => {
  assert.ok(['FUGLYS', 'LABRATS', 'COC', 'BIKERBABIES'].includes(setting('SHIPPING_BRAND', {})));
  assert.equal(setting('SHIPPING_BRAND', { SHIPPING_BRAND: 'X' }), 'X');
  assert.equal(intSetting('POSTER_EXTRA_WEIGHT_G', 0, {}), 0);
  assert.equal(flag('RETURNS_CLOTHING', {}), true, 'merchandise returns switched on (feat/merch-returns)');
  assert.equal(flag('RETURNS_CLOTHING', { RETURNS_CLOTHING: 'false' }), false, 'the env var can still switch them off');
  assert.equal(sanityWriteToken({ SANITY_TOKEN: 'b' }), 'b');
  assert.equal(sanityWriteToken({ SANITY_API_TOKEN: 'a', SANITY_TOKEN: 'b' }), 'a');
  assert.equal(setting('RETURN_POINT_INPOST', {}), 'InPost locker, 59 West Road, Shoeburyness');
  assert.equal(setting('RETURN_POINT_EVRI', {}), 'ASDA Shoebury, North Shoebury Road');
  assert.equal(setting('RETURN_POINT_UPS', {}), 'Skanda, 93-95 West Road, Shoeburyness');
  assert.throws(() => setting('NOPE', {}));
});

test('site-config holds nothing that looks like a secret', () => {
  for (const [k, v] of Object.entries(SITE_CONFIG)) {
    assert.doesNotMatch(k, /SECRET|TOKEN|API_KEY|PASSWORD/, k);
    assert.doesNotMatch(String(v), /^(sk|rk|re|whsec)_|^sk[A-Za-z0-9]{20,}/, k);
  }
});

test('SHIPPING_ENABLED unset means off', () => {
  assert.equal(shippingEnabled({}), false);
  assert.equal(shippingEnabled({ SHIPPING_ENABLED: '' }), false);
  assert.equal(shippingEnabled({ SHIPPING_ENABLED: 'true' }), true);
});

test('order reference: #XXXXXXXX as customers already see it; matched with or without #', () => {
  assert.equal(orderRefFor({ orderRef: 'ZQ9XK2BT' }), '#ZQ9XK2BT');
  assert.equal(orderRefFor({ stripeSessionId: 'cs_live_a1b2zq9xk2bt' }), '#ZQ9XK2BT');
  assert.equal(bareOrderRef({ orderRef: 'ZQ9XK2BT' }), 'ZQ9XK2BT');
  assert.equal(orderRefFromSession('cs_test_abcdefgh12345678'), '#12345678');
  for (const typed of ['#ZQ9XK2BT', 'ZQ9XK2BT', ' zq9xk2bt ', '# ZQ9X K2BT']) assert.equal(normaliseOrderRef(typed), 'ZQ9XK2BT');
  assert.equal(normaliseOrderRef('#123'), null);
  assert.equal(normaliseOrderRef('WF-ZQ9XK2BT'), null);
});

/* ------------------------------------------------------------------ bands & plan */

test('bands: format x size id, printed sizes, portrait = landscape', () => {
  assert.equal(bandOfLine(poster('a', 'small')), 'P1');
  assert.equal(bandOfLine(poster('a', 'medium')), 'P3');
  assert.equal(bandOfLine(poster('a', 'large')), 'P4');
  assert.equal(bandOfLine(canvas('a', 'small')), 'CS1');
  assert.equal(bandOfLine(canvas('a', 'medium')), 'CS3');
  assert.equal(bandOfLine(canvas('a', 'large', 'canvas-gallery')), 'CG4');
  assert.equal(bandOfLine(canvas('a', 'medium', 'canvas-gallery')), 'CG3');
  assert.equal(bandOfLine(poster('a', '8x12')), 'P1');
  assert.equal(bandOfLine(poster('a', '12x18')), 'P3');
  assert.equal(bandOfLine(poster('a', '16x12')), 'P3'); // Medium before 1 Nov 2026
  assert.equal(bandOfLine(poster('a', '16x24')), 'P4');
  assert.equal(bandOfLine(poster('a', 'xl')), null);
  assert.equal(bandOfLine({ fulfilment: 'inhouse', colour: 'poster', size: '20x30' }), null);
  assert.equal(bandOfLine({ fulfilment: 'inhouse', colour: 'framed-print', size: 'small' }), null);
});

test('plan: all posters in one tube at the largest band, extra weight per extra poster', () => {
  const { plan, problems } = proposeParcelPlan([poster('a', 'small'), poster('b', 'medium', 2), tee('t')], { posterExtraWeightG: 70 });
  assert.deepEqual(problems, []);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].band, 'P3');
  assert.equal(plan[0].extraWeightG, 140); // 3 posters -> 2 extra
  assert.deepEqual(plan[0].items.map((i) => [i.lineKey, i.quantity]), [['a', 1], ['b', 2]]);
});

test('plan: a lone 12x8 poster goes flat at P1 with no extra weight', () => {
  const { plan, problems } = proposeParcelPlan([poster('a', 'small')], { posterExtraWeightG: 70 });
  assert.deepEqual(problems, []);
  assert.equal(plan[0].band, 'P1');
  assert.equal(plan[0].extraWeightG, undefined);
});

test('plan: several 12x8s only is a decision for Alan', () => {
  const { plan, problems } = proposeParcelPlan([poster('a', 'small', 2)], { posterExtraWeightG: 70 });
  assert.equal(plan[0].band, 'P1');
  assert.match(problems[0], /small \(12x8\) posters/);
});

test('plan: each canvas is its own parcel, after the tube', () => {
  const items = [canvas('c', 'large', 'canvas-standard', 2), poster('p', 'large'), canvas('g', 'small', 'canvas-gallery')];
  const { plan } = proposeParcelPlan(items);
  assert.deepEqual(plan.map((p) => [p.parcelRef, p.band]), [['1', 'P4'], ['2', 'CS4'], ['3', 'CS4'], ['4', 'CG1']]);
  assert.deepEqual(validateParcelPlan(plan, items), []);
});

test('plan: any other format or size is flagged, never guessed; merchandise is ignored', () => {
  const odd = { _key: 'x', title: 'Odd', colour: 'poster', size: '', quantity: 1, fulfilment: 'inhouse' };
  const framed = { _key: 'y', title: 'Framed', colour: 'framed-print', size: 'medium', quantity: 1, fulfilment: 'inhouse' };
  const { plan, problems } = proposeParcelPlan([odd, framed, tee('t')]);
  assert.equal(plan.length, 0);
  assert.equal(problems.length, 2);
  assert.ok(problems.every((p) => /no band for it/.test(p)));
  assert.match(validateParcelPlan([{ parcelRef: '1', band: 'P1', items: [] }], [odd])[0], /nothing in it/);
});

test('plan: outside the UK (posters or canvas) says dispatch by hand', () => {
  for (const items of [[poster('a', 'large')], [canvas('c', 'medium')]]) {
    const r = proposeParcelPlan(items, { country: 'FR' });
    assert.equal(r.international, true);
    assert.match(r.problems[0], /dispatch this one by hand/);
  }
});

test('validate: quantities must add up, bands known, extra weight within the service limit', () => {
  const items = [poster('a', 'large', 2)];
  const problems = validateParcelPlan([{ parcelRef: '1', band: 'P9', extraWeightG: 6000, items: [{ lineKey: 'a', quantity: 1 }] }], items);
  assert.ok(problems.some((p) => /not a known band/.test(p)));
  assert.ok(problems.some((p) => /2 ordered, 1 in the parcel plan/.test(p)));
  assert.ok(problems.some((p) => /0 to 5000 grams/.test(p)));
  assert.ok(ALL_BANDS.includes('X2'));
});

test('parcel items and recipient use the order shapes', () => {
  const items = [poster('a', 'large', 2, 16.99)];
  const [it] = parcelItems({ items: [{ lineKey: 'a', quantity: 2 }] }, items, { skuPrefix: BRAND });
  assert.equal(it.qty, 2);
  assert.equal(it.valueGBP, 33.98);
  assert.equal(it.sku, `${BRAND}-poster-large`);
  assert.match(it.description, /Poster Print/);
  assert.equal(recipientFor('', order().shippingAddress).postalCode, 'LS1 1AA');
  assert.equal(recipientFor('', order().shippingAddress).name, 'Ada Lovelace');
  assert.deepEqual(mapCarrier('royal_mailv2'), { carrier: 'royalmail', carrierOther: null });
  assert.deepEqual(mapCarrier('hermes_c2c_gb'), { carrier: 'evri', carrierOther: null });
});

test('return bands: posters share a tube, one canvas, one merchandise item, else Alan', () => {
  const l = (x, q = 1) => ({ ...x, formatKey: x.colour, quantity: q });
  assert.equal(returnBandFor([l(poster('a', 'small'))]), 'P1');
  assert.equal(returnBandFor([l(poster('a', 'small')), l(poster('b', 'large'))]), 'P4');
  assert.equal(returnBandFor([l(poster('a', 'small'), 2)]), null);
  assert.equal(returnBandFor([l(canvas('c', 'medium'))]), 'CS3');
  assert.equal(returnBandFor([l(canvas('c', 'medium'), 2)]), null);
  assert.equal(returnBandFor([{ ...tee('t'), quantity: 1 }]), 'X1');
  assert.equal(returnBandFor([{ ...tee('t', 'Lab Hoodie'), quantity: 1 }]), 'X2');
  assert.equal(returnBandFor([l(poster('a', 'small')), { ...tee('t'), quantity: 1 }]), null);
});

/* ------------------------------------------------------------------ keys & links */

test('internal keys: derived from SHIPPING_SECRET under separate labels, fail closed', () => {
  const k = shippingInternalKey(ENV);
  assert.ok(k && k.length === 48 && k !== ENV.SHIPPING_SECRET);
  assert.equal(shippingInternalKey({}), null);
  assert.equal(returnsSessionKey({}), null);
  assert.notEqual(returnsSessionKey(ENV).toString('hex').slice(0, 48), k, 'session key differs from the internal key');
  const req = (v) => ({ headers: new Headers(v ? { [SHIPPING_INTERNAL_HEADER]: v } : {}) });
  assert.equal(isShippingInternal(req(k), ENV), true);
  assert.equal(isShippingInternal(req('nope'), ENV), false);
  assert.equal(isShippingInternal(req(''), {}), false);
  // Another brand's key (same secret, other label) is not ours.
  assert.notEqual(shippingInternalKey({ ...ENV, SHIPPING_BRAND: 'OTHER' }), k);
});

test('label links: signed, 30 days, on the order, tamper-proof, expiry reported', () => {
  const link = signLabelLink('12345', { env: ENV, now: NOW });
  assert.ok(link.url.startsWith(`${SITE}/api/shipping-label?l=12345&x=`));
  assert.equal(Date.parse(link.expiresAt) - NOW, 30 * 86400000);
  const q = new URL(link.url).searchParams;
  assert.deepEqual(verifyLabelLink(q, { env: ENV, now: NOW }), { ok: true, labelId: '12345' });
  assert.deepEqual(verifyLabelLink(q, { env: ENV, now: NOW + 31 * 86400000 }), { ok: false, reason: 'expired' });
  const forged = new URLSearchParams(q); forged.set('l', '99999');
  assert.equal(verifyLabelLink(forged, { env: ENV, now: NOW }).reason, 'invalid');
  const later = new URLSearchParams(q); later.set('x', String(Number(q.get('x')) + 86400));
  assert.equal(verifyLabelLink(later, { env: ENV, now: NOW }).reason, 'invalid');
  assert.equal(verifyLabelLink(q, { env: { SHIPPING_SECRET: 'other' }, now: NOW }).reason, 'invalid');
  assert.equal(signLabelLink('1', { env: {} }), null);
  assert.equal(labelLinkStale(link.expiresAt, NOW), false);
  assert.equal(labelLinkStale(link.expiresAt, NOW + 29.5 * 86400000), true);
  assert.equal(labelLinkStale(undefined, NOW), true);
});

test('shipping callback signature: brand, freshness, constant-time', () => {
  const body = '{"kind":"parcel"}';
  const ts = String(Math.floor(NOW / 1000));
  const req = (h) => ({ headers: new Headers(h) });
  const good = { 'x-mv-timestamp': ts, 'x-mv-brand': BRAND.toLowerCase(), 'x-mv-signature': sign(ENV.SHIPPING_SECRET, ts, body) };
  assert.equal(verifyShippingCallback(req(good), body, { env: ENV, now: NOW }), true);
  assert.equal(verifyShippingCallback(req({ ...good, 'x-mv-brand': 'csc' }), body, { env: ENV, now: NOW }), false);
  assert.equal(verifyShippingCallback(req(good), body, { env: ENV, now: NOW + 10 * 60000 }), false);
  assert.equal(verifyShippingCallback(req(good), '{}', { env: ENV, now: NOW }), false);
});

/* ------------------------------------------------------------------ router */

const labelled = (over = {}) => order({
  parcelPlan: [{ parcelRef: '1', band: 'P4', items: [{ lineKey: 'l1', quantity: 1 }] }],
  shipmentResult: { state: 'label_created', parcels: [{ parcelRef: '1', labelId: '9', trackingNumber: 'T1', carrier: 'royal_mail' }], labelLinksExpireAt: new Date(NOW + 20 * 86400000).toISOString() },
  ...over,
});

test('router: hand dispatch with a wall-art tracking number sends the email (shipping on or off)', () => {
  const d = order({ inhouseStatus: 'dispatched', wallArtTrackingNumber: 'RM1', wallArtCarrier: 'royalmail', parcelPlan: [{}], before: { inhouseStatus: 'made', wallArtTrackingNumber: '' } });
  assert.deepEqual(routeFor(d, { now: NOW }).actions, ['dispatch-email']);
});

test("router: Printful's own tracking number never counts as a wall-art dispatch", () => {
  const d = order({ ...PRINTFUL_FIELDS, inhouseStatus: 'dispatched', parcelPlan: [{}], before: { inhouseStatus: 'made' } });
  assert.deepEqual(routeFor(d, { now: NOW }).actions, []);
  assert.match(routeFor(d, { now: NOW }).reason, /no wall-art tracking number yet/);
});

test('router: no email for orders already dispatched before the edit, or older than the cut-off without before()', () => {
  const was = order({ inhouseStatus: 'dispatched', wallArtTrackingNumber: 'RM1', parcelPlan: [{}], before: { inhouseStatus: 'dispatched', wallArtTrackingNumber: 'RM1' } });
  assert.deepEqual(routeFor(was, { now: NOW }).actions, []);
  const old = order({ inhouseStatus: 'dispatched', wallArtTrackingNumber: 'RM1', parcelPlan: [{}], placedAt: '2026-10-20T00:00:00Z' });
  assert.ok(old.placedAt < DISPATCH_EMAIL_SINCE);
  assert.deepEqual(routeFor(old, { now: NOW }).actions, []);
  assert.equal(DISPATCH_EMAIL_SINCE, '2026-11-01T00:00:00Z');
});

test('router: proposes a plan once for a new wall-art order', () => {
  assert.deepEqual(routeFor(order(), { now: NOW }).actions, ['plan']);
  assert.deepEqual(routeFor(order({ shipmentResult: { planProposedAt: 'x' } }), { now: NOW }).actions, []);
  assert.deepEqual(routeFor(order({ hasInhouse: false, items: [tee('t')] }), { now: NOW }).actions, []);
});

test('router: Ready to ship starts the labels; an exception retries only on a transition', () => {
  const ready = order({ parcelPlan: [{ parcelRef: '1' }], shipment: { status: 'ready_to_ship' }, before: { shipmentStatus: 'not_ready' } });
  assert.deepEqual(routeFor(ready, { now: NOW }).actions, ['shipping-dispatch']);
  const failed = { ...ready, shipmentResult: { state: 'exception' }, before: { shipmentStatus: 'ready_to_ship' } };
  assert.deepEqual(routeFor(failed, { now: NOW }).actions, []);
  assert.deepEqual(routeFor({ ...failed, before: { shipmentStatus: 'on_hold' } }, { now: NOW }).actions, ['shipping-dispatch']);
  const { before, ...noBefore } = failed;
  assert.deepEqual(routeFor(noBefore, { now: NOW }).actions, []);
});

test('router: labelled orders re-issue links only when expired AND moved into Ready to ship', () => {
  const fresh = labelled({ shipment: { status: 'ready_to_ship' }, before: { shipmentStatus: 'on_hold' } });
  assert.deepEqual(routeFor(fresh, { now: NOW }).actions, []);
  const stale = { ...fresh, shipmentResult: { ...fresh.shipmentResult, labelLinksExpireAt: new Date(NOW - 1000).toISOString() } };
  assert.deepEqual(routeFor(stale, { now: NOW }).actions, ['shipping-dispatch']);
  assert.deepEqual(routeFor({ ...stale, before: { shipmentStatus: 'ready_to_ship' } }, { now: NOW }).actions, []);
});

test('router: return requests retry by transition; drafts ignored', () => {
  assert.deepEqual(routeFor({ _id: 'returnRequest.r', _type: 'returnRequest', status: 'approved' }).actions, ['shipping-return']);
  assert.deepEqual(routeFor({ _id: 'returnRequest.r', _type: 'returnRequest', status: 'approved', error: 'x', before: { status: 'approved' } }).actions, []);
  assert.deepEqual(routeFor({ _id: 'returnRequest.r', _type: 'returnRequest', status: 'approved', error: 'x', before: { status: 'requested' } }).actions, ['shipping-return']);
  assert.deepEqual(routeFor({ _id: 'drafts.order.abc', _type: 'order' }).actions, []);
});

test('runRoute: with shipping off only the dispatch email runs', async () => {
  const calls = [];
  const d = order({ inhouseStatus: 'dispatched', wallArtTrackingNumber: 'RM1', shipment: { status: 'ready_to_ship' }, before: { inhouseStatus: 'made', shipmentStatus: 'not_ready' } });
  const r = await runRoute(d, {
    shippingOn: false, log: quiet, routeOpts: { now: NOW },
    sendDispatch: async () => { calls.push('email'); return { status: 200, reason: 'OK' }; },
    proposePlan: async () => { calls.push('plan'); return 'x'; },
    start: async (a) => { calls.push(a); return { ok: true }; },
  });
  assert.deepEqual(calls, ['email']);
  assert.match(r.body, /plan: shipping is not enabled/);
  assert.match(r.body, /shipping-dispatch: shipping is not enabled/);
});

test('runRoute: a background start that fails answers 502 so Sanity retries', async () => {
  const d = order({ parcelPlan: [{ parcelRef: '1' }], shipment: { status: 'ready_to_ship' }, before: { shipmentStatus: 'on_hold' } });
  const r = await runRoute(d, { shippingOn: true, log: quiet, routeOpts: { now: NOW }, sendDispatch: async () => ({}), proposePlan: async () => '', start: async () => ({ ok: false, error: 'HTTP 500' }) });
  assert.equal(r.status, 502);
});

/* ------------------------------------------------------------------ dispatch email */

test('dispatch email: due rules', () => {
  assert.equal(orderNotDue(order({ inhouseStatus: 'dispatched', wallArtTrackingNumber: 'RM1' })), null);
  assert.match(orderNotDue(order({ inhouseStatus: 'dispatched', wallArtTrackingNumber: 'RM1', dispatchEmailSentAt: 'x' })), /already sent/);
  assert.match(orderNotDue(order({ hasInhouse: false, items: [tee('t')], inhouseStatus: 'dispatched', wallArtTrackingNumber: 'X' })), /no wall art/);
  assert.match(orderNotDue(order({ inhouseStatus: 'dispatched', trackingNumber: 'PRINTFUL-1' })), /no wall-art tracking number/);
  assert.equal(orderNotDue(order({ shipmentResult: { dispatchedAt: 'x', parcels: [{ trackingNumber: 'T' }] } })), null);
});

test('dispatch email: lists only the wall art, says the rest ships separately on a mixed order', () => {
  const mixed = order({ ...PRINTFUL_FIELDS, items: [poster('l1', 'large'), tee('t1', 'Squad Tee (L)')], inhouseStatus: 'dispatched', wallArtTrackingNumber: 'RM123', wallArtCarrier: 'royalmail' });
  const { subject, html } = buildDispatchEmail(mixed);
  assert.equal(subject, `Your ${SITE_CONFIG.BRAND_SHORT} wall art is on its way — order #ZQ9XK2BT`);
  assert.match(html, /Art l1 — Poster Print/);
  assert.doesNotMatch(html, /Squad Tee/);
  assert.doesNotMatch(html, /PF-RM-1/, "Printful's tracking number is not the wall art's");
  assert.ok(html.includes(MIXED_ORDER_NOTE));
  assert.match(html, /royalmail\.com\/track-your-item\?trackNumber=RM123/);
  assert.ok(html.includes(SITE_CONFIG.BRAND_ACCENT), 'brand palette');
  assert.doesNotMatch(buildDispatchEmail({ ...mixed, items: [poster('l1', 'large')] }).html, /ship separately/);
});

test('dispatch email: sent once even when two callers race', async () => {
  const doc = order({ inhouseStatus: 'dispatched', wallArtTrackingNumber: 'RM1' });
  const sanity = fakeSanity({ [doc._id]: doc });
  const resend = fakeResend();
  const deps = { id: doc._id, sanity, getResend: () => resend, log: quiet, now: () => NOW };
  const [a, b] = await Promise.all([sendDispatchEmail(deps), sendDispatchEmail(deps)]);
  assert.equal(resend.sent.length, 1);
  assert.equal([a, b].filter((r) => r.sent).length, 1);
  assert.equal(resend.sent[0].from, setting('EMAIL_FROM', {}));
  assert.ok(sanity.store.get(doc._id).dispatchEmailSentAt);
  assert.equal((await sendDispatchEmail(deps)).reason, 'already sent');
});

test('dispatch email: a draft open in the Studio carries the stamp too (publishing cannot undo it)', async () => {
  const doc = order({ inhouseStatus: 'dispatched', wallArtTrackingNumber: 'RM1' });
  const sanity = fakeSanity({ [doc._id]: doc, [`drafts.${doc._id}`]: { ...doc, _id: `drafts.${doc._id}` } });
  await sendDispatchEmail({ id: doc._id, sanity, getResend: () => fakeResend(), log: quiet, now: () => NOW });
  assert.ok(sanity.store.get(`drafts.${doc._id}`).dispatchEmailSentAt);
});

test('dispatch email: a failed send gives the claim back and asks for a retry', async () => {
  const doc = order({ inhouseStatus: 'dispatched', wallArtTrackingNumber: 'RM1' });
  const sanity = fakeSanity({ [doc._id]: doc });
  const r = await sendDispatchEmail({ id: doc._id, sanity, getResend: () => fakeResend({ fail: true }), log: quiet, now: () => NOW });
  assert.equal(r.status, 500);
  assert.equal(sanity.store.get(doc._id).dispatchEmailClaimedAt, undefined);
  assert.equal(sanity.store.get(doc._id).dispatchEmailSentAt, undefined);
});

/* ------------------------------------------------------------------ labels */

function fakeShipping({ fail } = {}) {
  const calls = [];
  let n = 0;
  return {
    calls,
    fn: async (path, body) => {
      calls.push({ path, body });
      if (fail) throw Object.assign(new Error('band P4 has no sizes'), { code: 'band_not_configured' });
      n += 1;
      return { parcelId: 100 + n, shipmentId: `s${n}`, carrier: 'royal_mail', method: 'royal_mail:tracked48', trackingNumber: `TR${n}`, trackingUrl: `https://t/${n}`, labelId: `L${n}`, quotedPrice: { amount: 3.05, currency: 'GBP' }, declaredWeightG: 500 };
    },
  };
}

test('dispatch: one label per planned parcel, bare ref + extraWeightG to the service, signed links, team email', async () => {
  const items = [poster('a', 'small'), poster('b', 'large'), canvas('c', 'medium'), tee('t')];
  const doc = order({ ...PRINTFUL_FIELDS, items, shipment: { status: 'ready_to_ship' } });
  const sanity = fakeSanity({ [doc._id]: doc });
  const resend = fakeResend();
  const ship = fakeShipping();
  const r = await dispatchShipment(doc._id, { sanity, shipping: ship.fn, getResend: () => resend, env: { ...ENV, POSTER_EXTRA_WEIGHT_G: '70' }, now: () => NOW, log: quiet });
  assert.equal(r.outcome, 'label_created');
  assert.deepEqual(ship.calls.map((c) => [c.body.parcelRef, c.body.band, c.body.extraWeightG]), [['1', 'P4', 70], ['2', 'CS3', undefined]]);
  assert.equal(ship.calls[0].body.orderRef, 'ZQ9XK2BT');
  assert.ok(ship.calls.every((c) => c.body.items.every((i) => !/Squad Tee/.test(i.description))), 'merchandise never goes on a label');
  const saved = sanity.store.get(doc._id);
  assert.equal(saved.shipmentResult.state, 'label_created');
  assert.equal(saved.parcelPlan.length, 2);
  assert.ok(saved.shipmentResult.parcels.every((p) => verifyLabelLink(new URL(p.labelUrl).searchParams, { env: ENV, now: NOW }).ok));
  assert.equal(saved.shipmentResult.labelLinksExpireAt, new Date(Math.floor((NOW + 30 * 86400000) / 1000) * 1000).toISOString());
  assertPrintfulUntouched(saved);
  assert.equal(resend.sent.length, 1);
  assert.match(resend.sent[0].subject, /label ready — #ZQ9XK2BT \(2 parcels\)/);
  assert.equal(resend.sent[0].to[0], TEAM);
});

test('dispatch: outside the UK is refused with "dispatch by hand", nothing bought', async () => {
  const doc = order({ shipment: { status: 'ready_to_ship' }, items: [canvas('c', 'large')], shippingAddress: { ...order().shippingAddress, country: 'US' } });
  const sanity = fakeSanity({ [doc._id]: doc });
  const ship = fakeShipping();
  const r = await dispatchShipment(doc._id, { sanity, shipping: ship.fn, getResend: () => fakeResend(), env: ENV, now: () => NOW, log: quiet });
  assert.equal(r.outcome, 'exception');
  assert.equal(ship.calls.length, 0);
  assert.equal(sanity.store.get(doc._id).shipmentResult.international, true);
  assert.match(sanity.store.get(doc._id).shipmentResult.error, /dispatch this one by hand/);
});

test('dispatch: a service error is an exception, with the team told', async () => {
  const doc = order({ shipment: { status: 'ready_to_ship' } });
  const sanity = fakeSanity({ [doc._id]: doc });
  const resend = fakeResend();
  const r = await dispatchShipment(doc._id, { sanity, shipping: fakeShipping({ fail: true }).fn, getResend: () => resend, env: ENV, now: () => NOW, log: quiet });
  assert.equal(r.outcome, 'exception');
  assert.match(sanity.store.get(doc._id).shipmentResult.error, /band_not_configured/);
  assert.match(resend.sent[0].subject, /shipping problem/);
  assert.equal(sanity.store.get(doc._id).shipmentResult.dispatchClaimedAt, undefined);
});

test('dispatch: all labelled + links expired -> new links, no new labels', async () => {
  const doc = labelled({ shipment: { status: 'ready_to_ship' } });
  doc.shipmentResult.labelLinksExpireAt = new Date(NOW - 1).toISOString();
  const sanity = fakeSanity({ [doc._id]: doc });
  const resend = fakeResend();
  const ship = fakeShipping();
  const r = await dispatchShipment(doc._id, { sanity, shipping: ship.fn, getResend: () => resend, env: ENV, now: () => NOW, log: quiet });
  assert.equal(r.outcome, 'links_renewed');
  assert.equal(ship.calls.length, 0);
  assert.ok(sanity.store.get(doc._id).shipmentResult.parcels[0].labelUrl);
  assert.match(resend.sent[0].subject, /new label links/);
});

test('proposePlanPatch: writes the plan once, with problems and the international flag', () => {
  const p = proposePlanPatch(order({ items: [poster('a', 'small', 2)], shippingAddress: { country: 'US' } }), { env: {} });
  assert.equal(p.set.parcelPlan[0].extraWeightG, 0); // committed setting is 0
  assert.equal(p.set['shipmentResult.international'], true);
  assert.match(p.set['shipmentResult.planProblem'], /UK-only/);
  assert.equal(proposePlanPatch(order({ parcelPlan: [{}] })), null);
  assert.equal(proposePlanPatch(order({ hasInhouse: false, items: [tee('t')] })), null);
});

/* ------------------------------------------------------------------ tracking */

test("events: first scan stamps dispatch, fills the wall-art carrier/tracking, leaves Printful's fields alone", () => {
  const doc = labelled(PRINTFUL_FIELDS);
  const { effects, set } = parcelEventPatch(doc, { kind: 'parcel', orderRef: 'ZQ9XK2BT', parcelRef: '1', statusCode: 3, status: 'En route', at: 'a' }, { now: NOW });
  assert.equal(effects.firstScan, true);
  assert.equal(set.inhouseStatus, 'dispatched');
  assert.equal(set.wallArtTrackingNumber, 'T1');
  assert.equal(set.wallArtCarrier, 'royalmail');
  assert.equal(set['shipmentResult.state'], 'in_transit');
  for (const k of Object.keys(PRINTFUL_FIELDS)) assert.equal(set[k], undefined, `${k} untouched`);
});

test('events: a repeat is recognised; delivered stamps deliveredAt; exception alerts', () => {
  const doc = labelled();
  const e = { kind: 'parcel', parcelRef: '1', statusCode: 11, status: 'Delivered', at: 'b' };
  const first = parcelEventPatch(doc, e, { now: NOW });
  assert.equal(first.effects.delivered, true);
  assert.ok(first.set['shipmentResult.deliveredAt']);
  const again = parcelEventPatch({ ...doc, shipmentResult: { ...doc.shipmentResult, events: first.set['shipmentResult.events'] } }, e, { now: NOW });
  assert.equal(again.effects.duplicate, true);
  assert.equal(parcelEventPatch(doc, { ...e, statusCode: 62996, status: 'Exception', at: 'c' }).effects.alert, true);
});

test('events: first scan sends the customer email once, across repeats', async () => {
  const doc = labelled(PRINTFUL_FIELDS);
  const sanity = fakeSanity({ [doc._id]: doc }, { fetch: async (q, p) => (p.r === 'ZQ9XK2BT' ? [{ _id: doc._id, placedAt: doc.placedAt, labelled: true }] : []) });
  const resend = fakeResend();
  const e = { kind: 'parcel', orderRef: 'ZQ9XK2BT', parcelRef: '1', statusCode: 91, status: 'In transit', at: 'x' };
  const r1 = await applyParcelEvent(e, { sanity, getResend: () => resend, log: quiet, now: () => NOW });
  const r2 = await applyParcelEvent({ ...e, statusCode: 11, status: 'Delivered', at: 'y' }, { sanity, getResend: () => resend, log: quiet, now: () => NOW });
  assert.equal(r1.status, 200);
  assert.equal(r2.status, 200);
  const customer = resend.sent.filter((m) => m.to[0] === 'ada@example.com');
  assert.equal(customer.length, 1);
  assert.match(customer[0].subject, /wall art is on its way/);
  const saved = sanity.store.get(doc._id);
  assert.equal(saved.inhouseStatus, 'dispatched');
  assert.ok(saved.shipmentResult.deliveredAt);
  assertPrintfulUntouched(saved);
});

test('events: a return at the collection point tells the team which point', async () => {
  const ret = { _type: 'returnRequest', returnRef: 'ret-1', returnNumber: '#ZQ9XK2BT-R1', status: 'label_sent', carrier: 'inpost_gb', lines: [] };
  const sanity = fakeSanity({ 'returnRequest.ret-1': ret }, { fetch: async () => 'returnRequest.ret-1' });
  const resend = fakeResend();
  await applyReturnEvent({ kind: 'return', returnRef: 'ret-1', statusCode: 12, status: 'Awaiting customer pickup', at: 'z' }, { sanity, getResend: () => resend, log: quiet, now: () => NOW });
  assert.equal(sanity.store.get('returnRequest.ret-1').status, 'ready_to_collect');
  assert.match(resend.sent[0].html, /InPost locker, 59 West Road, Shoeburyness/);
  assert.equal(resend.sent[0].to[0], TEAM);
});

/* ------------------------------------------------------------------ returns */

const delivered = (over = {}) => order({ inhouseStatus: 'dispatched', shipmentResult: { dispatchedAt: '2026-11-03T10:00:00Z', deliveredAt: '2026-11-05T10:00:00Z' }, ...over });

test(`returns: wall art within ${RETURN_WINDOW_DAYS} days of delivery; merchandise says email us`, () => {
  assert.equal(RETURN_WINDOW_DAYS, 14);
  const v = evaluateReturn(delivered({ items: [poster('a', 'large'), tee('t')] }), { now: NOW });
  assert.equal(v.eligible, true);
  assert.equal(v.lines.find((l) => l.lineKey === 'a').returnable, 1);
  assert.equal(v.lines.find((l) => l.lineKey === 't').why, CLOTHING_EMAIL_US);
  assert.equal(v.windowEndsOn, '2026-11-19');
  assert.equal(v.deliveryDateUnknown, false);
  assert.equal(evaluateReturn(delivered(), { now: Date.parse('2026-11-19T22:00:00Z') }).eligible, true, 'the 14th day counts, UK time');
  const late = evaluateReturn(delivered(), { now: Date.parse('2026-11-20T09:00:00Z') });
  assert.equal(late.eligible, false);
  assert.match(late.reason, /ended on 19 November 2026/);
});

test('returns: merchandise switch on allows it from the Printful ship date, underwear noted', () => {
  const v = evaluateReturn(delivered({ items: [tee('t', 'Boxer Briefs')], status: 'shipped', shippedAt: '2026-11-04T09:00:00Z' }), { now: NOW, clothing: true });
  assert.equal(v.eligible, true);
  assert.equal(v.deliveryDateUnknown, false, 'merchandise is timed from the ship date, not flagged');
  assert.equal(v.shippedAt, '2026-11-04T09:00:00.000Z');
  assert.equal(v.underwear, true);
});

test('returns: overseas, not yet dispatched, already requested, hand-dispatched (flagged)', () => {
  assert.equal(evaluateReturn(delivered({ shippingAddress: { country: 'FR' } }), { now: NOW }).reason, OVERSEAS_EMAIL_US);
  assert.equal(evaluateReturn(order(), { now: NOW }).reason, NOT_DISPATCHED);
  const v = evaluateReturn(delivered(), { now: NOW, existing: [{ status: 'requested', lines: [{ lineKey: 'l1', quantity: 1 }] }] });
  assert.equal(v.eligible, false);
  assert.equal(v.reason, 'Already in a return request.');
  const hand = evaluateReturn(order({ inhouseStatus: 'dispatched' }), { now: NOW });
  assert.equal(hand.eligible, true);
  assert.equal(hand.deliveryDateUnknown, true);
});

test('returns: pickLines checks quantities', () => {
  const v = evaluateReturn(delivered({ items: [poster('a', 'large', 2)] }), { now: NOW });
  assert.match(pickLines(v, [{ lineKey: 'a', quantity: 3, reason: 'changed_mind' }]).error, /at most 2/);
  assert.equal(pickLines(v, [{ lineKey: 'a', quantity: 2 }], 'changed_mind').lines[0].formatKey, 'poster');
  assert.match(pickLines(v, [{ lineKey: 'a', quantity: 1 }]).error, /choose a reason/);
});

function returnsReq(body) { return new Request(`${SITE}/api/returns`, { method: 'POST', body: JSON.stringify(body), headers: { 'x-nf-client-connection-ip': '1.2.3.4' } }); }

test('returns API: off unless SHIPPING_ENABLED; lookup with or without #, postage shown before submit, submit', async () => {
  const doc = delivered({ items: [poster('a', 'large')] });
  const sanity = fakeSanity({ [doc._id]: doc }, {
    fetch: async (q, params, store) => {
      if (q.includes('returnRequest')) return [];
      const o = store.get(doc._id);
      if (params.r) return params.r === o.orderRef && params.e === o.customerEmail ? o : null;
      return params.id === o._id ? o : null;
    },
  });
  const resend = fakeResend();
  const quotes = [];
  const deps = {
    sanity, getResend: () => resend, shippingOn: true, env: ENV, now: () => NOW, log: quiet,
    turnstile: async () => ({ ok: true }), rateLimit: async () => true,
    quote: async (b) => { quotes.push(b); return { price: 2.57, currency: 'GBP' }; },
  };
  assert.equal((await handleReturns(returnsReq({ action: 'lookup' }), { ...deps, shippingOn: false })).status, 404);

  const miss = await handleReturns(returnsReq({ action: 'lookup', orderRef: '#ZQ9XK2BT', email: 'eve@example.com', turnstile: 't' }), deps);
  assert.equal(miss.status, 404);
  for (const typed of ['#ZQ9XK2BT', 'zq9xk2bt']) {
    const found = await handleReturns(returnsReq({ action: 'lookup', orderRef: typed, email: 'Ada@Example.com', turnstile: 't' }), deps);
    assert.equal(found.status, 200);
    assert.equal(found.body.orderNumber, '#ZQ9XK2BT');
  }
  const found = await handleReturns(returnsReq({ action: 'lookup', orderRef: '#ZQ9XK2BT', email: 'ada@example.com', turnstile: 't' }), deps);
  const session = found.body.session;

  const q = await handleReturns(returnsReq({ action: 'quote', session, lines: [{ lineKey: 'a', quantity: 1 }] }), deps);
  assert.equal(q.body.postage, 2.57);
  assert.deepEqual(quotes[0], { band: 'P4', postalCode: 'LS1 1AA', countryCode: 'GB' });

  const s = await handleReturns(returnsReq({ action: 'submit', session, lines: [{ lineKey: 'a', quantity: 1 }], reason: 'changed_mind', shownPostage: 2.57, mv_ret_ts_load: 0, mv_ret_ts_submit: 10000 }), deps);
  assert.equal(s.status, 200);
  assert.equal(s.body.returnNumber, '#ZQ9XK2BT-R1');
  const created = [...sanity.store.values()].find((d) => d._type === 'returnRequest');
  assert.match(created._id, /^returnRequest\.ret-[0-9a-f]{16}$/);
  assert.equal(created.band, 'P4');
  assert.equal(created.quotedPostage, 2.57);
  assert.match(resend.sent[0].subject, /return request #ZQ9XK2BT-R1/);
  assert.equal(resend.sent[0].to[0], TEAM);
});

test('returns API: honeypot and a too-fast submit are discarded; a tampered session is refused', async () => {
  const deps = { sanity: fakeSanity({}), getResend: () => null, shippingOn: true, env: ENV, now: () => NOW, log: quiet, turnstile: async () => ({ ok: true }), rateLimit: async () => true, quote: async () => ({}) };
  assert.equal((await handleReturns(returnsReq({ action: 'lookup', orderRef: '#ZQ9XK2BT', email: 'a@b.co', mv_ret_extra: 'bot' }), deps)).status, 404);
  assert.equal((await handleReturns(returnsReq({ action: 'lookup', orderRef: '#ZQ9XK2BT', email: 'a@b.co', mv_ret_ts_load: 1000, mv_ret_ts_submit: 1500 }), deps)).status, 404);
  const good = issueSession({ orderId: 'order.abc', email: 'ada@example.com' }, { env: ENV, now: NOW });
  const bad = good.slice(0, -2) + (good.endsWith('A') ? 'BB' : 'AA');
  assert.equal((await handleReturns(returnsReq({ action: 'quote', session: bad, lines: [] }), deps)).status, 400);
});

test('processReturn: approve buys the label (bare ref) and emails it with the deduction; reject emails the reason', async () => {
  const doc = delivered();
  const ret = { _type: 'returnRequest', returnRef: 'ret-1', returnNumber: '#ZQ9XK2BT-R1', orderId: doc._id, orderNumber: '#ZQ9XK2BT', customerName: 'Ada', customerEmail: 'ada@example.com', status: 'approved', band: 'P4', lines: [{ lineKey: 'l1', title: 'Art l1 — Poster Print · large', quantity: 1, unitPrice: 16.99 }] };
  const sanity = fakeSanity({ [doc._id]: doc, 'returnRequest.ret-1': ret });
  const resend = fakeResend();
  const calls = [];
  const deps = {
    sanity, getResend: () => resend, log: quiet, now: () => NOW,
    shipping: async (path, body) => { calls.push(body); return { carrier: 'inpost_gb', method: 'inpost_gb:l2l/size=m', labelId: 'RL1', trackingNumber: 'IP1', quotedPrice: { amount: 2.57, currency: 'GBP' }, customerInstructions: 'Drop at any InPost Locker' }; },
    fetchLabel: async () => Buffer.from('%PDF'),
  };
  const r = await processReturn('returnRequest.ret-1', deps);
  assert.equal(r.outcome, 'label_sent');
  assert.equal(calls[0].orderRef, 'ZQ9XK2BT');
  assert.equal(calls[0].customer.postalCode, 'LS1 1AA');
  const saved = sanity.store.get('returnRequest.ret-1');
  assert.equal(saved.status, 'label_sent');
  assert.equal(saved.postageDeduction, 2.57);
  assert.match(resend.sent[0].html, /£2\.57 return postage will be deducted/);
  assert.equal(resend.sent[0].attachments.length, 1);
  assert.equal((await processReturn('returnRequest.ret-1', deps)).outcome, 'ignored');

  const sanity2 = fakeSanity({ 'returnRequest.ret-2': { ...ret, returnRef: 'ret-2', status: 'rejected', rejectionReason: 'Used print' } });
  const resend2 = fakeResend();
  assert.equal((await processReturn('returnRequest.ret-2', { ...deps, sanity: sanity2, getResend: () => resend2 })).outcome, 'rejected');
  assert.match(resend2.sent[0].html, /Used print/);
});

test('processReturn: a free label (faulty print, raised in the Studio) deducts nothing', async () => {
  const doc = delivered();
  const ret = { _type: 'returnRequest', returnRef: 'ret-3', returnNumber: '#ZQ9XK2BT-R1', orderId: doc._id, orderNumber: '#ZQ9XK2BT', customerEmail: 'ada@example.com', status: 'approved', freeLabel: true, band: 'P4', lines: [{ lineKey: 'l1', title: 'Art', quantity: 1, unitPrice: 16.99 }] };
  const sanity = fakeSanity({ [doc._id]: doc, 'returnRequest.ret-3': ret });
  const resend = fakeResend();
  await processReturn('returnRequest.ret-3', {
    sanity, getResend: () => resend, log: quiet, now: () => NOW, fetchLabel: async () => Buffer.from('%PDF'),
    shipping: async () => ({ carrier: 'inpost_gb', labelId: 'RL3', quotedPrice: { amount: 2.57, currency: 'GBP' }, customerInstructions: 'x' }),
  });
  assert.equal(sanity.store.get('returnRequest.ret-3').postageDeduction, 0);
  assert.doesNotMatch(resend.sent[0].html, /will be deducted/);
  assert.match(resend.sent[0].html, /This label is free/);
});

/* ------------------------------------------------------------------ test-mode orders: free labels */

test('testOrderFlag: { test: true } only for an order with test === true', () => {
  assert.deepEqual(testOrderFlag(order({ test: true })), { test: true });
  for (const o of [order(), order({ test: false }), order({ test: 'true' }), null, undefined]) assert.deepEqual(testOrderFlag(o), {});
});

test('dispatch: a Stripe test-mode order asks the service for a test label; a live order does not', async () => {
  const run = async (over) => {
    const doc = order({ items: [poster('a', 'large')], shipment: { status: 'ready_to_ship' }, ...over });
    const ship = fakeShipping();
    const r = await dispatchShipment(doc._id, { sanity: fakeSanity({ [doc._id]: doc }), shipping: ship.fn, getResend: () => fakeResend(), env: ENV, now: () => NOW, log: quiet });
    assert.equal(r.outcome, 'label_created');
    return ship.calls;
  };
  const testCalls = await run({ test: true });
  assert.equal(testCalls[0].path, 'create-parcel');
  assert.equal(testCalls[0].body.test, true);
  const liveCalls = await run({});
  assert.equal('test' in liveCalls[0].body, false, 'a live order never sends test');
});

test('processReturn: the return of a test-mode order asks for a test label; a live order\'s does not', async () => {
  const run = async (over) => {
    const doc = delivered(over);
    const ret = { _type: 'returnRequest', returnRef: 'ret-t', returnNumber: '#ZQ9XK2BT-R1', orderId: doc._id, orderNumber: '#ZQ9XK2BT', customerName: 'Ada', customerEmail: 'ada@example.com', status: 'approved', band: 'P4', lines: [{ lineKey: 'l1', title: 'Art l1 — Poster Print · large', quantity: 1, unitPrice: 16.99 }] };
    const calls = [];
    const r = await processReturn('returnRequest.ret-t', {
      sanity: fakeSanity({ [doc._id]: doc, 'returnRequest.ret-t': ret }), getResend: () => fakeResend(), log: quiet, now: () => NOW,
      shipping: async (path, body) => { calls.push({ path, body }); return { carrier: 'inpost_gb', method: 'inpost_gb:l2l/size=m', labelId: 'RL1', trackingNumber: 'IP1', quotedPrice: { amount: 0, currency: 'GBP' } }; },
      fetchLabel: async () => Buffer.from('%PDF'),
    });
    assert.equal(r.outcome, 'label_sent');
    return calls;
  };
  const testCalls = await run({ test: true });
  assert.equal(testCalls[0].path, 'create-return');
  assert.equal(testCalls[0].body.test, true);
  assert.equal('test' in (await run({}))[0].body, false);
});

test('shippingRequest: a test order\'s flag reaches the service with SHIPPING_TEST_MODE off; a live body stays live', async () => {
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  await shippingRequest('create-parcel', { body: { orderRef: 'A', ...testOrderFlag({ test: true }) }, env: ENV, fetchImpl, now: NOW });
  await shippingRequest('create-parcel', { body: { orderRef: 'B', ...testOrderFlag({}) }, env: ENV, fetchImpl, now: NOW });
  assert.equal(sent[0].test, true);
  assert.equal('test' in sent[1], false);
});

test('team emails: a test-mode order\'s label email is [TEST] even with SHIPPING_TEST_MODE off; a live order\'s is not', async () => {
  const saved = process.env.SHIPPING_TEST_MODE;
  delete process.env.SHIPPING_TEST_MODE;
  try {
    const subjectFor = async (over) => {
      const doc = order({ items: [poster('a', 'large')], shipment: { status: 'ready_to_ship' }, ...over });
      const resend = fakeResend();
      await dispatchShipment(doc._id, { sanity: fakeSanity({ [doc._id]: doc }), shipping: fakeShipping().fn, getResend: () => resend, env: ENV, now: () => NOW, log: quiet });
      return resend.sent[0].subject;
    };
    assert.match(await subjectFor({ test: true }), /^\[TEST\] /);
    assert.doesNotMatch(await subjectFor({}), /\[TEST\]/);
  } finally { if (saved !== undefined) process.env.SHIPPING_TEST_MODE = saved; }
});
