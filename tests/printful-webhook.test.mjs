// Tests for the Printful → Sanity order sync (netlify/functions/printful-webhook.mjs).
//
// fetch is stubbed with a tiny in-memory Sanity and Resend, so nothing leaves the machine.
//
//   npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../netlify/functions/printful-webhook.mjs';

const quiet = () => {};
const logs = [];
console.log = quiet; console.warn = quiet;
console.error = (...a) => { logs.push(a.join(' ')); };

const SECRET = 'whsec_test';
const SESSION_KEY = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6'; // last 32 chars of a Stripe session id

// In-memory Sanity: orders keyed by _id, _rev bumped on every patch and
// ifRevisionID enforced (409 on mismatch). Resend just accepts the email.
// Records every request.
let orders, calls, rev;
function sanityFetch(url, init = {}) {
  const u = new URL(url);
  calls.push({ url: u, init });
  if (u.hostname === 'api.resend.com') {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'em_1' }), text: async () => '' });
  }
  assert.ok(init.headers.Authorization.startsWith('Bearer '), 'Sanity calls are authenticated');
  if (u.pathname.includes('/data/query/')) {
    const q = u.searchParams.get('query');
    const p = (k) => (u.searchParams.has('$' + k) ? JSON.parse(u.searchParams.get('$' + k)) : undefined);
    let hit;
    if (q.includes('printfulOrderId == $pid')) hit = Object.values(orders).find((o) => o.printfulOrderId === p('pid'));
    else if (q.includes('_id in [$a, $b]')) hit = orders[p('a')] || orders[p('b')];
    // A copy, like a real response: later patches don't change what was read.
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ result: hit ? structuredClone(hit) : null }) });
  }
  if (u.pathname.includes('/data/mutate/')) {
    for (const { patch } of JSON.parse(init.body).mutations) {
      if (patch.ifRevisionID && patch.ifRevisionID !== orders[patch.id]._rev) {
        return Promise.resolve({ ok: false, status: 409, text: async () => 'revision mismatch' });
      }
      Object.assign(orders[patch.id], patch.set, { _rev: 'rev' + ++rev });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  }
  throw new Error('unexpected fetch ' + url);
}
const mutations = () => calls.filter((c) => c.url.pathname.includes('/data/mutate/'));
const emails = () => calls.filter((c) => c.url.hostname === 'api.resend.com').map((c) => JSON.parse(c.init.body));

beforeEach(() => {
  orders = {
    [`order.${SESSION_KEY}`]: {
      _id: `order.${SESSION_KEY}`, _rev: 'rev0', _type: 'order', orderRef: 'M3N4O5P6', status: 'fulfilled', printfulOrderId: '987654',
      customerName: 'Grimy Gus', customerEmail: 'gus@example.com',
    },
  };
  rev = 0;
  calls = [];
  logs.length = 0;
  globalThis.fetch = sanityFetch;
  process.env.PRINTFUL_WEBHOOK_SECRET = SECRET;
  process.env.SANITY_API_TOKEN = 'sk_api';
  delete process.env.SANITY_TOKEN;
  process.env.RESEND_API_KEY = 're_test';
  process.env.ORDER_EMAIL_FROM = 'The Fuglys <shop@thefuglys.com>';
  process.env.NOTIFICATION_FROM = 'Shop alerts <alerts@example.com>'; // the merchant alert's sender, not used here
  process.env.BRAND_NAME = 'The Fuglys';
  process.env.BRAND_ACCENT = '#7a0f24';
  process.env.EMAIL_ACCENT = '#123456';
  process.env.EMAIL_HEADER_BG = '#000000';
  process.env.LOGO_URL = 'https://thefuglys.com/email-logo.png';
});

const req = (body, { key = SECRET, method = 'POST' } = {}) =>
  new Request(`https://thefuglys.com/.netlify/functions/printful-webhook${key == null ? '' : '?key=' + encodeURIComponent(key)}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });

const shipped = (over = {}) => ({
  type: 'package_shipped',
  data: {
    order: { id: 987654, external_id: SESSION_KEY },
    shipment: { carrier: 'ROYAL MAIL', tracking_number: 'RM123456789GB', tracking_url: 'https://track.test/RM123456789GB', shipped_at: 1790000000, ...over },
  },
});
const failed = (reason = 'Out of stock', order = { id: 987654, external_id: SESSION_KEY }) =>
  ({ type: 'order_failed', data: { order, reason } });

/* ── package_shipped ───────────────────────────────────────────────────── */

test('package_shipped patches status, carrier, tracking number/URL and shipped date', async () => {
  const res = await handler(req(shipped()));
  assert.equal(res.status, 200);
  assert.equal(mutations().length, 1);
  assert.deepEqual(JSON.parse(mutations()[0].init.body), {
    mutations: [{ patch: { id: `order.${SESSION_KEY}`, ifRevisionID: 'rev0', set: {
      status: 'shipped', carrier: 'ROYAL MAIL', trackingNumber: 'RM123456789GB',
      trackingUrl: 'https://track.test/RM123456789GB', shippedAt: new Date(1790000000 * 1000).toISOString(),
    } } }],
  });
  assert.equal(orders[`order.${SESSION_KEY}`].status, 'shipped');
  // Only Sanity and Resend were contacted.
  assert.ok(calls.every((c) => ['ngx60q2x.api.sanity.io', 'api.resend.com'].includes(c.url.hostname)));
});

test('falls back to matching external_id against the order _id (old order- prefix too)', async () => {
  orders = { [`order-${SESSION_KEY}`]: { _id: `order-${SESSION_KEY}`, orderRef: 'OLD', status: 'fulfilled' } };
  const res = await handler(req(shipped()));
  assert.equal(res.status, 200);
  assert.equal(mutations().length, 1);
  assert.equal(orders[`order-${SESSION_KEY}`].status, 'shipped');
});

test('repeated package_shipped does not patch again (shippedAt stays put)', async () => {
  await handler(req(shipped()));
  const firstShippedAt = orders[`order.${SESSION_KEY}`].shippedAt;
  const res = await handler(req(shipped({ shipped_at: 1790009999 })));
  assert.equal(res.status, 200);
  assert.equal(mutations().length, 1);
  assert.equal(orders[`order.${SESSION_KEY}`].shippedAt, firstShippedAt);
});

/* ── Tracking email ────────────────────────────────────────────────────── */

test('shipped email: sent once, branded, with carrier, tracking number and link', async () => {
  const res = await handler(req(shipped()));
  assert.equal(res.status, 200);
  assert.equal(emails().length, 1);
  const [mail] = emails();
  assert.equal(mail.from, 'The Fuglys <shop@thefuglys.com>');
  assert.equal(mail.to, 'gus@example.com');
  assert.equal(mail.subject, 'Your Fuglys order #M3N4O5P6 has shipped');
  assert.match(mail.html, /It's shipped/);
  assert.match(mail.html, /#M3N4O5P6/);
  assert.match(mail.html, /via ROYAL MAIL/);
  assert.match(mail.html, /RM123456789GB/);
  assert.match(mail.html, /href="https:\/\/track\.test\/RM123456789GB"/);
  assert.match(mail.html, /<img src="https:\/\/thefuglys\.com\/email-logo\.png" alt="The Fuglys"/);
  assert.match(mail.html, /background:#000000/);
  assert.match(mail.html, /#7a0f24/);
  assert.doesNotMatch(mail.html, /#123456/);
  // The email goes after the order is marked shipped.
  const mutateAt = calls.findIndex((c) => c.url.pathname.includes('/data/mutate/'));
  const emailAt = calls.findIndex((c) => c.url.hostname === 'api.resend.com');
  assert.ok(mutateAt >= 0 && emailAt > mutateAt);
});

test('repeated package_shipped does not resend the email', async () => {
  await handler(req(shipped()));
  await handler(req(shipped()));
  await handler(req(shipped({ shipped_at: 1790009999 })));
  assert.equal(emails().length, 1);
  assert.equal(mutations().length, 1);
});

test('a changed tracking number updates the order and emails the new one', async () => {
  const update = { tracking_number: 'RM999999999GB', tracking_url: 'https://track.test/RM999999999GB' };
  await handler(req(shipped()));
  await handler(req(shipped(update)));
  assert.equal(emails().length, 2);
  assert.match(emails()[1].html, /RM999999999GB/);
  assert.equal(orders[`order.${SESSION_KEY}`].trackingNumber, 'RM999999999GB');
  // ...and a repeat of that one sends nothing more.
  await handler(req(shipped(update)));
  assert.equal(emails().length, 2);
});

test('two copies of one event arriving together send one email', async () => {
  // Hold the order lookups until both deliveries have made one, so both read
  // the pre-shipped order before either writes.
  let release;
  const bothRead = new Promise((r) => { release = r; });
  let reads = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('/data/query/') && ++reads <= 2) {
      const res = await sanityFetch(url, init);
      if (reads === 2) release();
      await bothRead;
      return res;
    }
    return sanityFetch(url, init);
  };
  const [a, b] = await Promise.all([handler(req(shipped())), handler(req(shipped()))]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(emails().length, 1);
  assert.equal(mutations().length, 2, 'both tried to patch; the second hit the revision check');
  assert.equal(orders[`order.${SESSION_KEY}`].status, 'shipped');
});

test('order_failed sends no customer email', async () => {
  await handler(req(failed('Address invalid')));
  assert.equal(emails().length, 0);
});

test('no RESEND_API_KEY or no customer email: order still shipped, no email', async () => {
  delete process.env.RESEND_API_KEY;
  await handler(req(shipped()));
  assert.equal(orders[`order.${SESSION_KEY}`].status, 'shipped');

  process.env.RESEND_API_KEY = 're_test';
  orders[`order.${SESSION_KEY}`].status = 'fulfilled';
  delete orders[`order.${SESSION_KEY}`].customerEmail;
  await handler(req(shipped()));
  assert.equal(orders[`order.${SESSION_KEY}`].status, 'shipped');
  assert.equal(emails().length, 0);
});

test('Resend failure: 200, order still shipped, and a repeat does not retry the email', async () => {
  globalThis.fetch = (url, init) => {
    if (!String(url).startsWith('https://api.resend.com')) return sanityFetch(url, init);
    calls.push({ url: new URL(url), init });
    return Promise.resolve({ ok: false, status: 422, text: async () => 'invalid from' });
  };
  assert.equal((await handler(req(shipped()))).status, 200);
  assert.equal(orders[`order.${SESSION_KEY}`].status, 'shipped');
  assert.ok(logs.some((l) => l.includes('[SHIP-EMAIL-FAIL]') && l.includes('422')));
  await handler(req(shipped()));
  assert.equal(emails().length, 1);
});

test('accent: BRAND_ACCENT, then EMAIL_ACCENT, then the default (same as the order confirmation)', async () => {
  delete process.env.BRAND_ACCENT;
  await handler(req(shipped()));
  assert.match(emails()[0].html, /#123456/);
  delete process.env.EMAIL_ACCENT;
  await handler(req(shipped({ tracking_number: 'RM2' })));
  assert.match(emails()[1].html, /#99132F/);
});

test('sender: ORDER_EMAIL_FROM, then the order confirmation default; never NOTIFICATION_FROM', async () => {
  delete process.env.ORDER_EMAIL_FROM;
  await handler(req(shipped()));
  assert.equal(emails()[0].from, 'The Fuglys <orders@thefuglys.com>');
});

test('without LOGO_URL the header is a text wordmark; non-http tracking links are dropped', async () => {
  delete process.env.LOGO_URL;
  await handler(req(shipped({ tracking_url: 'javascript:alert(1)' })));
  const { html } = emails()[0];
  assert.doesNotMatch(html, /<img/);
  assert.match(html, />The Fuglys<\/span>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /Track your order/);
});

/* ── order_failed ──────────────────────────────────────────────────────── */

test('order_failed patches status and reason', async () => {
  const res = await handler(req(failed('Address invalid')));
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(mutations()[0].init.body).mutations[0].patch.set,
    { status: 'fulfilment-failed', failureReason: 'Address invalid' });
  assert.equal(orders[`order.${SESSION_KEY}`].status, 'fulfilment-failed');
});

test('repeated order_failed does not patch again', async () => {
  await handler(req(failed('Address invalid')));
  await handler(req(failed('Address invalid')));
  assert.equal(mutations().length, 1);
});

/* ── Unknown order ─────────────────────────────────────────────────────── */

test('unknown order: 200, no patch, clear log', async () => {
  for (const body of [shipped(), failed()]) {
    body.data.order = { id: 111, external_id: 'nope' };
    const res = await handler(req(body));
    assert.equal(res.status, 200);
  }
  assert.equal(mutations().length, 0);
  assert.equal(logs.filter((l) => l.includes('ORDER NOT FOUND') && l.includes('#111')).length, 2);
});

/* ── Authentication ────────────────────────────────────────────────────── */

test('missing or wrong ?key is rejected with 401 and touches nothing', async () => {
  for (const key of [null, '', 'wrong', SECRET + 'x']) {
    const res = await handler(req(shipped(), { key }));
    assert.equal(res.status, 401, String(key));
  }
  assert.equal(calls.length, 0);
});

test('without PRINTFUL_WEBHOOK_SECRET the request is accepted (same as Cats On Crack, Labrats and The Biker Babies)', async () => {
  delete process.env.PRINTFUL_WEBHOOK_SECRET;
  const res = await handler(req(shipped(), { key: null }));
  assert.equal(res.status, 200);
  assert.equal(mutations().length, 1);
});

/* ── Sanity token ──────────────────────────────────────────────────────── */

test('uses SANITY_API_TOKEN, falling back to SANITY_TOKEN', async () => {
  const sanityCalls = () => calls.filter((c) => c.url.hostname.endsWith('.api.sanity.io'));
  await handler(req(shipped()));
  assert.ok(sanityCalls().every((c) => c.init.headers.Authorization === 'Bearer sk_api'));

  calls = [];
  orders[`order.${SESSION_KEY}`].status = 'fulfilled';
  delete process.env.SANITY_API_TOKEN;
  process.env.SANITY_TOKEN = 'sk_old';
  await handler(req(shipped()));
  assert.ok(sanityCalls().length > 0);
  assert.ok(sanityCalls().every((c) => c.init.headers.Authorization === 'Bearer sk_old'));
});

test('no Sanity token at all: 200 and no Sanity calls', async () => {
  delete process.env.SANITY_API_TOKEN;
  const res = await handler(req(shipped()));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

/* ── Never throws ──────────────────────────────────────────────────────── */

test('Sanity errors and network failures still return 200', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  assert.equal((await handler(req(shipped()))).status, 200);
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  assert.equal((await handler(req(failed()))).status, 200);
});

test('other events, bad method and bad JSON', async () => {
  assert.equal((await handler(req({ type: 'order_created', data: { order: { id: 1 } } }))).status, 200);
  assert.equal((await handler(req({ type: 'stock_updated' }))).status, 200);
  assert.equal((await handler(req('{not json'))).status, 400);
  assert.equal((await handler(req(null, { method: 'GET' }))).status, 405);
  assert.equal(calls.length, 0);
});
