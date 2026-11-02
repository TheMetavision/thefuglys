/**
 * The post-delivery sequence, ported from Pixel8: the buyer's own referral
 * code (FUG- / RAT- / MEOW- / BIKE-), then this brand's MailerLite
 * "<XX> - Customers" group, whose automation sends the emails.
 *
 * WHEN. Once per order, at the FIRST email that tells the customer something
 * has shipped:
 *
 *   merchandise   Printful's package_shipped, after the "It's shipped" email
 *                 (printful-webhook.mjs, through printful-shipped.mjs)
 *   wall art      the in-house dispatch email, by hand or at Sendcloud's
 *                 first scan (dispatch-email.mjs afterDispatchEmail)
 *   mixed order   whichever of those comes first; every later package or
 *                 the other half finds the claim and does nothing
 *
 * ONCE ONLY. postDeliveryStartedAt is claimed through readDecideWrite
 * (ifRevisionId on the published order, draft mirrored by serverPatch) before
 * anything is created, so of any number of racing calls exactly one starts.
 *
 * A buyer who ticked "Don't send me offers or referral emails" gets neither a
 * code nor MailerLite, and no claim is written. The customer email has
 * already gone; it is transactional and unaffected.
 *
 * Never throws, and always runs AFTER the email that called it: a referral
 * or MailerLite problem is logged and written to postDeliveryError for
 * Studio, and never holds up or undoes that email.
 */
import { readDecideWrite, serverPatch } from './server-patch.mjs';
import { marketingRefused } from './marketing-consent.mjs';
import { friendCodeFor } from './referral.mjs';
import { addShippedCustomer } from './mailerlite-customer.mjs';
import { orderRefFor } from './order-ref.mjs';
import { setting } from './site-config.mjs';

/** The referral code on an earlier order from this email, if any. */
export const EARLIER_CODE_QUERY =
  `*[_type == "order" && !(_id in path("drafts.**")) && _id != $id && lower(customerEmail) == $email && defined(referralCode)]` +
  ` | order(_createdAt asc)[0].referralCode`;

const defaultStripe = async (key) => {
  const { default: Stripe } = await import('stripe');
  return new Stripe(key);
};

/**
 * @param {object} p
 * @param {object} p.sanity        @sanity/client (or the test fake) with a write token
 * @param {string} p.id            the order's published id
 * @param {'merch'|'wallart'} p.trigger  which shipment email called this
 * @param {object} [p.log]
 * @param {object} [deps]          tests swap the Stripe and MailerLite calls
 * @returns {Promise<{ skipped?: string, referralCode?: string, mailerlite?: object, error?: string }>}
 */
export async function startPostDelivery({ sanity, id, trigger, log = console }, deps = {}) {
  const {
    friendCode = friendCodeFor,
    addCustomer = addShippedCustomer,
    stripeKey = process.env.STRIPE_SECRET_KEY,
    makeStripe = defaultStripe,
    now = () => Date.now(),
  } = deps;
  let name = id || '?';
  try {
    if (!id || String(id).startsWith('drafts.')) return { skipped: 'no published order' };
    if (!sanity) return { skipped: 'no Sanity client' };

    let skip = null;
    const claim = await readDecideWrite(sanity, id, (fresh) => {
      if (!fresh) { skip = 'order not found'; return null; }
      if (fresh.postDeliveryStartedAt) { skip = 'already started'; return null; }
      if (marketingRefused(fresh.marketingConsent)) { skip = 'refused'; return null; }
      return { set: { postDeliveryStartedAt: new Date(now()).toISOString() } };
    });
    // The fresh, full order as it was claimed: never a caller's projection.
    const order = claim.doc;
    name = orderRefFor(order) || id;
    if (!claim.written) {
      const why = skip || 'nothing to do';
      log.log(`post-delivery: ${name}: ${why === 'refused' ? 'buyer refused marketing at checkout; no referral code, not added to MailerLite' : why}`);
      return { skipped: why };
    }

    const problems = [];
    let referralCode = '';
    try {
      if (!stripeKey) throw new Error('STRIPE_SECRET_KEY is not set');
      const email = String(order.customerEmail || '').trim().toLowerCase();
      const earlier = email ? await sanity.fetch(EARLIER_CODE_QUERY, { email, id }) : null;
      const stripe = earlier ? null : await makeStripe(stripeKey);
      referralCode = await friendCode(stripe, { email, orderRef: name, existingCode: earlier || null });
      await serverPatch(sanity, id, { set: { referralCode } });
    } catch (err) {
      log.error(`post-delivery: ${name}: referral code failed:`, err?.message || err);
      problems.push(`referral code: ${err?.message || err}`);
    }

    const group = setting('MAILERLITE_CUSTOMERS_GROUP');
    const ml = await addCustomer(order, { referralCode, firstShipped: trigger });
    if (ml.ok) log.log(`post-delivery: ${name}: added to MailerLite "${group}"${referralCode ? ` with ${referralCode}` : ''} (first shipped: ${trigger})`);
    else {
      log.error(`post-delivery: ${name}: MailerLite ${ml.skipped ? 'skipped' : 'failed'}:`, ml.skipped || ml.status || '', ml.error || '');
      problems.push(`MailerLite: ${ml.skipped || `${ml.status || ''} ${String(ml.error || '').slice(0, 200)}`.trim()}`);
    }

    if (problems.length) {
      await serverPatch(sanity, id, { set: { postDeliveryError: `${new Date(now()).toISOString()} — ${problems.join('; ')}` } })
        .catch((e) => log.error(`post-delivery: ${name}: could not record the error:`, e?.message || e));
    }
    return { referralCode, mailerlite: ml };
  } catch (err) {
    log.error(`post-delivery: ${name}: failed:`, err?.message || err);
    return { error: err?.message || String(err) };
  }
}
