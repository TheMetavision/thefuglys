// POST /api/sd-submit  { token, nick, dist, score }  ->  { ok, monthRank, allRank } or { ok:false, reason }
// Checks the ticket signature, that it is used once, and that the distance was physically reachable in the real time since the ticket was issued.
import { sdStore, readTicket, plausibility, validNick, addToBoard, monthId, json, readJson, rateLimited, MIN_BOARD_DIST } from '../lib/sd-shared.mjs';

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const body = await readJson(req, 1500);
  const ticket = body && readTicket(body.token);
  if (!ticket) return json({ ok: false, reason: 'ticket' }, 400);
  if (!validNick(body.nick)) return json({ ok: false, reason: 'nickname' }, 400);
  const dist = Math.floor(Number(body.dist)), score = Math.max(0, Math.floor(Number(body.score) || 0));
  if (!Number.isFinite(dist) || dist < 0 || dist > 200000) return json({ ok: false, reason: 'distance' }, 400);
  const now = Date.now(), elapsed = (now - ticket.t) / 1000;
  if (elapsed > 3 * 3600) return json({ ok: false, reason: 'expired' }, 400);
  const store = await sdStore();
  if (await rateLimited(store, req, context, 'submit', 120)) return json({ ok: false, reason: 'slow down' }, 429);
  const p = plausibility(dist, elapsed);
  if (!p.ok) return json({ ok: false, reason: 'impossible' }, 400);
  if (dist < MIN_BOARD_DIST) return json({ ok: true, monthRank: null, allRank: null, short: true });
  // each ticket counts once
  const used = await store.setJSON(`used/${monthId(new Date(ticket.t))}/${ticket.rid}`, { at: now }, { onlyIfNew: true });
  if (used && used.modified === false) return json({ ok: false, reason: 'used' }, 409);
  const entry = { rid: ticket.rid, nick: body.nick, dist, score, stage: ticket.stage, runner: ticket.runner, dev: ticket.dev, at: now, secs: Math.round(elapsed), flag: !!p.flag };
  const month = monthId(new Date(now));
  const monthRank = await addToBoard(store, `board/${month}`, entry);
  const allRank = await addToBoard(store, 'board/all', entry);
  return json({ ok: true, month, monthRank, allRank });
};
