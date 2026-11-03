/**
 * The referrer's thank-you: when a paid order used this brand's friend code
 * (FUG- / RAT- / MEOW- / BIKE-), issue the referrer a single-use 10% code
 * (FGTHX- / LRTHX- / COCTHX- / BBTHX-) and email it.
 *
 * New customers only (Alan, 3 Nov 2026). The friend coupon carries Stripe's
 * first_time_transaction restriction, but Stripe judges "first time" per
 * Customer and these checkouts are guests, so it lets anyone through: the code
 * owner on their own code, or a repeat buyer on a friend's. The discount is
 * still accepted (an accepted risk); the REWARD is not. checkReferral decides,
 * before the team email goes, and the reward is issued only when
 *   a) the buyer is not the code's owner (emails trimmed and lower-cased), and
 *   b) the brand's order log has no earlier paid order from the buyer's email
 *      (this order, drafts, another brand's misrouted order and, from a live
 *      checkout, preview test orders do not count).
 * Refused: no code, no email, referralError = self_referral / repeat_customer
 * on the order, and a line on the team email (referralNote). A failed lookup
 * never blocks the order or its emails: it is logged, the reward is skipped,
 * referralError = lookup_failed and the team email says so.
 *
 * Called by stripe-webhook.cjs after the order is saved and the customer and
 * team emails have gone, on a checkout's first delivery only (not a Stripe
 * retry, as Pixel8's create-once order). As a second guard the order is
 * claimed first: referredBy is written with ifRevisionId before any code is
 * created, so two deliveries racing never issue two thank-you codes.
 *
 * The email is only the promised reward: the code and the site link in the
 * footer, no "shop" button, so it is the referral programme keeping its
 * word, not a promotion. Another brand's friend code is ignored here; it is
 * already flagged on the team email by readDiscount.
 *
 * Never throws. A failure is logged and written to referralError on the
 * order; the payment, order and other emails are untouched.
 */
import { issueReward, isFriendCode, referralConfig } from './referral.mjs';
import { readDecideWrite, serverPatch } from './server-patch.mjs';
import { setting } from './site-config.mjs';
import { brandCard, brandLook, esc } from './dispatch-email.mjs';

export const SELF_REFERRAL = 'self_referral';
export const REPEAT_CUSTOMER = 'repeat_customer';
export const LOOKUP_FAILED = 'lookup_failed';

/** An email as the referral checks compare it: trimmed, lower-cased. */
export const normEmail = (email) => String(email || '').trim().toLowerCase();

/**
 * The buyer's earliest other paid order in this brand's log. Every order in
 * the log was paid (the webhook writes it on checkout.session.completed);
 * status other-brand is another brand's order logged here in error. A test
 * order from a preview never makes a live buyer a repeat customer.
 */
export const EARLIER_ORDER_QUERY =
  '*[_type == "order" && !(_id in path("drafts.**")) && _id != $docId && stripeSessionId != $sid' +
  ' && lower(customerEmail) == $email && !(status in ["other-brand", "cancelled", "refunded"])' +
  ' && ($test || test != true)] | order(placedAt asc)[0]{ _id, orderRef, placedAt }';

/**
 * Is the friend code on this checkout (if any) entitled to a thank-you?
 * Never throws.
 * @returns {Promise<null | { code: string, referrerEmail: string, referrerOrder: string,
 *   eligible: boolean, reason?: string, earlier?: object, error?: string }>}
 *   null when there is no friend code of this brand with a known referrer.
 */
export async function checkReferral({ sanity, promos, buyerEmail, docId, sessionId, test = false, log = console, brand = referralConfig().brand }) {
  const p = (promos || []).find((x) => isFriendCode(x, brand) && normEmail(x.metadata?.referrer_email));
  if (!p) return null;
  const r = { code: p.code, referrerEmail: normEmail(p.metadata.referrer_email), referrerOrder: p.metadata.referrer_order || '' };
  const buyer = normEmail(buyerEmail);
  if (buyer && buyer === r.referrerEmail) return { ...r, eligible: false, reason: SELF_REFERRAL };
  try {
    if (!buyer) throw new Error('no buyer email on the checkout');
    if (!sanity || typeof sanity.fetch !== 'function') throw new Error('no Sanity client');
    const earlier = await sanity.fetch(EARLIER_ORDER_QUERY, { email: buyer, docId: docId || '', sid: sessionId || '', test: !!test });
    if (earlier && earlier._id) return { ...r, eligible: false, reason: REPEAT_CUSTOMER, earlier };
    return { ...r, eligible: true };
  } catch (err) {
    const msg = err?.message || String(err);
    log.error(`referral: new-customer check for ${r.code} failed, no reward issued:`, msg);
    return { ...r, eligible: false, reason: LOOKUP_FAILED, error: msg };
  }
}

/** The team email's line for a refused or unchecked reward; '' otherwise. */
export function referralNote(check) {
  if (!check || check.eligible) return '';
  if (check.reason === SELF_REFERRAL) {
    return `Friend code ${check.code} used by an existing customer (the code's own owner) — no reward issued (self-referral).`;
  }
  if (check.reason === REPEAT_CUSTOMER) {
    const e = check.earlier || {};
    const ref = e.orderRef || e._id || '';
    return `Friend code ${check.code} used by an existing customer${ref ? ` (earlier order ${ref})` : ''} — no reward issued (repeat customer).`;
  }
  return `Friend code ${check.code} used, but the new-customer check failed (${check.error || 'unknown error'}) — no reward issued. ` +
    `If this is a genuinely new customer, issue the referrer (${check.referrerEmail}) a thank-you code by hand.`;
}

/** referralError for a refused reward: the reason, plus the error for a failed lookup. */
const refusalError = (check) =>
  (check.reason === LOOKUP_FAILED ? `${LOOKUP_FAILED} — ${String(check.error || '').slice(0, 300)}` : check.reason);

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
 * @param {string} [p.sessionId]      the Stripe checkout session, so the check skips this order
 * @param {boolean} [p.test]          a test-mode checkout
 * @param {object|null} [p.check]     checkReferral()'s answer, when the caller already has it
 * @returns {Promise<{ rewarded: boolean, rewardCode?: string, referrerEmail?: string, skipped?: string, refused?: string, error?: string }>}
 */
export async function rewardReferrer({ stripe, sanity, resend, docId, ref, promos, buyerEmail, sessionId, test = false, check, log = console, issue = issueReward }) {
  const c = check !== undefined ? check : await checkReferral({ sanity, promos, buyerEmail, docId, sessionId, test, log });
  if (!c) return { rewarded: false };
  if (!c.eligible) {
    log.warn(`referral: ${ref}: ${c.code} — no reward (${c.reason})`);
    await serverPatch(sanity, docId, { set: { referralError: refusalError(c) } })
      .catch((e) => log.error(`referral: could not record the refusal on ${ref}:`, e?.message || e));
    return { rewarded: false, refused: c.reason };
  }
  const r = { code: c.code, referrerEmail: c.referrerEmail, referrerOrder: c.referrerOrder };
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
