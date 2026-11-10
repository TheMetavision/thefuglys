// POST /api/sd-claim
//   { month, claimCode, claimant: 'winner' | 'guardian', name, email, address1, address2, town, postcode,
//     design, garment: 'tshirt' | 'kids-tshirt', colour, size, consent }
// Claims the prize for whoever holds the offer (netlify/lib/sd-prize.mjs):
//   1. checks the form, the UK postcode (England, Scotland, Wales, NI: src/lib/uk-postcode.mjs) and the code;
//      a claim after the window passes the prize down instead;
//   2. checks the T-shirt against that design's real Printful variants (Sanity, read only) and the Printful store;
//   3. holds the offer (offer.claiming), creates the Printful order as a DRAFT (confirm=false, always;
//      external_id sd-<month>-<place>, so a retry finds the same draft), then emails the team (with the draft
//      link, or what went wrong with Printful) and sends whoever claimed a receipt;
//   4. if either email fails, the hold is released and the claim can be made again; otherwise it is final.
// Personal details are NOT stored: they go only in the team email and the Printful draft. Nothing here writes
// to Sanity or touches the shop's order, shipping, post-delivery, referral or MailerLite flows.
import { sdStore, json, readJson, rateLimited } from '../lib/sd-shared.mjs';
import { sendEmail } from '../lib/sd-email.mjs';
import { update, isLocked, passDown, sanityRead, PRIZE_ONE_QUERY, PRIZE_GARMENTS, resolvePrize, prizeOrder, prizeExternalId } from '../lib/sd-prize.mjs';
import { claimTeamEmail, receiptEmail, passDownEmail, CLAIMANTS } from '../lib/sd-prize-emails.mjs';
import { ukPostcode } from '../../src/lib/uk-postcode.mjs';
import printful from '../../src/lib/printful-order.cjs';

const { createPrintfulOrder, checkStoreVariants } = printful;
const PRINTFUL_BUDGET_MS = 6000;
const NOT_OURS = 'NOT_IN_STORE';
const str = (v, max) => (typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null);

/** Release the hold so the same code can be used again. */
const release = (store, month, code) => update(store, month, (rec) => {
  if (!rec.offer || rec.offer.claimCode !== code || !rec.offer.claiming) return null;
  delete rec.offer.claiming; return rec;
});

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const store = await sdStore();
  if (await rateLimited(store, req, context, 'claim', 10)) return json({ ok: false, reason: 'slow down' }, 429);
  const b = await readJson(req, 3000);
  if (!b || !/^\d{4}-\d{2}$/.test(b.month) || b.consent !== true || !(b.claimant in CLAIMANTS)) return json({ ok: false, reason: 'form' }, 400);
  const f = { name: str(b.name, 80), email: str(b.email, 120), a1: str(b.address1, 120), a2: b.address2 ? str(b.address2, 120) : '', town: str(b.town, 80), pc: str(b.postcode, 12) };
  const pick = { design: str(b.design, 120), garment: b.garment in PRIZE_GARMENTS ? b.garment : null, colour: str(b.colour, 60), size: str(b.size, 20) };
  if (!f.name || !f.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email) || !f.a1 || !f.town || !f.pc || f.a2 === null || !pick.design || !pick.garment || !pick.colour || !pick.size) return json({ ok: false, reason: 'form' }, 400);
  const pc = ukPostcode(f.pc);
  if (!pc.ok) return json({ ok: false, reason: 'postcode-' + pc.reason }, 400);
  f.pc = pc.postcode;
  const code = typeof b.claimCode === 'string' ? b.claimCode.trim().toUpperCase() : '';
  const month = b.month, now = Date.now();

  // The code must be the current offer's; after its window the prize passes on instead.
  let reason = null, expired = null;
  const check = await update(store, month, (rec) => {
    if (rec.status === 'claimed' && rec.claim && rec.claim.claimCode === code) { reason = 'claimed'; return null; }
    if (rec.status !== 'open' || !rec.offer || rec.offer.claimCode !== code) { reason = 'code'; return null; }
    if (isLocked(rec.offer, now)) { reason = 'busy'; return null; }
    if (now >= rec.offer.deadline) { reason = 'expired'; return passDown(rec, 'expired', now); }
    return null;
  });
  if (!check.rec) return json({ ok: false, reason: 'code' }, 400);
  if (reason === 'expired' && check.changed) expired = check;
  if (expired) await sendEmail(passDownEmail({ before: expired.before, rec: expired.rec })).catch((e) => console.error('[SD-PRIZE] pass-down email failed:', e.message));
  if (reason) return json({ ok: false, reason }, reason === 'busy' || reason === 'claimed' ? 409 : 400);
  const idx = check.rec.offer.idx;

  // The T-shirt: one of that design's real variants, still in the Printful store.
  let prize;
  try { prize = resolvePrize(await sanityRead(PRIZE_ONE_QUERY, { slug: pick.design }), pick); }
  catch (e) { console.error('[SD-PRIZE] catalogue read failed:', e.message); return json({ ok: false, reason: 'other' }, 503); }
  if (!prize) return json({ ok: false, reason: 'prize' }, 400);
  const apiKey = process.env.PRINTFUL_API_KEY;
  const deadline = Date.now() + PRINTFUL_BUDGET_MS;
  if (apiKey) {
    const { problems, unverified } = await checkStoreVariants({ apiKey, ids: [prize.syncVariantId], deadline, notOursText: NOT_OURS });
    if (problems.some((p) => p.includes(NOT_OURS))) return json({ ok: false, reason: 'prize' }, 400);
    if (problems.length || unverified.length) console.warn('[SD-PRIZE] variant check:', [...problems, ...unverified].join('; '));
  }

  // Hold the offer while the draft and the emails go.
  const held = await update(store, month, (rec) => {
    if (rec.status !== 'open' || !rec.offer || rec.offer.claimCode !== code || isLocked(rec.offer)) return null;
    rec.offer.claiming = { at: Date.now() }; return rec;
  });
  if (!held.changed) return json({ ok: false, reason: 'busy' }, 409);

  // The Printful order: a DRAFT for the team to confirm. Never confirmed here, whatever PRINTFUL_AUTO_CONFIRM says.
  const externalId = prizeExternalId(month, idx);
  let draft;
  if (!apiKey) draft = { ok: false, error: 'PRINTFUL_API_KEY is not set' };
  else draft = await createPrintfulOrder({ apiKey, order: prizeOrder({ month, idx, f, prize }), confirm: false, deadline });
  draft = { ...draft, externalId };
  if (!draft.ok) console.error(`[SD-PRIZE] ${externalId}: Printful draft not created: ${draft.error}`);

  try {
    await sendEmail(claimTeamEmail({ rec: held.rec, idx, claimant: b.claimant, f, prize, draft }));
    await sendEmail(receiptEmail({ rec: held.rec, idx, claimant: b.claimant, f, prize }));
  } catch (e) {
    console.error(`[SD-PRIZE] ${externalId}: email failed, claim released:`, e.message);
    await release(store, month, code).catch((err) => console.error('[SD-PRIZE] release failed:', err.message));
    return json({ ok: false, reason: 'email' }, 502);
  }

  const done = await update(store, month, (rec) => {
    if (!rec.offer || rec.offer.claimCode !== code) return null;
    rec.claim = { idx, claimCode: code, at: Date.now(), claimant: b.claimant, design: prize.design, garment: prize.garment, colour: prize.colour, size: prize.size, printfulOrderId: draft.ok ? draft.id ?? null : null, draftOk: !!draft.ok };
    rec.offer = null; rec.status = 'claimed'; return rec;
  });
  if (!done.changed) console.error(`[SD-PRIZE] ${externalId}: claim emailed but the record could not be marked claimed.`);
  return json({ ok: true });
};
