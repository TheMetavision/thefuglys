/**
 * The Scrap Dash prize flow (netlify/lib/sd-prize.mjs and the sd-* functions), end to end on an in-memory
 * Blobs store. fetch is a router: Resend, Printful and the Sanity catalogue (read only) are faked, and ANY
 * other network call fails the test. @sanity/client is stubbed to record any client being created: the
 * prize must never create one (no Sanity writes, so no order document, no orders webhook, shipping,
 * post-delivery, referral or MailerLite step can ever see it).
 *
 *   npm test
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire, registerHooks } from 'node:module';
import { assertReadable } from './_email-contrast.mjs';

const require = createRequire(import.meta.url);
const quiet = () => {};
console.log = quiet; console.warn = quiet; console.error = quiet;

// ── @sanity/client: record every client anyone creates ────────────────────
globalThis.__sanityClients = [];
registerHooks({
  resolve(spec, ctx, next) { return spec === '@sanity/client' ? { url: 'stub:sanity-client', shortCircuit: true } : next(spec, ctx); },
  load(url, ctx, next) {
    return url === 'stub:sanity-client'
      ? { format: 'module', shortCircuit: true, source: 'export function createClient(c) { globalThis.__sanityClients.push(c); return { fetch: async () => null, getDocument: async () => null, patch() { throw new Error("sanity write"); }, transaction() { throw new Error("sanity write"); }, create() { throw new Error("sanity write"); } }; }' }
      : next(url, ctx);
  },
});

process.env.SD_LEADERBOARD_SECRET = 'test-secret-0123456789-abcdefghijklmnop';
process.env.PRINTFUL_API_KEY = 'pf_test_key';
process.env.PRINTFUL_AUTO_CONFIRM = 'true';   // the shop's setting: the prize must ignore it
process.env.RESEND_API_KEY = 're_test';
for (const k of ['LOGO_URL', 'SITE_URL', 'NOTIFICATION_FROM', 'SANITY_API_TOKEN', 'SANITY_TOKEN', 'PRINTFUL_ORDERS_URL']) delete process.env[k];

// ── in-memory Netlify Blobs with etags and conditional writes ─────────────
const mem = new Map(); let n = 0;
const { setStoreForTests, sha256, monthId, prevMonthId, sdStore } = await import('../netlify/lib/sd-shared.mjs');
setStoreForTests({
  async get(k) { const v = mem.get(k); return v ? JSON.parse(v.d) : null; },
  async getWithMetadata(k) { const v = mem.get(k); return v ? { data: JSON.parse(v.d), etag: v.e } : null; },
  async setJSON(k, val, o = {}) {
    const cur = mem.get(k);
    if (o.onlyIfNew && cur) return { modified: false };
    if (o.onlyIfMatch && (!cur || cur.e !== o.onlyIfMatch)) return { modified: false };
    mem.set(k, { d: JSON.stringify(val), e: 'e' + (++n) }); return { modified: true, etag: 'e' + n };
  },
  async *list({ prefix }) { yield { blobs: [...mem.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; },
  async delete(k) { mem.delete(k); },
});

// ── the catalogue (what Sanity's published products look like) ───────────
const pv = (colour, size, id) => ({ colour, size, syncVariantId: String(id) });
const PRODUCTS = [
  { name: 'Boomer Blazeclaw Boom', slug: 'boomer-blazeclaw-boom', variants: [
    { productType: 'tshirt', label: 'T-Shirt', colourImages: [{ colour: 'Black', imageUrl: 'https://cdn.sanity.io/images/x/black.jpg' }], printfulVariants: [pv('Black', 'L', 5001), pv('Black', 'S', 5002), pv('Black', 'M', 5003), pv('White', 'M', 5004)] },
    { productType: 'kids-tshirt', label: 'Kids T-Shirt', colourImages: [], printfulVariants: [pv('Black', 'S', 6001), pv('Black', 'XS', 6002)] },
  ] },
  { name: 'Wasteland Warriors', slug: 'byte-hack', variants: [
    { productType: 'tshirt', label: 'T-Shirt', colourImages: [], printfulVariants: [pv('Navy', 'L', 7001)] },
  ] },
  { name: 'No Variants Yet', slug: 'empty', variants: [{ productType: 'tshirt', printfulVariants: [] }] },
];

// ── fetch: Resend, Printful, Sanity (GET), nothing else ───────────────────
let sent, calls, pfOrders, mode;
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url)), method = (init.method || 'GET').toUpperCase();
  calls.push({ host: u.hostname, path: u.pathname, method });
  if (u.hostname === 'api.resend.com' && method === 'POST') {
    const mail = JSON.parse(init.body);
    if (mode.resendFail && mode.resendFail(mail, sent.length)) return new Response('resend down', { status: 500 });
    sent.push(mail); return jsonRes({ id: 'em_' + sent.length });
  }
  if (u.hostname === 'ngx60q2x.api.sanity.io' && method === 'GET' && u.pathname === '/v2024-01-01/data/query/production') {
    const slug = u.searchParams.get('$slug');
    return jsonRes({ result: slug ? PRODUCTS.find((p) => p.slug === JSON.parse(slug)) || null : PRODUCTS });
  }
  if (u.hostname === 'api.printful.com') {
    if (method === 'GET' && u.pathname.startsWith('/store/variants/')) return new Response('{}', { status: mode.variantStatus });
    if (method === 'POST' && u.pathname === '/orders') {
      pfOrders.push({ search: u.search, body: JSON.parse(init.body) });
      const step = mode.orders.length ? mode.orders.shift() : 'ok';
      if (step === 'ok') return jsonRes({ code: 200, result: { id: 555, status: 'draft' } });
      if (step === 'duplicate') return jsonRes({ code: 400, error: { message: 'Order with this external_id already exists' } }, 400);
      if (step === 'bad') return jsonRes({ code: 400, error: { message: 'Recipient address is invalid' } }, 400);
      return jsonRes({ code: 500, error: { message: 'An internal server error occurred' } }, 500);
    }
    if (method === 'GET' && u.pathname.startsWith('/orders/@')) return jsonRes({ code: 200, result: { id: 777, status: 'draft' } });
  }
  throw new Error(`unexpected network call: ${method} ${url}`);
};

require('../src/lib/printful-order.cjs').config.retryDelayMs = 0;
const P = await import('../netlify/lib/sd-prize.mjs');
const claimFn = (await import('../netlify/functions/sd-claim.mjs')).default;
const winnerFn = (await import('../netlify/functions/sd-winner.mjs')).default;
const declineFn = (await import('../netlify/functions/sd-decline.mjs')).default;
const dqFn = (await import('../netlify/functions/sd-disqualify.mjs')).default;
const optionsFn = (await import('../netlify/functions/sd-prize-options.mjs')).default;
const { checkWindows } = await import('../netlify/functions/sd-prize-check.mjs');
const { closeMonth } = await import('../netlify/functions/sd-close-month.mjs');

let ipN = 0;
const post = async (fn, body) => { const ip = `10.0.${Math.floor(++ipN / 250)}.${ipN % 250}`; const r = await fn(new Request('https://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'x-nf-client-connection-ip': ip } }), { ip }); return { status: r.status, body: await r.json() }; };
const keyOf = (i) => String(i).padStart(2, '0').repeat(32);
const DEVS = Array.from({ length: 12 }, (_, i) => keyOf(i + 10));
const NICKS = ['SpeedyPiston07', 'RustyHubcap42', 'SwiftWrench11', 'WildMuffler20', 'BoldNugget33', 'LuckyComet44', 'GnarlyGasket55', 'FeralBolt66', 'SaltyBumper77', 'CrustyJalopy88', 'PluckyGizmo99', 'DaringZoomer12'];
const MONTH = prevMonthId(new Date());
const rec = () => JSON.parse(mem.get(`winners/${MONTH}`).d);
const setRec = (fn) => { const r = rec(); fn(r); mem.set(`winners/${MONTH}`, { d: JSON.stringify(r), e: 'e' + (++n) }); };
const offerKeys = () => [...mem.keys()].filter((k) => k.startsWith('offers/'));
const winnerFor = (i, month) => post(winnerFn, { deviceKey: DEVS[i], ...(month ? { month } : {}) }).then((r) => r.body);

/** A closed month with 12 runs on the board; the first offer has 10 days left. */
async function closed() {
  mem.clear(); sent.length = 0;
  const entries = DEVS.map((d, i) => ({ rid: 'r' + i, nick: NICKS[i], dist: 5000 - i * 100, score: 900 - i, stage: 'boneyard', runner: 'trixie', dev: sha256(d), flag: i === 0, secs: 400 - i, at: 1000 + i }));
  mem.set(`board/${MONTH}`, { d: JSON.stringify({ entries }), e: 'b0' });
  const r = await closeMonth(new Date());
  assert.equal(r.winner, NICKS[0]);
  setRec((x) => { x.offer.deadline = Date.now() + 10 * 86400000; });
  sent.length = 0; calls.length = 0;
  return rec().offer.claimCode;
}
const form = (code, over = {}) => ({ month: MONTH, claimCode: code, claimant: 'guardian', name: 'Pat Parent', email: 'pat@example.com', address1: '1 Cheese Lane', address2: 'Flat 2', town: 'Southend-on-Sea', postcode: 'ss1 1aa', design: 'boomer-blazeclaw-boom', garment: 'kids-tshirt', colour: 'Black', size: 'S', consent: true, ...over });
const readableAll = () => sent.forEach((m) => assertReadable(m.html, m.subject));
const noPII = () => { const all = JSON.stringify([...mem.values()]); for (const s of ['Cheese Lane', 'pat@example.com', 'Pat Parent', 'ada@example.com', 'Ada Adult']) assert.ok(!all.includes(s), `no ${s} in Blobs`); };

beforeEach(() => { sent = []; calls = []; pfOrders = []; mode = { variantStatus: 200, orders: [], resendFail: null }; globalThis.__sanityClients.length = 0; });

/* ───────────────────────────── month close ───────────────────────────── */

test('month close keeps the top 10, offers the prize to the furthest run for 30 days after the month, and emails the team', async () => {
  mem.clear();
  const entries = DEVS.map((d, i) => ({ rid: 'r' + i, nick: NICKS[i], dist: 5000 - i * 100, score: 1, stage: 'boneyard', runner: 'trixie', dev: sha256(d), flag: false, secs: 300, at: i }));
  mem.set(`board/${MONTH}`, { d: JSON.stringify({ entries }), e: 'b' });
  await closeMonth(new Date());
  const r = rec();
  assert.equal(r.v, 2); assert.equal(r.status, 'open'); assert.equal(r.candidates.length, 10);
  assert.equal(r.offer.idx, 0); assert.match(r.offer.claimCode, /^[A-Z2-9]{8}$/);
  const [y, m] = MONTH.split('-').map(Number);
  assert.equal(r.offer.deadline, Date.UTC(y, m, 1) + 30 * 86400000, 'first winner: 30 days after the end of the month');
  assert.deepEqual(offerKeys(), [`offers/${sha256(DEVS[0])}/${MONTH}`]);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, new RegExp(`winner is ${NICKS[0]}`));
  assert.ok(sent[0].html.includes(r.offer.claimCode) && sent[0].html.includes('sd-disqualify?m=' + MONTH + '&amp;i=0'));
  assert.ok((await closeMonth(new Date())).winner === 'already closed' && sent.length === 1, 'closing twice does nothing');
  readableAll();
});

/* ───────────────────────────── claiming ───────────────────────────── */

test('the winner claims (18 or over): team email, receipt to the winner, Printful DRAFT with confirm=false, nothing personal stored', async () => {
  const code = await closed();
  const w = await winnerFor(0);
  assert.ok(w.won && w.claimCode === code && w.month === MONTH && w.rank === 1 && !w.passedDown && w.claimBy);
  const r = await post(claimFn, form(code, { claimant: 'winner', name: 'Ada Adult', email: 'ada@example.com', garment: 'tshirt', colour: 'Black', size: 'M' }));
  assert.equal(r.status, 200, JSON.stringify(r.body)); assert.ok(r.body.ok);

  assert.equal(pfOrders.length, 1);
  const o = pfOrders[0];
  assert.equal(o.search, '?confirm=false', 'never confirmed, whatever PRINTFUL_AUTO_CONFIRM says');
  assert.equal(o.body.external_id, `sd-${MONTH}-0`);
  assert.deepEqual(o.body.items, [{ sync_variant_id: 5003, quantity: 1 }], 'the real variant for Boomer / T-shirt / Black / M');
  assert.equal(o.body.recipient.country_code, 'GB');
  assert.equal(o.body.recipient.zip, 'SS1 1AA', 'postcode tidied');
  assert.ok(!('email' in o.body.recipient), 'no email to Printful: it sends the claimant nothing');

  assert.equal(sent.length, 2);
  const [team, receipt] = sent;
  assert.equal(team.to, 'contact@thefuglys.com'); assert.equal(team.reply_to, 'ada@example.com');
  assert.match(team.html, /Claimed by:<\/b> The winner \(18 or over\)/);
  assert.match(team.html, /DRAFT order #555 created/); assert.match(team.html, /not confirmed/);
  assert.ok(team.html.includes('href="https://www.printful.com/dashboard/default/orders"'), 'links to Printful');
  assert.match(team.html, /Boomer Blazeclaw Boom, T-shirt, Black, size M/);
  assert.match(team.html, /flagged for review/, 'the winning run in this month is flagged');
  assert.equal(receipt.to, 'ada@example.com');
  assert.match(receipt.html, /Hi Ada Adult/); assert.match(receipt.html, /Congratulations on winning the .* as <b>SpeedyPiston07<\/b>/);
  assert.doesNotMatch(receipt.html, /parent|guardian/i, 'the winner is addressed as the winner');

  const after = rec();
  assert.equal(after.status, 'claimed'); assert.equal(after.offer, null);
  assert.deepEqual({ ...after.claim, at: 0 }, { idx: 0, claimCode: code, at: 0, claimant: 'winner', design: 'boomer-blazeclaw-boom', garment: 'tshirt', colour: 'Black', size: 'M', printfulOrderId: 555, draftOk: true });
  assert.deepEqual(offerKeys(), [], 'the device marker goes once claimed');
  assert.equal((await winnerFor(0)).won, false, 'no more "You won!" once claimed');
  assert.equal((await post(claimFn, form(code))).body.reason, 'claimed', 'claimed once only');
  noPII(); readableAll();
});

test("the winner's parent or guardian claims: worded for them throughout", async () => {
  const code = await closed();
  const r = await post(claimFn, form(code));
  assert.ok(r.body.ok, JSON.stringify(r.body));
  const [team, receipt] = sent;
  assert.match(team.html, /Claimed by:<\/b> The winner&#39;s parent or guardian/);
  assert.match(team.html, /Boomer Blazeclaw Boom, Kids T-shirt, Black, size S/);
  assert.deepEqual(pfOrders[0].body.items, [{ sync_variant_id: 6001, quantity: 1 }]);
  assert.match(receipt.html, /Hi Pat Parent/); assert.match(receipt.html, /prize your winner, <b>SpeedyPiston07<\/b>, won/);
  assert.doesNotMatch(receipt.html, /Congratulations on winning/);
  noPII(); readableAll();
});

test('who is claiming must be given, and be one of the two', async () => {
  const code = await closed();
  for (const claimant of [undefined, '', 'friend', 'Winner']) {
    const r = await post(claimFn, form(code, { claimant }));
    assert.equal(r.body.reason, 'form', String(claimant));
  }
  assert.equal((await post(claimFn, form(code, { consent: false }))).body.reason, 'form');
  assert.equal(sent.length, 0); assert.equal(pfOrders.length, 0); assert.equal(rec().status, 'open');
});

test('UK postcodes only, checked on the server: England, Scotland, Wales, NI yes; GY, JE, IM, BFPO and others no', async () => {
  const code = await closed();
  const cases = [
    ['GY1 1AA', 'postcode-crown'], ['je2 3ab', 'postcode-crown'], ['IM1 1AA', 'postcode-crown'], ['IM99 1PS', 'postcode-crown'],
    ['BFPO 123', 'postcode-bfpo'], ['bfpo 1', 'postcode-bfpo'],
    ['75001', 'postcode-format'], ['GIR 0AA', 'postcode-format'], ['ASCN 1ZZ', 'postcode-format'], ['SW1A', 'postcode-format'], ['D02 X285', 'postcode-format'],
  ];
  for (const [pc, reason] of cases) {
    const r = await post(claimFn, form(code, { postcode: pc }));
    assert.equal(r.status, 400, pc); assert.equal(r.body.reason, reason, pc);
  }
  assert.equal(sent.length, 0, 'nothing sent for a refused postcode'); assert.equal(pfOrders.length, 0);
  assert.equal(rec().status, 'open');
  const { ukPostcode } = await import('../src/lib/uk-postcode.mjs');
  for (const pc of ['SW1A 1AA', 'EH1 1YZ', 'CF10 1EP', 'BT1 5GS', 'M1 1AE', 'ss11aa', 'IV2 3HJ', 'KW15 1XX']) assert.ok(ukPostcode(pc).ok, pc);
  assert.equal(ukPostcode('bt15gs').postcode, 'BT1 5GS');
  const ok = await post(claimFn, form(code, { postcode: 'BT1 5GS' }));
  assert.ok(ok.body.ok, 'a Northern Ireland address is accepted');
});

test('the T-shirt must be one of the chosen design\'s real variants, and in the Printful store', async () => {
  const code = await closed();
  for (const over of [{ design: 'byte-hack', garment: 'kids-tshirt', colour: 'Navy', size: 'L' }, { colour: 'Pink' }, { garment: 'tshirt', colour: 'White', size: 'L' }, { design: 'nope' }, { garment: 'hoodie' }]) {
    const r = await post(claimFn, form(code, over));
    assert.ok(['prize', 'form'].includes(r.body.reason), JSON.stringify(over) + ' ' + JSON.stringify(r.body));
  }
  mode.variantStatus = 404;
  assert.equal((await post(claimFn, form(code))).body.reason, 'prize', 'a variant no longer in the Printful store');
  assert.equal(sent.length, 0); assert.equal(pfOrders.length, 0); assert.equal(rec().offer.claiming, undefined);
});

test('prize options: every design with T-shirt variants, kids only where the design has them, real colours and sizes, no variant ids', async () => {
  const r = await optionsFn(new Request('https://x/api/sd-prize-options'));
  const { designs } = await r.json();
  assert.deepEqual(designs.map((d) => d.slug), ['boomer-blazeclaw-boom', 'byte-hack']);
  const boomer = designs[0];
  assert.deepEqual(boomer.garments.map((g) => g.type), ['tshirt', 'kids-tshirt']);
  assert.deepEqual(boomer.garments[0].colours.map((c) => [c.colour, c.sizes]), [['Black', ['S', 'M', 'L']], ['White', ['M']]]);
  assert.equal(boomer.garments[0].colours[0].image, 'https://cdn.sanity.io/images/x/black.jpg');
  assert.deepEqual(boomer.garments[1].colours, [{ colour: 'Black', image: null, sizes: ['XS', 'S'] }]);
  assert.deepEqual(designs[1].garments.map((g) => g.label), ['T-shirt'], 'no kids option where the design has none');
  assert.ok(!JSON.stringify(designs).includes('5001'), 'no Printful variant ids leave the server');
  assert.ok(calls.every((c) => c.method === 'GET'), 'catalogue is read only');
});

/* ───────────────────────────── Printful ───────────────────────────── */

test('Printful draft: a retry after a 500 reuses the same external_id and finds the existing draft', async () => {
  const code = await closed();
  mode.orders = ['500', 'duplicate'];
  const r = await post(claimFn, form(code));
  assert.ok(r.body.ok, JSON.stringify(r.body));
  assert.equal(pfOrders.length, 2);
  for (const o of pfOrders) { assert.equal(o.search, '?confirm=false'); assert.equal(o.body.external_id, `sd-${MONTH}-0`); }
  assert.ok(calls.some((c) => c.host === 'api.printful.com' && c.path === `/orders/@sd-${MONTH}-0`), 'looked up by external_id');
  assert.match(sent[0].html, /DRAFT order #777 was already there/);
  assert.equal(rec().claim.printfulOrderId, 777);
});

test('Printful failure: the claim still goes through and the team email says the draft was NOT created, with every detail', async () => {
  const code = await closed();
  mode.orders = ['bad'];
  const r = await post(claimFn, form(code));
  assert.ok(r.body.ok);
  assert.equal(sent.length, 2);
  const team = sent[0];
  assert.match(team.subject, /Printful draft NOT created/);
  assert.match(team.html, /the draft was NOT created/); assert.match(team.html, /Recipient address is invalid/);
  assert.match(team.html, /1 Cheese Lane/); assert.match(team.html, /SS1 1AA/); assert.match(team.html, new RegExp(`sd-${MONTH}-0`));
  assert.equal(sent[1].to, 'pat@example.com', 'receipt still sent');
  assert.equal(rec().status, 'claimed'); assert.equal(rec().claim.draftOk, false);
  readableAll();
});

test('if an email fails the claim is released, and the same code works again (the Printful draft is reused)', async () => {
  const code = await closed();
  mode.resendFail = (mail) => mail.to === 'contact@thefuglys.com';
  let r = await post(claimFn, form(code));
  assert.equal(r.status, 502); assert.equal(r.body.reason, 'email');
  let x = rec();
  assert.equal(x.status, 'open'); assert.equal(x.offer.claimCode, code); assert.equal(x.offer.claiming, undefined, 'hold released');
  assert.deepEqual(offerKeys(), [`offers/${sha256(DEVS[0])}/${MONTH}`]);
  assert.ok((await winnerFor(0)).won, 'the winner still sees their prize');

  mode.resendFail = (mail) => mail.to === 'pat@example.com';   // now the receipt fails
  r = await post(claimFn, form(code));
  assert.equal(r.body.reason, 'email');
  assert.equal(rec().status, 'open'); assert.equal(rec().offer.claiming, undefined);

  mode.resendFail = null; mode.orders = ['duplicate'];
  r = await post(claimFn, form(code));
  assert.ok(r.body.ok);
  assert.equal(rec().status, 'claimed');
  assert.ok(pfOrders.every((o) => o.body.external_id === `sd-${MONTH}-0` && o.search === '?confirm=false'));
});

test('a claim in progress holds the prize: a second claim, a decline or a disqualification waits', async () => {
  const code = await closed();
  setRec((x) => { x.offer.claiming = { at: Date.now() }; });
  assert.equal((await post(claimFn, form(code))).body.reason, 'busy');
  assert.equal((await post(declineFn, { month: MONTH, claimCode: code })).body.reason, 'busy');
  const dl = rec().offer.deadline;
  setRec((x) => { x.offer.claiming = { at: dl }; });
  assert.deepEqual(await checkWindows(dl + 1000), [], 'the daily check leaves a held offer alone, even past its deadline');
  setRec((x) => { x.offer.claiming = { at: Date.now() }; });
  setRec((x) => { x.offer.claiming = { at: Date.now() - P.LOCK_MS - 1 }; });
  assert.ok((await post(claimFn, form(code))).body.ok, 'a stale hold (a crashed claim) does not block for ever');
});

/* ───────────────────────────── passing the prize down ───────────────────────────── */

test('window expiry: the daily check passes the prize down (14 days each), the game follows it, and after #10 it lapses', async () => {
  const oldCode = await closed();
  const d0 = rec().offer.deadline;
  assert.deepEqual(await checkWindows(d0 - 1), [], 'nothing before the deadline');
  assert.deepEqual(await checkWindows(d0), [{ month: MONTH, status: 'open', idx: 1 }]);
  let r = rec();
  assert.equal(r.offer.idx, 1); assert.notEqual(r.offer.claimCode, oldCode);
  assert.equal(r.offer.deadline, d0 + 14 * 86400000, 'next player: 14 days');
  assert.deepEqual(r.history.map((h) => [h.idx, h.outcome]), [[0, 'expired']]);
  assert.match(sent[0].subject, /passed on: .*now RustyHubcap42 \(#2\)/);
  assert.match(sent[0].html, /SpeedyPiston07 \(#1\) didn't claim by/); assert.ok(sent[0].html.includes(r.offer.claimCode));
  assert.equal((await post(claimFn, form(oldCode))).body.reason, 'code', 'the old code is dead');

  setRec((x) => { x.offer.deadline = Date.now() + 86400000; });
  assert.equal((await winnerFor(0)).won, false, 'the first winner no longer sees it');
  const w1 = await winnerFor(1);
  assert.ok(w1.won && w1.passedDown && w1.rank === 2 && w1.month === MONTH && w1.claimCode === rec().offer.claimCode, 'found through the device marker, with no month sent');
  assert.deepEqual(offerKeys(), [`offers/${sha256(DEVS[1])}/${MONTH}`]);

  for (let i = 1; i <= 9; i++) await checkWindows(rec().offer.deadline);
  r = rec();
  assert.equal(r.status, 'lapsed'); assert.equal(r.offer, null);
  assert.deepEqual(r.history.map((h) => h.idx), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'down the top 10 only (12 were on the board)');
  assert.match(sent.at(-1).subject, /prize lapsed/); assert.match(sent.at(-1).html, /Nobody else in the top 10/);
  assert.deepEqual(offerKeys(), []);
  assert.equal((await winnerFor(10)).won, false, '#11 is never offered it');
  readableAll();
});

test('a claim after the window has run out passes the prize down instead', async () => {
  const code = await closed();
  setRec((x) => { x.offer.deadline = Date.now() - 1000; });
  const r = await post(claimFn, form(code));
  assert.equal(r.body.reason, 'expired');
  assert.equal(rec().offer.idx, 1); assert.equal(pfOrders.length, 0);
  assert.equal(sent.length, 1); assert.match(sent[0].subject, /passed on/);
});

test('"can\'t use a UK address": the holder passes the prize on at once', async () => {
  const code = await closed();
  assert.equal((await post(declineFn, { month: MONTH, claimCode: 'WRONG234' })).body.reason, 'code');
  const r = await post(declineFn, { month: MONTH, claimCode: code });
  assert.ok(r.body.ok);
  const x = rec();
  assert.equal(x.offer.idx, 1); assert.deepEqual(x.history.map((h) => h.outcome), ['declined']);
  assert.match(sent[0].html, /said they can't use a UK address/);
  assert.equal((await post(claimFn, form(code))).body.reason, 'code');
  assert.equal((await post(declineFn, { month: MONTH, claimCode: code })).body.reason, 'code', 'only once');
  // the next player can claim with the new code
  const w = await winnerFor(1);
  assert.ok((await post(claimFn, form(w.claimCode))).body.ok);
  assert.equal(pfOrders[0].body.external_id, `sd-${MONTH}-1`, 'one external_id per place on the board');
  assert.match(sent.at(-1).html, /passed down to them as the next player in line/);
  readableAll();
});

/* ───────────────────────────── disqualifying ───────────────────────────── */

const dqReq = (method, month, idx, sig) => {
  const link = new URL(P.dqUrl(month, idx));
  const s = sig ?? link.searchParams.get('s');
  if (method === 'GET') return dqFn(new Request(`https://x/api/sd-disqualify?m=${month}&i=${idx}&s=${s}`));
  return dqFn(new Request('https://x/api/sd-disqualify', { method: 'POST', body: new URLSearchParams({ m: month, i: String(idx), s }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } }));
};

test('disqualify: the link opens a confirm page (no change), a POST passes the prize on, a forged link is refused', async () => {
  await closed();
  assert.equal((await dqReq('GET', MONTH, 0, 'forged')).status, 403);
  assert.equal((await dqReq('POST', MONTH, 0, 'forged')).status, 403);
  assert.equal((await dqReq('POST', MONTH, 1, new URL(P.dqUrl(MONTH, 0)).searchParams.get('s'))).status, 403, "one run's link can't disqualify another");
  const page = await (await dqReq('GET', MONTH, 0)).text();
  assert.match(page, /Disqualify SpeedyPiston07\?/); assert.match(page, /<form method="post"/);
  assert.equal(rec().offer.idx, 0, 'opening the link changes nothing');

  const done = await (await dqReq('POST', MONTH, 0)).text();
  assert.match(done, /passed to #2 RustyHubcap42/);
  const x = rec();
  assert.equal(x.offer.idx, 1); assert.ok(x.candidates[0].disqualified);
  assert.match(sent[0].html, /SpeedyPiston07 \(#1\) was disqualified/);
  assert.match(await (await dqReq('POST', MONTH, 0)).text(), /Nothing to do/, 'a second press does nothing');
  assert.equal(rec().offer.idx, 1);
});

test('disqualify after a claim: the prize passes on and the team is told to delete the Printful draft', async () => {
  const code = await closed();
  assert.ok((await post(claimFn, form(code))).body.ok);
  assert.match(await (await dqReq('GET', MONTH, 0)).text(), /delete their Printful draft/);
  await dqReq('POST', MONTH, 0);
  const x = rec();
  assert.equal(x.status, 'open'); assert.equal(x.offer.idx, 1); assert.equal(x.claim, null);
  assert.deepEqual(x.history.map((h) => [h.outcome, h.printfulOrderId]), [['disqualified', 555]]);
  assert.match(sent.at(-1).html, /Delete their Printful draft #555/);
  assert.ok((await winnerFor(1)).won);
  readableAll();
});

/* ───────────────────────────── older records ───────────────────────────── */

test('a month closed before pass-down existed is upgraded from its board, keeping the winner and their code', async () => {
  mem.clear();
  const CUR = monthId(new Date());   // its window is certainly still open
  const entries = DEVS.slice(0, 3).map((d, i) => ({ rid: 'r' + i, nick: NICKS[i], dist: 3000 - i, score: 1, stage: 'perimeter', runner: 'scrap', dev: sha256(d), flag: false, secs: 300, at: i }));
  mem.set(`board/${CUR}`, { d: JSON.stringify({ entries }), e: 'b' });
  mem.set(`winners/${CUR}`, { d: JSON.stringify({ month: CUR, ...entries[0], claimCode: 'ABCDEFGH', claimed: false, at: 1 }), e: 'old' });
  const w = await winnerFor(0, CUR);
  assert.ok(w.won && w.claimCode === 'ABCDEFGH', 'the old winner and code still work');
  const got = await P.readRecord(await sdStore(), CUR);
  assert.equal(got.rec.v, 2); assert.equal(got.rec.candidates.length, 3); assert.equal(got.rec.offer.claimCode, 'ABCDEFGH');
  assert.equal(got.rec.offer.deadline, P.firstDeadline(CUR));
  assert.deepEqual(offerKeys(), [`offers/${sha256(DEVS[0])}/${CUR}`]);
});

test('an old-style month whose window had already closed lapses under the old rules: never passed down, no email', async () => {
  mem.clear();
  const entries = DEVS.slice(0, 3).map((d, i) => ({ rid: 'r' + i, nick: NICKS[i], dist: 3000 - i, score: 1, stage: 'perimeter', runner: 'scrap', dev: sha256(d), flag: false, secs: 300, at: i }));
  mem.set('board/2026-08', { d: JSON.stringify({ entries }), e: 'b' });
  mem.set('winners/2026-08', { d: JSON.stringify({ month: '2026-08', ...entries[0], claimCode: 'ABCDEFGH', claimed: false, at: 1 }), e: 'old' });
  mem.set('winners/2026-07', { d: JSON.stringify({ month: '2026-07', ...entries[1], claimCode: 'HGFEDCBA', claimed: true, at: 1 }), e: 'old' });
  assert.deepEqual(await checkWindows(), []);
  const aug = JSON.parse(mem.get('winners/2026-08').d), jul = JSON.parse(mem.get('winners/2026-07').d);
  assert.equal(aug.status, 'lapsed'); assert.equal(aug.offer, null);
  assert.equal(jul.status, 'claimed');
  assert.deepEqual(offerKeys(), []); assert.equal(sent.length, 0);
  assert.equal((await winnerFor(1)).won, false);
});

/* ───────────────────────────── kept apart from the shop ───────────────────────────── */

test('kept apart: no Sanity client, no Sanity write, no Stripe or MailerLite call anywhere in the prize flow', async () => {
  const code = await closed();
  await post(declineFn, { month: MONTH, claimCode: code });
  const w = await winnerFor(1);
  assert.ok((await post(claimFn, form(w.claimCode))).body.ok);
  await dqReq('POST', MONTH, 1);
  await checkWindows(rec().offer.deadline);
  await optionsFn(new Request('https://x/api/sd-prize-options'));
  assert.equal(globalThis.__sanityClients.length, 0, 'no Sanity client is ever created');
  const hosts = new Set(calls.map((c) => c.host));
  assert.deepEqual([...hosts].sort(), ['api.printful.com', 'api.resend.com', 'ngx60q2x.api.sanity.io']);
  assert.ok(calls.filter((c) => c.host.endsWith('sanity.io')).every((c) => c.method === 'GET' && c.path.endsWith('/data/query/production')), 'Sanity: reads only');
  assert.ok(calls.filter((c) => c.host === 'api.printful.com').every((c) => c.method === 'GET' || c.path === '/orders'), 'Printful: the draft order and look-ups only');
});

test('kept apart: the prize code imports none of the order, shipping, post-delivery, referral or MailerLite modules', () => {
  const FORBIDDEN = ['post-delivery', 'referral', 'referral-reward', 'mailerlite-customer', 'marketing-consent', 'server-patch', 'orders-router', 'printful-shipped', 'shipping-dispatch', 'shipping-client', 'shipping-events', 'shipping-returns', 'stripe', '@sanity/client'];
  const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const files = ['netlify/lib/sd-prize.mjs', 'netlify/lib/sd-prize-emails.mjs', 'src/lib/uk-postcode.mjs', ...fs.readdirSync(path.join(root, 'netlify/functions')).filter((f) => /^sd-.*\.mjs$/.test(f)).map((f) => 'netlify/functions/' + f)];
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    const specs = [...src.matchAll(/(?:import\s[^'"]*?from\s*|import\s*\(\s*|require\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const s of specs) {
      const base = path.basename(s).replace(/\.(mjs|cjs|js|mts)$/, '');
      assert.ok(!FORBIDDEN.includes(base) && !FORBIDDEN.includes(s), `${f} imports ${s}`);
    }
  }
});

test('kept apart: when Printful ships the prize, printful-webhook finds no order, sends no email and starts nothing', async () => {
  process.env.SANITY_API_TOKEN = 'sk_test';
  delete process.env.PRINTFUL_WEBHOOK_SECRET;
  const { createHandler } = await import('../netlify/functions/printful-webhook.mjs');
  const queries = [], emails = [], started = [];
  const sanity = {
    fetch: async (q, p) => { queries.push(p); return null; },
    getDocument: async () => null,
    patch() { throw new Error('write'); }, transaction() { throw new Error('write'); },
  };
  const handler = createHandler({ getSanity: () => sanity, sendEmail: async (...a) => emails.push(a), start: async (a) => started.push(a) });
  for (const type of ['package_shipped', 'order_failed']) {
    const res = await handler(new Request('https://x/api/printful-webhook', { method: 'POST', body: JSON.stringify({ type, data: { order: { id: 555, external_id: `sd-${MONTH}-0` }, shipment: { tracking_number: 'RM123' }, reason: 'x' } }) }));
    assert.equal(res.status, 200);
  }
  assert.deepEqual(emails, []); assert.deepEqual(started, []);
  assert.ok(queries.length > 0 && queries.every((p) => p.pid === '555' || p.a === `order.sd-${MONTH}-0`), 'only looked for a shop order, found none');
  delete process.env.SANITY_API_TOKEN;
});
