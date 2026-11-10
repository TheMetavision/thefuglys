/**
 * The Scrap Dash prize emails, as pure builders: each returns
 * { to, subject, html, customer?, title?, replyTo? } for sendEmail()
 * (netlify/lib/sd-email.mjs, which adds the logo bar or the customer card).
 * The functions send them; tests/sd-prize.test.mjs checks them.
 *
 * Team emails go to CONTACT_EMAIL. The only customer email is the claim
 * receipt, worded for whoever claimed: the winner (18 or over), or the
 * winner's parent or guardian.
 */
import { esc, monthName, CONTACT_EMAIL } from './sd-shared.mjs';
import { claimByDate, dqUrl, printfulOrderLink, TOP_N } from './sd-prize.mjs';

export const CLAIMANTS = {
  winner: { team: 'The winner (18 or over)', consent: "the claimant states they are the winner and are 18 or over" },
  guardian: { team: "The winner's parent or guardian", consent: "the claimant states they are the winner's parent or guardian and are 18 or over" },
};

const km = (n) => Number(n).toLocaleString('en-GB');
const place = (idx) => (idx === 0 ? 'the winner' : `#${idx + 1} on the board (the prize passed down to them)`);
const runLine = (c, idx) => `${esc(c.nick)}, ${km(c.dist)} m on ${esc(c.stage)} as ${esc(c.runner)}: ${place(idx)}`;
const flagLine = (c) => (c && c.flag ? '<p><b>This run is flagged:</b> it finished close to the fastest physically possible time. Check it before confirming the prize.</p>' : '');
const dqLine = (month, idx) => `<p><a href="${esc(dqUrl(month, idx))}">Disqualify this run</a> (opens a page to confirm; the prize then passes to the next player).</p>`;
const REASONS = {
  expired: (by) => `didn't claim by ${esc(by)}`,
  declined: () => "said they can't use a UK address",
  disqualified: () => 'was disqualified',
};

/** Month close: the winner, their code and deadline, the top 10. */
export function monthCloseEmail({ rec }) {
  const month = monthName(rec.month), c = rec.candidates[0], o = rec.offer;
  const rows = rec.candidates.map((e, i) => `<tr><td>${i + 1}</td><td>${esc(e.nick)}</td><td>${km(e.dist)} m</td><td>${esc(e.stage)}</td><td>${esc(e.runner)}</td><td>${Math.floor(e.secs / 60)}m ${e.secs % 60}s</td><td>${e.flag ? 'CHECK' : ''}</td></tr>`).join('');
  return {
    to: CONTACT_EMAIL,
    subject: `Scrap Dash leaderboard: ${month} winner is ${c.nick}`,
    html: `<h2>Scrap Dash: ${esc(month)}</h2>
      <p><b>Winner:</b> ${esc(c.nick)}, ${km(c.dist)} m. Claim code: <b>${esc(o.claimCode)}</b>. Claim by: <b>${esc(claimByDate(o.deadline))}</b></p>
      <p>The winner sees a "You won!" message next time they open the game on the same device. The winner, or their parent or guardian if they're under 18, claims at thefuglys.com/games/claim/ and chooses the T-shirt. You'll get a second email with their details and a Printful draft to confirm.</p>
      <p>If they can't give a UK address, don't claim in time, or you disqualify the run, the prize passes down the top ${TOP_N} automatically and you'll get an email each time.</p>
      ${flagLine(c)}${dqLine(rec.month, 0)}
      <table border="1" cellpadding="6" style="border-collapse:collapse"><tr><th>#</th><th>Nickname</th><th>Distance</th><th>Stage</th><th>Runner</th><th>Run time</th><th>Flag</th></tr>${rows}</table>`,
  };
}

/** The claim, for the team: who claimed, the T-shirt, the Printful draft, the address. */
export function claimTeamEmail({ rec, idx, claimant, f, prize, draft }) {
  const month = monthName(rec.month), c = rec.candidates[idx];
  const link = draft && draft.ok ? printfulOrderLink(draft.id) : printfulOrderLink(null);
  const printful = draft && draft.ok
    ? `<p><b>Printful:</b> DRAFT order ${draft.id ? '#' + esc(draft.id) + ' ' : ''}${draft.existing ? 'was already there (a repeat claim: check the address matches the one below)' : 'created'}. It is <b>not confirmed</b>: check the winning run, then <a href="${esc(link)}">confirm it in Printful</a>. External ID: ${esc(draft.externalId)}.</p>`
    : `<p><b>Printful: the draft was NOT created.</b> ${esc((draft && draft.error) || 'Unknown error')}. Create the order by hand in <a href="${esc(link)}">Printful</a> (external ID ${esc(draft && draft.externalId)}), using the details below.</p>`;
  return {
    to: CONTACT_EMAIL, replyTo: f.email,
    subject: `Scrap Dash prize claim: ${month} (${c.nick})${draft && draft.ok ? '' : ': Printful draft NOT created'}`,
    html: `<h2>Scrap Dash prize claim: ${esc(month)}</h2>
      <p><b>Player:</b> ${runLine(c, idx)}${c.flag ? ' <b>(flagged for review: run was close to the fastest possible time)</b>' : ''}</p>
      <p><b>Claimed by:</b> ${esc(CLAIMANTS[claimant].team)}<br><b>Name:</b> ${esc(f.name)}<br><b>Email:</b> ${esc(f.email)}</p>
      <p><b>T-shirt:</b> ${esc(prize.name)}, ${esc(prize.garmentLabel)}, ${esc(prize.colour)}, size ${esc(prize.size)} (Printful sync variant ${esc(prize.syncVariantId)})</p>
      ${printful}
      <p><b>Deliver to:</b><br>${esc(f.name)}<br>${esc(f.a1)}<br>${f.a2 ? esc(f.a2) + '<br>' : ''}${esc(f.town)}<br>${esc(f.pc)}<br>United Kingdom</p>
      ${dqLine(rec.month, idx)}
      <p>Consent confirmed: ${esc(CLAIMANTS[claimant].consent)}, and agrees to the leaderboard rules.</p>
      <p>Delete this email once the prize has been sent.</p>`,
  };
}

/** The receipt, to whoever claimed. */
export function receiptEmail({ rec, idx, claimant, f, prize }) {
  const month = monthName(rec.month), c = rec.candidates[idx];
  const m = esc(month), nick = `<b>${esc(c.nick)}</b>`;
  const opening = claimant === 'winner'
    ? (idx === 0
      ? `<p>Congratulations on winning the ${m} Scrap Dash leaderboard as ${nick}, and thanks for claiming your prize.</p>`
      : `<p>Congratulations: the ${m} Scrap Dash leaderboard prize passed down to you, ${nick}, as the next player in line. Thanks for claiming it.</p>`)
    : (idx === 0
      ? `<p>Thanks for claiming the ${m} Scrap Dash leaderboard prize your winner, ${nick}, won.</p>`
      : `<p>Thanks for claiming the ${m} Scrap Dash leaderboard prize for your winner, ${nick}. It passed down to them as the next player in line.</p>`);
  return {
    to: f.email, customer: true, title: 'Prize claim received',
    subject: 'Your Fuglys Scrap Dash prize claim',
    html: `<p>Hi ${esc(f.name)},</p>${opening}
      <p><b>T-shirt:</b> ${esc(prize.name)}, ${esc(prize.garmentLabel)}, ${esc(prize.colour)}, size ${esc(prize.size)}</p>
      <p><b>Posting to:</b> ${esc(f.a1)}, ${f.a2 ? esc(f.a2) + ', ' : ''}${esc(f.town)}, ${esc(f.pc)}</p>
      <p>We'll check the winning run, then post the T-shirt within 28 days.</p>
      <p>We only use these details to send the prize. Our printing partner gets the name and address to make and post the T-shirt, and we delete our copy once it has been sent.</p>
      <p>The Fuglys team</p>`,
  };
}

/** The prize passed on (or lapsed): why, and who holds it now. */
export function passDownEmail({ before, rec }) {
  const month = monthName(rec.month);
  const last = rec.history[rec.history.length - 1];
  const from = before.candidates[last.idx] || { nick: last.nick };
  const by = before.offer ? claimByDate(before.offer.deadline) : '';
  const why = `${esc(from.nick)} (#${last.idx + 1}) ${REASONS[last.outcome](by)}.`;
  const draftNote = last.printfulOrderId ? `<p><b>Delete their Printful draft #${esc(last.printfulOrderId)}</b> so it isn't sent.</p>` : (last.outcome === 'disqualified' && before.status === 'claimed' ? '<p><b>They had already claimed: delete their Printful draft</b> so it isn\'t sent.</p>' : '');
  if (rec.status === 'lapsed') {
    return {
      to: CONTACT_EMAIL,
      subject: `Scrap Dash prize lapsed: ${month}`,
      html: `<h2>Scrap Dash prize lapsed: ${esc(month)}</h2><p>${why}</p>${draftNote}
        <p>Nobody else in the top ${TOP_N} is left to offer it to, so the ${esc(month)} prize has lapsed. Nothing more will happen for this month.</p>`,
    };
  }
  const o = rec.offer, c = rec.candidates[o.idx];
  return {
    to: CONTACT_EMAIL,
    subject: `Scrap Dash prize passed on: ${month}, now ${c.nick} (#${o.idx + 1})`,
    html: `<h2>Scrap Dash prize passed on: ${esc(month)}</h2><p>${why}</p>${draftNote}
      <p><b>Now offered to:</b> #${o.idx + 1} ${esc(c.nick)}, ${km(c.dist)} m on ${esc(c.stage)} as ${esc(c.runner)}.<br><b>New claim code:</b> ${esc(o.claimCode)}<br><b>Claim by:</b> ${esc(claimByDate(o.deadline))}</p>
      <p>They see a "You won!" message with the new code next time they open the game on their device. If they don't claim in time, it passes on again.</p>
      ${flagLine(c)}${dqLine(rec.month, o.idx)}`,
  };
}
