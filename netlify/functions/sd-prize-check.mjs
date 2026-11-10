// Scheduled daily: every Scrap Dash prize offer whose claim window has run out passes to the next player
// (netlify/lib/sd-prize.mjs: 30 days after the month for the winner, 14 days for each next player, down the
// top 10), and the team gets an email for each one.
import { sdStore } from '../lib/sd-shared.mjs';
import { sendEmail } from '../lib/sd-email.mjs';
import { expireDue } from '../lib/sd-prize.mjs';
import { passDownEmail } from '../lib/sd-prize-emails.mjs';

export async function checkWindows(now = Date.now()) {
  const store = await sdStore();
  const done = await expireDue(store, now);
  for (const d of done) await sendEmail(passDownEmail(d)).catch((e) => console.error(`[SD-PRIZE] ${d.month}: pass-down email failed:`, e.message));
  return done.map((d) => ({ month: d.month, status: d.rec.status, idx: d.rec.offer ? d.rec.offer.idx : null }));
}

export default async () => { const r = await checkWindows(); console.log('[SD-PRIZE] window check:', JSON.stringify(r)); return new Response('ok'); };
export const config = { schedule: '15 6 * * *' };
