// brand-guard.cjs
// -----------------------------------------------------------------------------
// The Fuglys shares ONE Stripe account with Cats On Crack, Labrats and Biker
// Babies, and Stripe sends every event to every endpoint. create-checkout stamps
// metadata.brand = BRAND_KEY on each session; stripe-webhook processes only
// sessions carrying it. Unstamped sessions are not ours either.
// -----------------------------------------------------------------------------

const BRAND_KEY = 'thefuglys';

/** True only for a Checkout Session this site created. */
function isOurSession(session) {
  return Boolean(session && session.metadata && session.metadata.brand === BRAND_KEY);
}

module.exports = { BRAND_KEY, isOurSession };
