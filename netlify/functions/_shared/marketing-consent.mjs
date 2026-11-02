/**
 * Marketing consent for a shop order.
 *
 * The IP brands rely on the UK soft opt-in for existing customers (PECR
 * reg. 22): marketing about our own similar products to people who bought
 * from us, as long as they were given a simple way to refuse when their
 * details were collected, and in every message after. The refusal is an
 * unticked "Don't send me offers or referral emails" box in the cart drawer
 * (src/components/CartDrawer.tsx), just above Checkout:
 *
 *   CartDrawer sends `marketingOptOut` (true only when ticked)
 *   create-checkout stamps it on the Stripe session as
 *     metadata.marketing_opt_out ('true' / 'false')
 *   stripe-webhook records it on the order as marketingConsent
 *
 * Stripe's own marketing checkbox (consent_collection.promotions) is refused
 * for UK accounts, so it is never used.
 *
 * Values on an order (`marketingConsent`):
 *   'refused'    ticked the box: no referral code, never added to MailerLite
 *   'not_asked'  did not tick it, or bought before the box existed
 *
 * create-checkout.cjs and stripe-webhook.cjs are CommonJS and carry one-line
 * copies of optOutMetadata / consentFromSession; tests/post-delivery.test.mjs
 * checks the copies agree with these.
 */

/** create-checkout: the metadata value. Only a literal `true` counts as opting out. */
export function optOutMetadata(marketingOptOut) {
  return marketingOptOut === true ? 'true' : 'false';
}

/** stripe-webhook: the marketingConsent to record for a paid session. */
export function consentFromSession(session) {
  return session?.metadata?.marketing_opt_out === 'true' ? 'refused' : 'not_asked';
}

/** True when this buyer must get no marketing: no referral code, not added to MailerLite. */
export function marketingRefused(consent) {
  return consent === 'refused' || consent === 'opt_out';
}
