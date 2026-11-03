// scripts/restart-post-delivery.mjs
//
// Re-run the post-delivery start (referral code + MailerLite "FG - Customers")
// for ONE order whose start already ran but failed to make a referral code,
// e.g. #O41EQLSY on 2026-11-03 (Stripe refused the over-long coupon name).
//
// It never sends a customer email: it clears postDeliveryStartedAt and
// postDeliveryError (published + draft, only while referralCode is still
// empty), then calls the same startPostDelivery the functions use. That
// creates the FUG- code in Stripe (and the fg-referral-friend-10 coupon if it
// is missing), saves referralCode on the order, and upserts the buyer in
// MailerLite with fg_referral_code filled in.
//
// Dry run unless --yes. Needs in the shell (never in a file):
//   STRIPE_SECRET_KEY   the key the live site uses (Metavision Multimedia)
//   MAILERLITE_API_KEY
//   SANITY_API_TOKEN    (or SANITY_TOKEN) with write access to ngx60q2x
//
//   node scripts/restart-post-delivery.mjs O41EQLSY           (dry run)
//   node scripts/restart-post-delivery.mjs O41EQLSY --yes
import { createClient } from '@sanity/client';
import { setting, sanityWriteToken } from '../netlify/functions/_shared/site-config.mjs';
import { readDecideWrite } from '../netlify/functions/_shared/server-patch.mjs';
import { startPostDelivery } from '../netlify/functions/_shared/post-delivery.mjs';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('Usage: node scripts/restart-post-delivery.mjs <orderRef or order id> [--yes]');
  process.exit(2);
}

const token = sanityWriteToken();
if (!token) { console.error('SANITY_API_TOKEN (or SANITY_TOKEN) is not set in this shell.'); process.exit(2); }

const sanity = createClient({
  projectId: setting('SANITY_PROJECT_ID'),
  dataset: setting('SANITY_DATASET'),
  apiVersion: '2026-04-14',
  token,
  useCdn: false,
});

const ref = target.replace(/^#/, '');
const id = ref.startsWith('order.')
  ? ref
  : await sanity.fetch(`*[_type == "order" && !(_id in path("drafts.**")) && orderRef == $ref][0]._id`, { ref });
if (!id) { console.error(`No published order found for ${target}.`); process.exit(1); }

const doc = await sanity.getDocument(id);
const show = (d) => ({
  id: d._id, orderRef: d.orderRef, marketingConsent: d.marketingConsent ?? null,
  referralCode: d.referralCode ?? null, postDeliveryStartedAt: d.postDeliveryStartedAt ?? null,
  postDeliveryError: d.postDeliveryError ?? null, hasInhouse: !!d.hasInhouse,
});
console.log('Now:', show(doc));

if (doc.referralCode) { console.log('It already has a referral code: nothing to do.'); process.exit(0); }
if (!doc.postDeliveryStartedAt) {
  console.log('Post-delivery has not started for this order: it will start by itself at its first shipping email.');
  process.exit(0);
}
const missing = ['STRIPE_SECRET_KEY', 'MAILERLITE_API_KEY'].filter((k) => !process.env[k]);
if (missing.length) { console.error(`Not set in this shell: ${missing.join(', ')}.`); process.exit(2); }
const live = String(process.env.STRIPE_SECRET_KEY).startsWith('sk_live_') || String(process.env.STRIPE_SECRET_KEY).startsWith('rk_live_');
console.log(`Stripe key: ${live ? 'LIVE' : 'TEST'} mode. The code is made in that mode only.`);

const trigger = doc.hasInhouse ? 'wallart' : 'merch';
if (!yes) {
  console.log(`Dry run. With --yes: clear postDeliveryStartedAt and postDeliveryError, then start post-delivery again (trigger: ${trigger}).`);
  process.exit(0);
}

// Clear the claim only if nobody made a code in the meantime (published +
// any open draft, guarded by ifRevisionId).
const cleared = await readDecideWrite(sanity, id, (fresh) => {
  if (!fresh || fresh.referralCode || !fresh.postDeliveryStartedAt) return null;
  return { unset: ['postDeliveryStartedAt', 'postDeliveryError'] };
});
if (!cleared.written) { console.log('Order changed in the meantime (code made or claim gone): stopping.'); process.exit(1); }

const result = await startPostDelivery({ sanity, id, trigger, log: console });
console.log('Result:', JSON.stringify({ ...result, mailerlite: result.mailerlite && { ok: result.mailerlite.ok, status: result.mailerlite.status } }));
console.log('After:', show(await sanity.getDocument(id)));
process.exit(result.referralCode ? 0 : 1);
