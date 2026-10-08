/**
 * src/lib/promo-codes.cjs  (The Fuglys)
 *
 * Promotion codes typed on Stripe's Checkout page (create-checkout sets
 * allow_promotion_codes). The webhook is the first place the code is known,
 * so this reads it back off the paid session:
 *
 *   amountPence   — total_details.amount_discount: what came off the goods.
 *                   Shipping is a shipping_options rate, which coupons never
 *                   touch, so this is goods only.
 *   codes         — the promotion codes used (or the coupon's name when one
 *                   was applied without a code).
 *   welcomeCodes  — those that are this brand's newsletter welcome offer
 *                   (CHAOS10), for the repeat-customer check.
 *   otherBrand    — codes whose metadata.brand names a DIFFERENT brand.
 *                   All four IP brands share one Stripe account, and a
 *                   coupon with inline price_data can't be limited to one
 *                   brand's products, so any brand's code works at any
 *                   brand's checkout. Flagged, never blocked.
 *
 * A code is matched to a brand by its promotion code's metadata.brand (or its
 * coupon's). A code with no brand metadata can't be checked and isn't
 * flagged — every live code needs metadata.brand.
 *
 * Never throws: the payment is taken whatever this finds. A failed lookup
 * costs the order its code and flags; the amount is on the session itself.
 */

/* CHAOS10 is meant for a first order. Recognised by its promotion code's own
   "first-time order only" restriction, or by name as a fallback. */
const WELCOME_CODES = ['CHAOS10'];

function isWelcomeCode(promo) {
  if (!promo || typeof promo !== 'object') return false;
  return (promo.restrictions && promo.restrictions.first_time_transaction === true)
    || WELCOME_CODES.includes(String(promo.code || '').toUpperCase());
}

async function readDiscount(stripe, session, brandKey) {
  const amountPence = (session && session.total_details && session.total_details.amount_discount) || 0;
  const out = { amountPence, codes: [], welcomeCodes: [], otherBrand: [] };
  if (!amountPence) return out;

  try {
    const full = await stripe.checkout.sessions.retrieve(session.id, { expand: ['total_details.breakdown'] });
    const discounts = (full && full.total_details && full.total_details.breakdown && full.total_details.breakdown.discounts) || [];
    for (const d of discounts) {
      const disc = d.discount || {};
      const coupon = disc.coupon && typeof disc.coupon === 'object' ? disc.coupon : null;
      let promo = disc.promotion_code;
      if (typeof promo === 'string') {
        try {
          promo = await stripe.promotionCodes.retrieve(promo);
        } catch (err) {
          console.error(`[PROMO] session ${session.id}: could not look up promotion code ${promo}:`, err && err.message ? err.message : err);
          promo = null;
        }
      }
      const code = (promo && promo.code) || (coupon && (coupon.name || coupon.id)) || null;
      if (!code) continue;
      if (!out.codes.includes(code)) out.codes.push(code);
      if (isWelcomeCode(promo) && !out.welcomeCodes.includes(code)) out.welcomeCodes.push(code);
      const codeBrand = (promo && promo.metadata && promo.metadata.brand) || (coupon && coupon.metadata && coupon.metadata.brand) || null;
      if (codeBrand && codeBrand !== brandKey && !out.otherBrand.some((o) => o.code === code)) {
        out.otherBrand.push({ code, brand: codeBrand });
      }
    }
  } catch (err) {
    console.error(`[PROMO] session ${session.id}: could not read the discount breakdown:`, err && err.message ? err.message : err);
  }
  return out;
}

/* "Discount (CHAOS10)", or plain "Discount" when the code could not be read. */
const discountLabel = (codes) => (codes && codes.length ? `Discount (${codes.join(', ')})` : 'Discount');

const repeatWelcomeNote = (codes, earlier) =>
  `${codes.join(', ')} is a first-order welcome code, and this email already has a paid order ` +
  `(#${earlier.orderRef || earlier._id}${earlier.placedAt ? `, ${String(earlier.placedAt).slice(0, 10)}` : ''}). ` +
  'Stripe cannot refuse it on a guest checkout. The order stands; decide whether to follow up.';

const crossBrandNote = (otherBrand, brandKey) =>
  otherBrand.map((o) => `${o.code} belongs to ${o.brand}`).join('; ') +
  ` — used on a ${brandKey} order. The four brands share one Stripe account, so Stripe accepts it. ` +
  'The order stands; decide whether to follow up.';

module.exports = { WELCOME_CODES, isWelcomeCode, readDiscount, discountLabel, repeatWelcomeNote, crossBrandNote };
