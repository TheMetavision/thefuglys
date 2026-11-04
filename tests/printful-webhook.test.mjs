// Tests for the Printful → Sanity order sync (netlify/functions/printful-webhook.mjs).
//
// Sanity is the in-memory fake (tests/_fake-sanity.mjs) and Resend a fetch stub,
// so nothing leaves the machine.
//
//   npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, sanityClientConfig } from '../netlify/functions/printful-webhook.mjs';
import { fakeSanityOver } from './_fake-sanity.mjs';

const quiet = () => {};
const logs = [];
console.log = quiet; console.warn = quiet;
console.error = (...a) => { logs.push(a.join(' ')); };

const SECRET = 'whsec_test';
const SESSION_KEY = 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6'; // last 32 chars of a Stripe session id

// In-memory Sanity over `orders`, which tests read and change directly.
// `calls` records every Resend request (fetch) and every Sanity read/write
// ({ url: { hostname: 'sanity', pathname } }). `started` records each
// post-delivery start the webhook makes.
let orders, calls, started, readHold, getSanityCalls;
function sanityFetch(url, init = {}) { // Resend only (the name predates the Sanity client)
  const u = new URL(url);
  calls.push({ url: u, init });
  if (u.hostname === 'api.resend.com') {
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'em_1' }), text: async () => '' });
  }
  throw new Error('unexpected fetch ' + url);
}
const S = (pathname) => calls.push({ url: { hostname: 'sanity', pathname } });
const base = fakeSanityOver(() => orders, {
  fetch: async (q, p) => {
    const all = Object.values(orders).filter((o) => !o._id.startsWith('drafts.'));
    let hit = null;
    if (q.includes('printfulOrderId == $pid')) hit = all.find((o) => o.printfulOrderId === p.pid) || null;
    else if (q.includes('_id in [$a, $b]')) hit = orders[p.a] || orders[p.b] || null;
    return hit ? structuredClone(hit) : null;
  },
});
const client = {
  async getDocument(id) { S('/data/doc/'); if (readHold) await readHold(id); return base.getDocument(id); },
  async fetch(q, p) { S('/data/query/'); return base.fetch(q, p); },
  patch: (id) => base.patch(id),
  transaction() {
    const t = base.transaction();
    return { patch(id, fn) { t.patch(id, fn); return this; }, async commit() { S('/data/mutate/'); return t.commit(); } };
  },
};
const handler = createHandler({
  getSanity: () => { getSanityCalls++; return client; },
  start: async (a) => { started.push({ id: a.id, trigger: a.trigger, emailsBefore: emails().length }); return {}; },
});
const mutations = () => calls.filter((c) => c.url.pathname.includes('/data/mutate/'));
const emails = () => calls.filter((c) => c.url.hostname === 'api.resend.com').map((c) => JSON.parse(c.init.body));

beforeEach(() => {
  orders = {
    [`order.${SESSION_KEY}`]: {
      _id: `order.${SESSION_KEY}`, _rev: 'rev0', _type: 'order', orderRef: 'M3N4O5P6', status: 'fulfilled', printfulOrderId: '987654',
      customerName: 'Grimy Gus', customerEmail: 'gus@example.com',
    },
  };
  calls = []; started = []; readHold = null; getSanityCalls = 0;
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

test('package_shipped records status, carrier, tracking number/URL, shipped date and the package', async () => {
  const res = await handler(req(shipped()));
  assert.equal(res.status, 200);
  assert.equal(mutations().length, 1);
  const o = orders[`order.${SESSION_KEY}`];
  assert.equal(o.status, 'shipped');
  assert.equal(o.carrier, 'ROYAL MAIL');
  assert.equal(o.trackingNumber, 'RM123456789GB');
  assert.equal(o.trackingUrl, 'https://track.test/RM123456789GB');
  assert.equal(o.shippedAt, new Date(1790000000 * 1000).toISOString());
  assert.deepEqual(o.printfulShipments.map((p) => [p.trackingNumber, p.carrier]), [['RM123456789GB', 'ROYAL MAIL']]);
  // Only Sanity (the client) and Resend were contacted.
  assert.ok(calls.every((c) => ['sanity', 'api.resend.com'].includes(c.url.hostname)));
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
  assert.equal(mail.from, "The Fuglys <chaos@thefuglys.com>");
  assert.equal(mail.reply_to, "chaos@thefuglys.com");
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

test('shipped email on a mixed order says the wall art ships separately; not on a merchandise-only order', async () => {
  await handler(req(shipped()));
  assert.doesNotMatch(emails()[0].html, /wall art/i);
  orders[`order.${SESSION_KEY}`].hasInhouse = true;
  await handler(req(shipped({ tracking_number: 'RM999' })));
  assert.equal(emails().length, 2);
  assert.match(emails()[1].html, /Your wall art is made by us and ships separately, with its own tracking email\./);
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
  // Hold the order reads until both deliveries have made one, so both read
  // the pre-shipped order before either writes.
  let release;
  const bothRead = new Promise((r) => { release = r; });
  let reads = 0;
  readHold = async (id) => {
    if (id.startsWith('drafts.')) return;
    if (++reads === 2) release();
    if (reads <= 2) await bothRead;
  };
  const [a, b] = await Promise.all([handler(req(shipped())), handler(req(shipped()))]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(emails().length, 1);
  assert.equal(mutations().length, 2, 'both tried to write; the second hit the revision check, re-read and stopped');
  assert.equal(orders[`order.${SESSION_KEY}`].printfulShipments.length, 1);
});

test('two packages of one order arriving together: both recorded, both emailed (the 409 loser retries)', async () => {
  let release;
  const bothRead = new Promise((r) => { release = r; });
  let reads = 0;
  readHold = async (id) => {
    if (id.startsWith('drafts.')) return;
    if (++reads === 2) release();
    if (reads <= 2) await bothRead;
  };
  const one = shipped({ id: 11, tracking_number: 'PKG-ONE', tracking_url: 'https://track.test/PKG-ONE' });
  const two = shipped({ id: 12, tracking_number: 'PKG-TWO', tracking_url: 'https://track.test/PKG-TWO' });
  const [a, b] = await Promise.all([handler(req(one)), handler(req(two))]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(mutations().length, 3, 'one landed, one 409, the retry landed');
  const o = orders[`order.${SESSION_KEY}`];
  assert.deepEqual(o.printfulShipments.map((p) => p.trackingNumber).sort(), ['PKG-ONE', 'PKG-TWO']);
  assert.deepEqual(emails().map((m) => (m.html.match(/PKG-(ONE|TWO)/) || [])[0]).sort(), ['PKG-ONE', 'PKG-TWO']);
  // ...and a late repeat of either package sends nothing more.
  await handler(req(one));
  await handler(req(two));
  assert.equal(emails().length, 2);
});

test('packages one after another: each emailed once; the order shows the latest; a repeat of the first is skipped', async () => {
  await handler(req(shipped({ id: 21, tracking_number: 'FIRST' })));
  await handler(req(shipped({ id: 22, tracking_number: 'SECOND' })));
  await handler(req(shipped({ id: 21, tracking_number: 'FIRST' })));
  assert.equal(emails().length, 2);
  const o = orders[`order.${SESSION_KEY}`];
  assert.equal(o.trackingNumber, 'SECOND');
  assert.deepEqual(o.printfulShipments.map((p) => p.trackingNumber), ['FIRST', 'SECOND']);
});

test('an order shipped before printfulShipments existed: a repeat of its package is still skipped', async () => {
  Object.assign(orders[`order.${SESSION_KEY}`], { status: 'shipped', trackingNumber: 'RM123456789GB', carrier: 'ROYAL MAIL' });
  await handler(req(shipped()));
  assert.equal(emails().length, 0);
  await handler(req(shipped({ id: 99, tracking_number: 'NEWPKG' })));
  assert.equal(emails().length, 1);
  assert.deepEqual(orders[`order.${SESSION_KEY}`].printfulShipments.map((p) => p.trackingNumber), ['RM123456789GB', 'NEWPKG']);
});

test('an open Studio draft gets the same Printful values (server-patch draft mirror)', async () => {
  const id = `order.${SESSION_KEY}`;
  orders[`drafts.${id}`] = { ...structuredClone(orders[id]), _id: `drafts.${id}`, _rev: 'd0' };
  await handler(req(shipped()));
  for (const doc of [orders[id], orders[`drafts.${id}`]]) {
    assert.equal(doc.status, 'shipped');
    assert.equal(doc.trackingNumber, 'RM123456789GB');
    assert.equal(doc.printfulShipments.length, 1);
  }
});

test('post-delivery starts after each newly recorded package email (trigger merch), never on a repeat or a failure', async () => {
  await handler(req(shipped()));
  assert.deepEqual(started.map(({ id, trigger }) => [id, trigger]), [[`order.${SESSION_KEY}`, 'merch']]);
  assert.equal(started[0].emailsBefore, 1, 'the shipped email went first');
  await handler(req(shipped()));
  await handler(req(failed('Address invalid')));
  assert.equal(started.length, 1);
});

test('a post-delivery start that throws still answers 200 and the email has gone', async () => {
  const h = createHandler({ getSanity: () => client, start: async () => { throw new Error('boom'); } });
  assert.equal((await h(req(shipped()))).status, 200);
  assert.equal(emails().length, 1);
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
  await handler(req(shipped({ id: 2, tracking_number: 'RM2' })));
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

test("accent: BRAND_ACCENT, then EMAIL_ACCENT, then site-config's (same as the order confirmation)", async () => {
  delete process.env.BRAND_ACCENT;
  await handler(req(shipped()));
  assert.match(emails()[0].html, /#123456/);
  delete process.env.EMAIL_ACCENT;
  await handler(req(shipped({ tracking_number: 'RM2' })));
  assert.match(emails()[1].html, /#FF2E45/);
});

test("without LOGO_URL the header keeps site-config's logo; non-http tracking links are dropped", async () => {
  delete process.env.LOGO_URL;
  await handler(req(shipped({ tracking_url: 'javascript:alert(1)' })));
  const { html } = emails()[0];
  const { SITE_CONFIG } = await import('../netlify/functions/_shared/site-config.mjs');
  const escaped = SITE_CONFIG.LOGO_URL.replace(/&/g, '&amp;');
  assert.ok(html.includes(`<img src="${escaped}"`), 'site-config logo');
  assert.doesNotMatch(html, /<\/span>/);
  assert.doesNotMatch(html, /javascript:/);
  assert.doesNotMatch(html, /Track your order/);
});

/* ── order_failed ──────────────────────────────────────────────────────── */

test('order_failed patches status and reason', async () => {
  const res = await handler(req(failed('Address invalid')));
  assert.equal(res.status, 200);
  assert.equal(mutations().length, 1);
  assert.equal(orders[`order.${SESSION_KEY}`].status, 'fulfilment-failed');
  assert.equal(orders[`order.${SESSION_KEY}`].failureReason, 'Address invalid');
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
  assert.equal(sanityClientConfig().token, 'sk_api');
  delete process.env.SANITY_API_TOKEN;
  process.env.SANITY_TOKEN = 'sk_old';
  assert.equal(sanityClientConfig().token, 'sk_old');
  assert.equal(sanityClientConfig().useCdn, false);
  await handler(req(shipped()));
  assert.equal(orders[`order.${SESSION_KEY}`].status, 'shipped');
});

test('no Sanity token at all: 200 and no Sanity calls', async () => {
  delete process.env.SANITY_API_TOKEN;
  const res = await handler(req(shipped()));
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
  assert.equal(getSanityCalls, 0);
});

/* ── Never throws ──────────────────────────────────────────────────────── */

test('Sanity errors and network failures still return 200', async () => {
  const broken = { fetch: async () => { throw new Error('Sanity 500'); }, getDocument: async () => { throw new TypeError('fetch failed'); } };
  const h = createHandler({ getSanity: () => broken, start: async () => ({}) });
  assert.equal((await h(req(shipped()))).status, 200);
  assert.equal((await h(req(failed()))).status, 200);
  const h2 = createHandler({ getSanity: () => ({ ...client, getDocument: async () => { throw new Error('boom'); } }), start: async () => ({}) });
  assert.equal((await h2(req(shipped()))).status, 200);
});

test('other events, bad method and bad JSON', async () => {
  assert.equal((await handler(req({ type: 'order_created', data: { order: { id: 1 } } }))).status, 200);
  assert.equal((await handler(req({ type: 'stock_updated' }))).status, 200);
  assert.equal((await handler(req('{not json'))).status, 400);
  assert.equal((await handler(req(null, { method: 'GET' }))).status, 405);
  assert.equal(calls.length, 0);
});

test('sender and reply-to: the brand address from site-config; ORDER_EMAIL_FROM and NOTIFICATION_FROM are ignored', async () => {
  process.env.ORDER_EMAIL_FROM = 'Not us <orders@themetavision.co.uk>';
  process.env.NOTIFICATION_FROM = 'Not us <contact@themetavision.co.uk>';
  try {
    await handler(req(shipped()));
    assert.equal(emails()[0].from, "The Fuglys <chaos@thefuglys.com>");
    assert.equal(emails()[0].reply_to, "chaos@thefuglys.com");
  } finally {
    delete process.env.ORDER_EMAIL_FROM;
    delete process.env.NOTIFICATION_FROM;
  }
});
