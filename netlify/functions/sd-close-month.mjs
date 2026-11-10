// Scheduled: runs early on the 1st of each month (UTC). Keeps last month's top 10, offers the prize to the
// furthest run (a claim code, 30 days after the month ends: netlify/lib/sd-prize.mjs) and emails a summary
// (top 10, flags, disqualify link) to contact@thefuglys.com so the winner can be checked before the prize goes out.
import { sdStore, prevMonthId, monthId, KEEP_MONTHS } from '../lib/sd-shared.mjs';
import { sendEmail } from '../lib/sd-email.mjs';
import { newRecord, createRecord } from '../lib/sd-prize.mjs';
import { monthCloseEmail } from '../lib/sd-prize-emails.mjs';

// Housekeeping: nothing builds up forever. Old run tickets and anti-spam counters go, and monthly boards
// older than KEEP_MONTHS are deleted. Prize records (winners/) and the offer markers (offers/) hold no personal details; prize records are kept as
// the prize history, and offer markers are removed when an offer ends.
export async function tidy(store, now = new Date()) {
  const keys = async prefix => { const out = []; for await (const page of store.list({ prefix, paginate: true })) out.push(...page.blobs.map(b => b.key)); return out; };
  const thisMonth = monthId(now), hourNow = Math.floor(now.getTime() / 3600000);
  let removed = 0;
  for (const k of await keys('used/')) if (k.split('/')[1] < thisMonth) { await store.delete(k); removed++; }
  for (const k of await keys('rl/')) if (+k.split('/')[1] < hourNow - 2) { await store.delete(k); removed++; }
  const [y, m] = thisMonth.split('-').map(Number), cut = new Date(Date.UTC(y, m - 1 - KEEP_MONTHS, 1)), oldest = cut.getUTCFullYear() + '-' + String(cut.getUTCMonth() + 1).padStart(2, '0');
  for (const k of await keys('board/')) { const id = k.slice(6); if (/^\d{4}-\d{2}$/.test(id) && id < oldest) { await store.delete(k); removed++; } }
  return removed;
}

export async function closeMonth(now = new Date()) {
  const month = prevMonthId(now), store = await sdStore();
  await tidy(store, now);
  const board = await store.get(`board/${month}`, { type: 'json' });
  const entries = board ? board.entries : [];
  if (!entries.length) return { month, winner: null };
  const rec = newRecord(month, entries, now.getTime());
  if (!(await createRecord(store, rec))) return { month, winner: 'already closed' };
  await sendEmail(monthCloseEmail({ rec }));
  return { month, winner: rec.candidates[0].nick };
}

export default async () => { await closeMonth(); return new Response('ok'); };
export const config = { schedule: '30 1 1 * *' };
