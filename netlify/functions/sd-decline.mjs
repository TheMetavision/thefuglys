// POST /api/sd-decline  { month, claimCode }  ->  { ok } | { ok: false, reason }
// "We can't use a UK address": whoever holds the prize passes it to the next player at once
// (netlify/lib/sd-prize.mjs), and the team gets an email. Needs the current claim code.
import { sdStore, json, readJson, rateLimited } from '../lib/sd-shared.mjs';
import { sendEmail } from '../lib/sd-email.mjs';
import { update, isLocked, passDown } from '../lib/sd-prize.mjs';
import { passDownEmail } from '../lib/sd-prize-emails.mjs';

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const store = await sdStore();
  if (await rateLimited(store, req, context, 'claim', 10)) return json({ ok: false, reason: 'slow down' }, 429);
  const b = await readJson(req, 400);
  if (!b || !/^\d{4}-\d{2}$/.test(b.month) || typeof b.claimCode !== 'string') return json({ ok: false, reason: 'code' }, 400);
  const code = b.claimCode.trim().toUpperCase();
  let reason = 'code';
  const r = await update(store, b.month, (rec) => {
    if (rec.status !== 'open' || !rec.offer || rec.offer.claimCode !== code) return null;
    if (isLocked(rec.offer)) { reason = 'busy'; return null; }
    return passDown(rec, 'declined');
  });
  if (!r.changed) return json({ ok: false, reason }, reason === 'busy' ? 409 : 400);
  await sendEmail(passDownEmail({ before: r.before, rec: r.rec })).catch((e) => console.error('[SD-PRIZE] pass-down email failed:', e.message));
  return json({ ok: true });
};
