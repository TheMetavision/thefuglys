// POST /api/sd-winner  { deviceKey, month? }  ->  { won, month?, claimCode?, nick?, dist?, rank?, passedDown?, claimBy?, claimed? }
// Only the device that holds an open prize offer sees its claim code (it proves this with the secret key whose hash
// is on the run). That may be last month's win, or a prize that passed down to it later (netlify/lib/sd-prize.mjs):
// the offers/<device>/ markers find it. `month` is still read so an older copy of the game keeps working.
import { sdStore, json, readJson, rateLimited } from '../lib/sd-shared.mjs';
import { readRecord, offerMonthsFor, claimByDate } from '../lib/sd-prize.mjs';

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const body = await readJson(req, 400);
  if (!body || typeof body.deviceKey !== 'string' || !/^[a-f0-9]{64}$/.test(body.deviceKey)) return json({ won: false });
  const store = await sdStore();
  if (await rateLimited(store, req, context, 'winner', 60)) return json({ won: false });
  const { dev, months } = await offerMonthsFor(store, body.deviceKey);
  if (/^\d{4}-\d{2}$/.test(body.month || '') && !months.includes(body.month)) months.push(body.month);
  const now = Date.now();
  for (const month of months.sort()) {
    const got = await readRecord(store, month);
    const rec = got && got.rec, o = rec && rec.offer;
    if (!rec || rec.status !== 'open' || !o || now >= o.deadline) continue;
    const c = rec.candidates[o.idx];
    if (!c || c.dev !== dev) continue;
    return json({ won: true, month, claimCode: o.claimCode, nick: c.nick, dist: c.dist, rank: o.idx + 1, passedDown: o.idx > 0, claimBy: claimByDate(o.deadline), claimed: false });
  }
  return json({ won: false });
};
