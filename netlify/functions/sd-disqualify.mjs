// /api/sd-disqualify?m=<YYYY-MM>&i=<place>&s=<signature>   (the "Disqualify this run" link in the team emails)
//   GET  shows what will happen and a button; it changes nothing (mail scanners open links).
//   POST disqualifies that run and passes the prize to the next player (netlify/lib/sd-prize.mjs), also after a
//        claim (the team email then says to delete the Printful draft). The link is signed with the leaderboard
//        secret for that month and place, so it can't be made up or pointed at another run.
import { sdStore, esc, monthName } from '../lib/sd-shared.mjs';
import { sendEmail } from '../lib/sd-email.mjs';
import { update, readRecord, isLocked, passDown, dqValid, claimByDate } from '../lib/sd-prize.mjs';
import { passDownEmail } from '../lib/sd-prize-emails.mjs';

const page = (title, body, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="margin:0;background:#ffffff;color:#222222;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6"><main style="max-width:640px;margin:0 auto;padding:32px 16px"><h1 style="font-size:24px">${esc(title)}</h1>${body}</main></body></html>`,
  { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

/** Is run `idx` the one holding the prize right now (offered, or claimed)? */
const holds = (rec, idx) => (rec.status === 'open' && rec.offer && rec.offer.idx === idx) || (rec.status === 'claimed' && rec.claim && rec.claim.idx === idx);

export default async (req) => {
  const url = new URL(req.url);
  const form = req.method === 'POST' ? new URLSearchParams(await req.text()) : url.searchParams;
  const m = form.get('m') || url.searchParams.get('m') || '', i = Number(form.get('i') ?? url.searchParams.get('i')), s = form.get('s') || url.searchParams.get('s') || '';
  if (!dqValid(m, i, s)) return page('Link not valid', '<p>This disqualify link is incomplete or has been changed. Use the link in the email.</p>', 403);
  const store = await sdStore();

  if (req.method === 'GET') {
    const got = await readRecord(store, m);
    const rec = got && got.rec, c = rec && rec.candidates[i];
    if (!rec || !c) return page('Nothing to disqualify', '<p>There is no prize record for this month and place.</p>', 404);
    if (!holds(rec, i)) return page('Nothing to do', `<p>${esc(c.nick)} (#${i + 1}) doesn't hold the ${esc(monthName(m))} prize any more, so there's nothing to disqualify.</p>`);
    const claimed = rec.status === 'claimed';
    return page(`Disqualify ${c.nick}?`, `<p>${esc(c.nick)} (#${i + 1}, ${Number(c.dist).toLocaleString('en-GB')} m) ${claimed ? 'has claimed' : `holds, until ${esc(claimByDate(rec.offer.deadline))},`} the ${esc(monthName(m))} Scrap Dash prize.</p>
      <p>Disqualifying the run passes the prize to the next player in the top 10, with a new code. ${claimed ? '<b>They have already claimed: you will need to delete their Printful draft.</b>' : ''} This can't be undone.</p>
      <form method="post" action="/api/sd-disqualify"><input type="hidden" name="m" value="${esc(m)}"><input type="hidden" name="i" value="${i}"><input type="hidden" name="s" value="${esc(s)}">
      <button type="submit" style="font-size:16px;padding:10px 20px;background:#9b1c1c;color:#ffffff;border:0;border-radius:4px;cursor:pointer">Disqualify and pass the prize on</button></form>`);
  }
  if (req.method !== 'POST') return page('Not allowed', '<p>Use the link in the email.</p>', 405);

  let why = 'gone';
  const r = await update(store, m, (rec) => {
    if (!rec.candidates[i] || !holds(rec, i)) return null;
    if (rec.status === 'open' && isLocked(rec.offer)) { why = 'busy'; return null; }
    return passDown(rec, 'disqualified');
  });
  if (!r.changed) {
    if (why === 'busy') return page('Try again in a minute', '<p>This prize is being claimed right now. Open the link again in a couple of minutes.</p>', 409);
    return page('Nothing to do', "<p>That run doesn't hold the prize any more (it may already have passed on), so nothing was changed.</p>");
  }
  await sendEmail(passDownEmail({ before: r.before, rec: r.rec })).catch((e) => console.error('[SD-PRIZE] pass-down email failed:', e.message));
  const o = r.rec.offer, next = o ? r.rec.candidates[o.idx] : null;
  return page('Disqualified', `<p>${esc(r.before.candidates[i].nick)} is disqualified from the ${esc(monthName(m))} prize.</p>`
    + (next ? `<p>The prize has passed to #${o.idx + 1} ${esc(next.nick)}, who has until ${esc(claimByDate(o.deadline))} to claim. You've been emailed the details.</p>` : '<p>Nobody else in the top 10 is left, so the prize has lapsed.</p>'));
};
