/**
 * The referrer's thank-you: when a paid order used this brand's friend code
 * (FUG- / RAT- / MEOW- / BIKE-), issue the referrer a single-use 10% code
 * (FGTHX- / LRTHX- / COCTHX- / BBTHX-) and email it.
 *
 * Called by stripe-webhook.cjs after the order is saved and the customer and
 * team emails have gone, on a checkout's first delivery only (not a Stripe
 * retry, as Pixel8's create-once order). As a second guard the order is
 * claimed first: referredBy is written with ifRevisionId before any code is
 * created, so two deliveries racing never issue two thank-you codes.
 *
 * The email is only the promised reward: the code and the site link in the
 * footer, no "shop" button, so it is the referral programme keeping its
 * word, not a promotion. Self-referral (own code, same email) and another
 * brand's friend code are ignored by referralsFrom; another brand's code is
 * already flagged on the team email by readDiscount.
 *
 * Never throws. A failure is logged and written to referralError on the
 * order; the payment, order and other emails are untouched.
 */
import { referralsFrom, issueReward } from './referral.mjs';
import { readDecideWrite, serverPatch } from './server-patch.mjs';
import { setting } from './site-config.mjs';
import { brandCard, brandLook, esc } from './dispatch-email.mjs';

/** @returns {{ subject: string, html: string }} */
export function rewardEmail(rewardCode, b = brandLook()) {
  const inner = `
    <p style="margin:0 0 16px;">Someone you shared your code with has just placed their first ${esc(b.name)} order. As promised, here's 10% off your next one:</p>
    <p style="margin:0 0 16px;padding:16px;border:1px solid ${esc(b.accent)};text-align:center;font-size:24px;font-weight:700;letter-spacing:2px;color:${esc(b.heading)};">${esc(rewardCode)}</p>
    <p style="margin:0;font-size:13px;color:${esc(b.muted)};">Enter it in the promotion code box at checkout. It works once.</p>`;
  return {
    subject: `Your friend ordered. Here’s your 10% thank you from ${b.short}`,
    html: brandCard('Thanks for the referral', inner, b),
  };
}

/**
 * @param {object} p
 * @param {object} p.stripe
 * @param {object} p.sanity
 * @param {object|null} p.resend      anything with emails.send({ from, to, subject, html }) -> { error }
 * @param {string} p.docId            the order (published id)
 * @param {string} p.ref              #XXXXXXXX, for the code's metadata and the logs
 * @param {object[]} p.promos         readDiscount().promos
 * @param {string} p.buyerEmail
 * @returns {Promise<{ rewarded: boolean, rewardCode?: string, referrerEmail?: string, skipped?: string, error?: string }>}
 */
export async function rewardReferrer({ stripe, sanity, resend, docId, ref, promos, buyerEmail, log = console, issue = issueReward }) {
  const referrals = referralsFrom(promos, buyerEmail);
  if (!referrals.length) return { rewarded: false };
  const r = referrals[0];
  try {
    let skip = null;
    const claim = await readDecideWrite(sanity, docId, (fresh) => {
      if (!fresh) { skip = 'order not found'; return null; }
      if (fresh.referredBy) { skip = 'already rewarded'; return null; }
      return { set: { referredBy: { code: r.code, referrerEmail: r.referrerEmail, referrerOrder: r.referrerOrder } } };
    });
    if (!claim.written) {
      log.log(`referral: ${ref}: ${skip || 'nothing to do'}`);
      return { rewarded: false, skipped: skip || 'nothing to do' };
    }
    const rewardCode = await issue(stripe, { referrerEmail: r.referrerEmail, referredOrder: ref });
    await serverPatch(sanity, docId, { set: { 'referredBy.rewardCode': rewardCode } });
    if (!resend) throw new Error('RESEND_API_KEY is not set on this deploy');
    const { subject, html } = rewardEmail(rewardCode);
    const { error } = await resend.emails.send({
      from: setting('EMAIL_FROM'), reply_to: setting('EMAIL_REPLY_TO'), to: [r.referrerEmail], subject, html,
    });
    if (error) throw new Error(`${error.name || 'Error'}: ${error.message || 'Resend rejected the send'}`);
    log.log(`referral: reward ${rewardCode} sent to the referrer of ${ref} (${r.code})`);
    return { rewarded: true, rewardCode, referrerEmail: r.referrerEmail };
  } catch (err) {
    const msg = err?.message || String(err);
    log.error(`referral: reward for ${ref} failed:`, msg);
    await serverPatch(sanity, docId, { set: { referralError: `${new Date().toISOString()} — ${msg.slice(0, 300)}` } })
      .catch((e) => log.error(`referral: could not record the error on ${ref}:`, e?.message || e));
    return { rewarded: false, error: msg };
  }
}
