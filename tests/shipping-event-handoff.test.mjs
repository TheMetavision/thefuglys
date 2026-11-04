// shipping-event answers fast and hands the signed event to
// shipping-event-background, which does the work once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeSanity, fakeResend, quiet } from './_fake-sanity.mjs';
import { sign } from '../netlify/functions/_shared/shipping-client.mjs';
import { SITE_CONFIG } from '../netlify/functions/_shared/site-config.mjs';
import {
  acceptShippingEvent, runShippingEvent, startEventBackground, eventHandoffKey, backgroundUrl,
  EVENT_HANDOFF_HEADER, BACKGROUND_MAX_SKEW_SECONDS,
} from '../netlify/functions/_shared/shipping-event-handoff.mjs';
import { applyParcelEvent, applyReturnEvent } from '../netlify/functions/_shared/shipping-events.mjs';

// The dispatch email starts the post-delivery sequence: never real keys here.
delete process.env.STRIPE_SECRET_KEY;
delete process.env.MAILERLITE_API_KEY;

const ENV = { SHIPPING_SECRET: 'test-shipping-secret', SHIPPING_ENABLED: 'true', URL: 'https://brand.example' };
const BRAND = SITE_CONFIG.SHIPPING_BRAND;
const NOW = Date.parse('2026-11-10T12:00:00Z');
const TS = String(Math.floor(NOW / 1000));

const EVENT = { kind: 'parcel', brand: BRAND.toLowerCase(), orderRef: 'ZQ9XK2BT', parcelRef: '1', parcelId: 5001, statusCode: 91, status: 'Parcel en route', trackingNumber: 'T1', at: '2026-11-10T11:59:00.000Z' };

function serviceRequest(body, { ts = TS, signature = sign(ENV.SHIPPING_SECRET, ts, body), url = 'https://brand.example/api/shipping-event', extra = {} } = {}) {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-mv-brand': BRAND.toLowerCase(), 'x-mv-timestamp': ts, 'x-mv-signature': signature, ...extra },
    body,
  });
}

/** What the fast function would send, rebuilt as the request the background one receives. */
function asBackgroundRequest(call) {
  return new Request(call.url, { method: 'POST', headers: call.init.headers, body: call.init.body });
}

const order = () => ({
  _id: 'order.abc', _type: 'order', orderRef: 'ZQ9XK2BT', placedAt: '2026-11-02T10:00:00Z',
  customerName: 'Ada Lovelace', customerEmail: 'ada@example.com', status: 'inhouse', hasInhouse: true, inhouseStatus: 'to-make',
  shippingAddress: { name: 'Ada Lovelace', line1: '2 Road', city: 'Leeds', postalCode: 'LS1 1AA', country: 'GB' },
  items: [{ _key: 'l1', _type: 'lineItem', title: 'Art l1 — Poster Print · large', colour: 'poster', size: 'large', quantity: 1, price: 12.99, fulfilment: 'inhouse' }],
  parcelPlan: [{ parcelRef: '1', band: 'P4', items: [{ lineKey: 'l1', quantity: 1 }] }],
  shipmentResult: { state: 'label_created', parcels: [{ parcelRef: '1', labelId: '9', trackingNumber: 'T1', carrier: 'royal_mail' }] },
});

function backgroundDeps() {
  const doc = order();
  const sanity = fakeSanity({ [doc._id]: doc }, { fetch: async (q, p) => (p.r === 'ZQ9XK2BT' ? [{ _id: doc._id, placedAt: doc.placedAt, labelled: true }] : []) });
  const resend = fakeResend();
  const deps = { sanity, getResend: () => resend, log: quiet, now: () => NOW };
  const apply = (e) => (e.kind === 'parcel' ? applyParcelEvent(e, deps) : applyReturnEvent(e, deps));
  return { sanity, resend, apply, doc };
}

/* ------------------------------------------------------------------ fast path */

test('fast path: a valid event is handed off unchanged and answered 200, no work done', async () => {
  const body = JSON.stringify(EVENT);
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 202 }); };
  const r = await acceptShippingEvent(serviceRequest(body), {
    env: ENV, now: NOW, log: quiet,
    start: (req, raw, o) => startEventBackground(req, raw, { ...o, fetchImpl }),
  });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1, 'only the background start leaves the fast path');
  assert.equal(calls[0].url, 'https://brand.example/.netlify/functions/shipping-event-background');
  assert.equal(calls[0].init.body, body, 'the same raw body');
  const h = calls[0].init.headers;
  assert.equal(h['x-mv-signature'], sign(ENV.SHIPPING_SECRET, TS, body));
  assert.equal(h['x-mv-timestamp'], TS);
  assert.equal(h[EVENT_HANDOFF_HEADER], eventHandoffKey(ENV));
});

test('fast path: shipping-event.mts imports nothing that reaches Sanity, Resend, Stripe or MailerLite', () => {
  const src = readFileSync(new URL('../netlify/functions/shipping-event.mts', import.meta.url), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./_shared/shipping-event-handoff.mjs']);
  const handoff = readFileSync(new URL('../netlify/functions/_shared/shipping-event-handoff.mjs', import.meta.url), 'utf8');
  const shared = [...handoff.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(shared, ['node:crypto', './shipping-client.mjs']);
});

test('fast path: bad signature is 401 at once and nothing is started', async () => {
  let started = false;
  const start = async () => { started = true; return { ok: true }; };
  const body = JSON.stringify(EVENT);
  const bad = await acceptShippingEvent(serviceRequest(body, { signature: 'f'.repeat(64) }), { env: ENV, now: NOW, start, log: quiet });
  assert.equal(bad.status, 401);
  const stale = await acceptShippingEvent(serviceRequest(body, { ts: String(Number(TS) - 301) }), { env: ENV, now: NOW, start, log: quiet });
  assert.equal(stale.status, 401, 'the fast path keeps the 5-minute window');
  assert.equal(started, false);
});

test('fast path: shipping off is 503; unknown kind ignored; a failed start is 503 so the service retries', async () => {
  const body = JSON.stringify(EVENT);
  const ok = async () => ({ ok: true });
  assert.equal((await acceptShippingEvent(serviceRequest(body), { env: { ...ENV, SHIPPING_ENABLED: '' }, now: NOW, start: ok, log: quiet })).status, 503);
  let started = false;
  const other = JSON.stringify({ ...EVENT, kind: 'nope' });
  const ignored = await acceptShippingEvent(serviceRequest(other), { env: ENV, now: NOW, start: async () => { started = true; return { ok: true }; }, log: quiet });
  assert.equal(ignored.status, 200);
  assert.equal(started, false);
  const failed = await acceptShippingEvent(serviceRequest(body), { env: ENV, now: NOW, start: async () => ({ ok: false, error: 'HTTP 500' }), log: quiet });
  assert.equal(failed.status, 503);
});

test('backgroundUrl: same origin locally, the site URL live', () => {
  assert.equal(backgroundUrl(new Request('http://localhost:8888/api/shipping-event'), { env: ENV }), 'http://localhost:8888/.netlify/functions/shipping-event-background');
  assert.equal(backgroundUrl(new Request('https://x--site.netlify.app/api/shipping-event'), { env: ENV }), 'https://brand.example/.netlify/functions/shipping-event-background');
});

/* ------------------------------------------------------------------ background path */

async function handOff(body = JSON.stringify(EVENT)) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 202 }); };
  await acceptShippingEvent(serviceRequest(body), { env: ENV, now: NOW, log: quiet, start: (req, raw, o) => startEventBackground(req, raw, { ...o, fetchImpl }) });
  return calls[0];
}

test('background path: does the work (first scan: Dispatched + one dispatch email)', async () => {
  const call = await handOff();
  const { sanity, resend, apply, doc } = backgroundDeps();
  const r = await runShippingEvent(asBackgroundRequest(call), { apply, env: ENV, now: NOW + 60_000, log: quiet });
  assert.equal(r.status, 200);
  assert.equal(r.retry, false);
  const saved = sanity.store.get(doc._id);
  assert.equal(saved.inhouseStatus, 'dispatched');
  assert.ok(saved.shipmentResult.dispatchedAt);
  assert.equal(resend.sent.filter((m) => m.to[0] === 'ada@example.com').length, 1);
});

test('background path: the same event delivered twice still sends one email', async () => {
  const { resend, apply } = backgroundDeps();
  for (let i = 0; i < 2; i++) {
    const call = await handOff();
    const r = await runShippingEvent(asBackgroundRequest(call), { apply, env: ENV, now: NOW, log: quiet });
    assert.equal(r.status, 200);
  }
  assert.equal(resend.sent.filter((m) => m.to[0] === 'ada@example.com').length, 1);
});

test('background path: a Netlify retry 3 minutes later still passes; a forged or keyless start does nothing', async () => {
  const call = await handOff();
  let applied = 0;
  const apply = async () => { applied++; return { status: 200, body: 'OK' }; };
  const late = await runShippingEvent(asBackgroundRequest(call), { apply, env: ENV, now: NOW + 3 * 60_000 + 30_000, log: quiet });
  assert.equal(late.status, 200);
  const tooLate = await runShippingEvent(asBackgroundRequest(call), { apply, env: ENV, now: NOW + (BACKGROUND_MAX_SKEW_SECONDS + 1) * 1000, log: quiet });
  assert.equal(tooLate.status, 401);
  const noKey = { ...call, init: { ...call.init, headers: { ...call.init.headers, [EVENT_HANDOFF_HEADER]: 'x'.repeat(48) } } };
  assert.equal((await runShippingEvent(asBackgroundRequest(noKey), { apply, env: ENV, now: NOW, log: quiet })).status, 403);
  const tampered = { ...call, init: { ...call.init, body: JSON.stringify({ ...EVENT, orderRef: 'OTHER123' }) } };
  assert.equal((await runShippingEvent(asBackgroundRequest(tampered), { apply, env: ENV, now: NOW, log: quiet })).status, 401);
  assert.equal(applied, 1);
});

test('background path: an outcome that used to be 5xx (dispatch email failed) asks for a retry', async () => {
  const call = await handOff();
  const r = await runShippingEvent(asBackgroundRequest(call), { apply: async () => ({ status: 503, body: 'Dispatch email not sent: refused' }), env: ENV, now: NOW, log: quiet });
  assert.equal(r.retry, true);
});
