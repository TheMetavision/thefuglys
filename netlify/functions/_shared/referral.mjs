/**
 * Referral programme: "give 10%, get 10%", as Pixel8 and Comic Strip Canvas
 * run it.
 *
 *   FRIEND side   Every buyer gets their own Stripe promotion code
 *                 (FUG- / RAT- / MEOW- / BIKE-) when their order first ships
 *                 (post-delivery.mjs). A friend who uses it gets 10% off a
 *                 first order. One code per buyer email, reused on later orders.
 *   REFERRER side When a paid order used this brand's friend code, the
 *                 payment webhook issues the referrer a single-use 10% code
 *                 (FGTHX- / LRTHX- / COCTHX- / BBTHX-) and emails it
 *                 (referral-reward.mjs).
 *
 * The four IP brands share The Metavision Multimedia Stripe account, so a
 * code works at any of the four checkouts. Every promotion code and coupon
 * carries metadata.brand (this brand's BRAND_KEY) and metadata.kind, so:
 *   - readDiscount (src/lib/promo-codes.cjs) flags another brand's code on
 *     the team email, as it does for any other code;
 *   - isWelcomeCode checks metadata.kind first, so a friend code (also
 *     first-order-only) is never read as the newsletter welcome code;
 *   - only THIS brand's friend codes earn a thank-you code here. Another
 *     brand's friend code is accepted and flagged, not rewarded.
 *
 * Coupons are created on first use with the fixed ids in site-config.mjs, so
 * there is nothing to set up in the Stripe Dashboard.
 *
 * Everything here is best-effort: a referral problem never blocks an order,
 * a dispatch email or a payment. Callers log and carry on.
 */
import { setting } from './site-config.mjs';

export const KIND_FRIEND = 'referral-friend';
export const KIND_REWARD = 'referral-reward';

// No 0/O/1/I/L: codes get read out loud and typed off phones.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** This brand's referral settings (site-config.mjs). */
export function referralConfig(env = process.env) {
  const s = (k) => setting(k, env);
  return {
    brand: s('BRAND_KEY'),
    brandName: s('BRAND_NAME'),
    friendPrefix: s('REFERRAL_FRIEND_PREFIX'),
    rewardPrefix: s('REFERRAL_REWARD_PREFIX'),
    friendCoupon: s('REFERRAL_FRIEND_COUPON_ID'),
    rewardCoupon: s('REFERRAL_REWARD_COUPON_ID'),
  };
}

/** A random code body, e.g. "K7QM2X". `rand` is injectable for tests. */
export function codeBody(len = 6, rand = Math.random) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

const kindOf = (promo) => (promo && typeof promo === 'object' ? promo.metadata?.kind : undefined);
const brandOf = (promo) => (promo && typeof promo === 'object' ? promo.metadata?.brand : undefined);

/** Is this Stripe promotion code a referral friend code (any brand unless `brand` is given)? */
export const isFriendCode = (promo, brand) =>
  kindOf(promo) === KIND_FRIEND && (!brand || brandOf(promo) === brand);

/** Is this Stripe promotion code a referrer's thank-you code (any brand unless `brand` is given)? */
export const isRewardCode = (promo, brand) =>
  kindOf(promo) === KIND_REWARD && (!brand || brandOf(promo) === brand);

// Stripe refuses a coupon name over 40 characters ("Invalid string: ... must
// be at most 40 characters"). The old "<brand> referral: friend 10% off first
// order" was 44-52 characters for every IP brand, so no coupon and no code was
// ever created. The name shows at checkout, so keep it short and readable.
export const COUPON_NAME_MAX = 40;

/** "<Brand>: <what>", cut to Stripe's 40-character limit. */
export function couponName(brandName, what) {
  const full = brandName ? `${brandName}: ${what}` : String(what);
  return full.length <= COUPON_NAME_MAX ? full : full.slice(0, COUPON_NAME_MAX).trimEnd();
}

/** Create the coupon if it does not exist yet. Returns its id. */
export async function ensureCoupon(stripe, id, { name, brand, kind }) {
  try {
    await stripe.coupons.retrieve(id);
    return id;
  } catch (err) {
    if (err?.statusCode !== 404 && err?.code !== 'resource_missing') throw err;
  }
  try {
    await stripe.coupons.create({ id, name: couponName('', name), percent_off: 10, duration: 'once', metadata: { brand, kind } });
  } catch (err) {
    // Two deliveries racing to create it: the other one won, which is fine.
    if (err?.code !== 'resource_already_exists') throw err;
  }
  return id;
}

/** Create a promotion code, retrying on the (very unlikely) clash of a random code. */
async function createPromo(stripe, prefix, params, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    const code = `${prefix}-${codeBody()}`;
    try {
      return await stripe.promotionCodes.create({ ...params, code });
    } catch (err) {
      lastErr = err;
      if (!/already exists/i.test(err?.message || '')) throw err;
    }
  }
  throw lastErr;
}

/**
 * The buyer's friend code: reuse one already recorded on an earlier order
 * from the same email (`existingCode`), otherwise create a new one.
 * Returns the code string.
 */
export async function friendCodeFor(stripe, { email, orderRef, existingCode }, cfg = referralConfig()) {
  if (existingCode) return existingCode;
  await ensureCoupon(stripe, cfg.friendCoupon, { name: couponName(cfg.brandName, 'referral 10% off'), brand: cfg.brand, kind: KIND_FRIEND });
  const promo = await createPromo(stripe, cfg.friendPrefix, {
    coupon: cfg.friendCoupon,
    restrictions: { first_time_transaction: true },
    metadata: {
      brand: cfg.brand,
      kind: KIND_FRIEND,
      referrer_email: String(email || '').trim().toLowerCase(),
      referrer_order: orderRef || '',
    },
  });
  return promo.code;
}

/** A single-use 10% thank-you code for the referrer. Returns the code string. */
export async function issueReward(stripe, { referrerEmail, referredOrder }, cfg = referralConfig()) {
  await ensureCoupon(stripe, cfg.rewardCoupon, { name: couponName(cfg.brandName, 'thank-you 10% off'), brand: cfg.brand, kind: KIND_REWARD });
  const promo = await createPromo(stripe, cfg.rewardPrefix, {
    coupon: cfg.rewardCoupon,
    max_redemptions: 1,
    metadata: {
      brand: cfg.brand,
      kind: KIND_REWARD,
      referrer_email: String(referrerEmail || '').trim().toLowerCase(),
      referred_order: referredOrder || '',
    },
  });
  return promo.code;
}

/**
 * Pick out THIS brand's friend codes used on a paid checkout, and whether
 * each is a real referral: not the buyer's own code, and the referrer email
 * is known. `promos` are expanded Stripe promotion code objects
 * (readDiscount().promos).
 */
export function referralsFrom(promos, buyerEmail, brand = referralConfig().brand) {
  const buyer = String(buyerEmail || '').trim().toLowerCase();
  return (promos || [])
    .filter((p) => isFriendCode(p, brand))
    .map((p) => ({
      code: p.code,
      referrerEmail: String(p.metadata?.referrer_email || '').toLowerCase(),
      referrerOrder: p.metadata?.referrer_order || '',
    }))
    .filter((r) => r.referrerEmail && r.referrerEmail !== buyer);
}
