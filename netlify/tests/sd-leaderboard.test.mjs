import { setStoreForTests, minSeconds, signTicket, sha256, monthId } from '../lib/sd-shared.mjs';
process.env.SD_LEADERBOARD_SECRET = 'test-secret-0123456789-abcdefghijklmnop';
// in-memory Netlify Blobs with etags and conditional writes
const mem = new Map(); let n = 0;
setStoreForTests({
  async get(k, o) { const v = mem.get(k); return v ? JSON.parse(v.d) : null; },
  async getWithMetadata(k) { const v = mem.get(k); return v ? { data: JSON.parse(v.d), etag: v.e } : null; },
  async setJSON(k, val, o = {}) { const cur = mem.get(k);
    if (o.onlyIfNew && cur) return { modified: false }; if (o.onlyIfMatch && (!cur || cur.e !== o.onlyIfMatch)) return { modified: false };
    mem.set(k, { d: JSON.stringify(val), e: 'e' + (++n) }); return { modified: true, etag: 'e' + n }; },
  async *list({ prefix }) { yield { blobs: [...mem.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; },
  async delete(k) { mem.delete(k); },
});
const sent = []; // Resend is recorded; the prize claim also reads the T-shirt from Sanity and makes a Printful draft (faked here).
const PRODUCT = { name: 'Wasteland Warriors', slug: 'wasteland-warriors', variants: [{ productType: 'tshirt', printfulVariants: [{ colour: 'Black', size: 'M', syncVariantId: '6001' }] }] };
process.env.PRINTFUL_API_KEY = 'pf_test';
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  if (u.hostname === 'api.resend.com') { sent.push(JSON.parse(init.body)); return new Response('{"id":"x"}', { status: 200 }); }
  if (u.hostname.endsWith('api.sanity.io')) return new Response(JSON.stringify({ result: PRODUCT }), { status: 200 });
  if (u.hostname === 'api.printful.com') return new Response(JSON.stringify({ result: { id: 555 } }), { status: 200 });
  throw new Error('unexpected network call ' + url);
};
const start = (await import('../functions/sd-start.mjs')).default, submit = (await import('../functions/sd-submit.mjs')).default;
const board = (await import('../functions/sd-board.mjs')).default, winner = (await import('../functions/sd-winner.mjs')).default;
const claim = (await import('../functions/sd-claim.mjs')).default, { closeMonth } = await import('../functions/sd-close-month.mjs');
const post = (fn, body, ip = '1.1.1.1') => fn(new Request('https://x/api', { method: 'POST', body: JSON.stringify(body), headers: { 'x-nf-client-connection-ip': ip } }), { ip });
const keyA = 'a'.repeat(64), keyB = 'b'.repeat(64), devA = sha256(keyA), devB = sha256(keyB);
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);

console.log('fastest possible: 1,000 m in', minSeconds(1000).toFixed(1), 's; 2,000 m in', minSeconds(2000).toFixed(1), 's; 5,000 m in', minSeconds(5000).toFixed(1), 's');
// a ticket from the server, then pretend real time has passed by back-dating it (as if issued N seconds ago)
const ticketAgo = (secs, dev, stage = 'boneyard') => signTicket({ rid: Math.random().toString(36).slice(2), t: Date.now() - secs * 1000, stage, runner: 'trixie', dev });
let r = await (await post(start, { stage: 'boneyard', runner: 'trixie', dev: devA })).json(); ok(!!r.token, 'start issues a signed ticket');
for (const bad of [{ stage: 'ductways', runner: 'trixie' }, { stage: 'boneyard', runner: 'shadow' }, { stage: 'boneyard', runner: 'trixie', dev: 'nothex' }]) {
  const x = await post(start, { dev: devA, ...bad }); ok(x.status === 400, `start refuses ${JSON.stringify(bad)}`); }
r = await (await post(submit, { token: r.token, nick: 'RustyHubcap07', dist: 3000, score: 9999 })).json(); ok(r.ok === false && r.reason === 'impossible', '3,000 m claimed instantly is rejected as impossible');
r = await (await post(submit, { token: ticketAgo(30, devA), nick: 'RustyHubcap07', dist: 2000 })).json(); ok(r.ok === false && r.reason === 'impossible', '2,000 m in 30 s is rejected');
const tk = ticketAgo(200, devA);
r = await (await post(submit, { token: tk, nick: 'RustyHubcap07', dist: 2000, score: 5000 })).json(); ok(r.ok && r.monthRank === 1, '2,000 m in 200 s is accepted, rank 1 this month');
r = await (await post(submit, { token: tk, nick: 'RustyHubcap07', dist: 2000 })).json(); ok(r.ok === false && r.reason === 'used', 'the same ticket cannot be used twice');
r = await (await post(submit, { token: tk.slice(0, -3) + 'abc', nick: 'RustyHubcap07', dist: 9000 })).json(); ok(r.ok === false && r.reason === 'ticket', 'a tampered ticket is rejected');
const forged = Buffer.from(JSON.stringify({ rid: 'x', t: Date.now() - 9e5, stage: 'boneyard', runner: 'trixie', dev: devA })).toString('base64url') + '.fake';
r = await (await post(submit, { token: forged, nick: 'RustyHubcap07', dist: 9000 })).json(); ok(r.ok === false && r.reason === 'ticket', 'a forged ticket is rejected');
r = await (await post(submit, { token: ticketAgo(200, devA), nick: 'BigPoo99', dist: 1500 })).json(); ok(r.ok === false && r.reason === 'nickname', 'a typed or rude nickname is rejected');
r = await (await post(submit, { token: ticketAgo(300, devB), nick: 'SpeedyPiston42', dist: 2600, score: 100 })).json(); ok(r.ok && r.monthRank === 1, 'a second player with 2,600 m takes rank 1');
r = await (await post(submit, { token: ticketAgo(120, devA), nick: 'RustyHubcap07', dist: 1200 })).json(); ok(r.ok && r.monthRank === 2, "a player's shorter run keeps their better entry (rank 2)");
const b = await (await board(new Request('https://x/api/sd-board?period=month'))).json();
ok(b.entries.length === 2 && b.entries[0].nick === 'SpeedyPiston42' && !('dev' in b.entries[0]) && !('rid' in b.entries[0]), 'public board: one entry per player, sorted, no device or run ids');
// month close: pretend it is the 1st of next month
const [y, m] = monthId().split('-').map(Number), next = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 2));
const c = await closeMonth(next); ok(c.winner === 'SpeedyPiston42', 'month close picks the furthest run');
ok(sent.length === 1 && sent[0].to === 'contact@thefuglys.com' && /claim code/i.test(sent[0].html), 'summary email goes to contact@thefuglys.com with the claim code');
const c2 = await closeMonth(next); ok(c2.winner === 'already closed' && sent.length === 1, 'closing twice does nothing');
const month = monthId();
r = await (await post(winner, { month, deviceKey: keyA })).json(); ok(r.won === false, "another player's device is not told the claim code");
r = await (await post(winner, { month, deviceKey: keyB })).json(); ok(r.won && /^[A-Z2-9]{8}$/.test(r.claimCode), "the winner's device sees its claim code");
const form = { month, claimCode: r.claimCode, claimant: 'guardian', name: 'Pat Parent', email: 'pat@example.com', address1: '1 Scrap Lane', town: 'Southend-on-Sea', postcode: 'SS1 1AA', design: 'wasteland-warriors', garment: 'tshirt', colour: 'Black', size: 'M', consent: true };
let cr = await (await post(claim, { ...form, claimCode: 'WRONG123' })).json(); ok(cr.ok === false && cr.reason === 'code', 'a wrong claim code is refused');
cr = await (await post(claim, { ...form, consent: false })).json(); ok(cr.ok === false, 'a claim without the parent/guardian consent box is refused');
cr = await (await post(claim, form)).json(); ok(cr.ok && sent.length === 3 && sent[1].to === 'contact@thefuglys.com' && sent[2].to === 'pat@example.com', 'a valid claim emails you the details and sends the parent a receipt');
cr = await (await post(claim, form)).json(); ok(cr.ok === false && cr.reason === 'claimed', 'a prize can only be claimed once');
ok(!JSON.stringify([...mem.values()]).includes('Scrap Lane') && !JSON.stringify([...mem.values()]).includes('pat@example.com'), 'no address or email is stored in the leaderboard storage');
let limited = false; for (let i = 0; i < 12; i++) { const x = await post(claim, form, '9.9.9.9'); if (x.status === 429) limited = true; } ok(limited, 'claim attempts are rate-limited');

// housekeeping
{ const { tidy } = await import('../functions/sd-close-month.mjs');
  mem.set('used/2020-01/old', { d: '{}', e: 'x' }); mem.set('rl/1/start/abc', { d: '1', e: 'x' }); mem.set('board/2020-01', { d: '{"entries":[]}', e: 'x' });
  const keepBoard = 'board/' + monthId(); const had = mem.has(keepBoard);
  await tidy({ list: async function* ({ prefix }) { yield { blobs: [...mem.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; }, delete: async k => { mem.delete(k); } });
  ok(!mem.has('used/2020-01/old') && !mem.has('rl/1/start/abc'), 'month-end tidy deletes old run tickets and anti-spam counters');
  ok(!mem.has('board/2020-01') && mem.has(keepBoard) === had && mem.has('board/all'), 'boards older than 24 months are deleted; this month and all-time are kept');
  ok([...mem.keys()].some(k => k.startsWith('winners/')), 'winner records (no personal details) are kept as prize history');
}
