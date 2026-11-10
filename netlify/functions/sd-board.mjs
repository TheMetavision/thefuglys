// GET /api/sd-board?period=month|all|YYYY-MM  ->  { period, entries: [{ rank, nick, dist, score, stage, runner, at }] }
// Public view: no device ids, run ids or timings.
import { sdStore, monthId, publicEntry, json, PUBLIC_SIZE } from '../lib/sd-shared.mjs';

export default async (req) => {
  const q = new URL(req.url).searchParams.get('period') || 'month';
  const period = q === 'all' ? 'all' : /^\d{4}-\d{2}$/.test(q) ? q : monthId();
  const store = await sdStore();
  const board = await store.get(`board/${period}`, { type: 'json' });
  const entries = (board ? board.entries : []).slice(0, PUBLIC_SIZE).map(publicEntry);
  return json({ period, entries }, 200, { 'cache-control': 'public, max-age=20' });
};
