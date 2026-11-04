/**
 * Every email carries THIS brand's logo and no other brand's.
 *
 * Identical in thefuglys, labrats, catsoncrack and bikerbabies: the expected
 * logo is each repo's own site-config LOGO_URL, and the other brands' logos
 * and domains must never appear. LOGO_URL is NOT set in the environment here,
 * so these also prove a missing Netlify variable can't drop the logo.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const quiet = () => {};
console.log = quiet; console.warn = quiet; console.error = quiet;

for (const k of ['LOGO_URL', 'EMAIL_HEADER_BG', 'BRAND_NAME', 'SHIPPING_TEST_MODE']) delete process.env[k];
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
// Read once when stripe-webhook loads, so it has to be set before the require.
process.env.NOTIFICATION_TO = 'team@example.com';
delete process.env.ORDER_NOTIFICATION_TO;
require.cache[require.resolve('stripe')] = { exports: () => ({ webhooks: {}, checkout: { sessions: {} } }) };

const { SITE_CONFIG } = await import('../netlify/functions/_shared/site-config.mjs');
const { esc, buildDispatchEmail } = await import('../netlify/functions/_shared/dispatch-email.mjs');
const E = await import('../netlify/functions/_shared/shipping-emails.mjs');
const { rewardEmail } = await import('../netlify/functions/_shared/referral-reward.mjs');
const stripeWebhook = require('../netlify/functions/stripe-webhook.cjs');
const { buildShippedEmailHtml } = await import('../netlify/functions/printful-webhook.mjs');

// The four IP brands: each one's email logo and the marks that identify it.
const BRANDS = [
  { logo: 'https://thefuglys.com/fuglys-email-logo.png', marks: ['thefuglys.com'] },
  { logo: 'https://labrats.uk/labrats-email-logo.png', marks: ['labrats.uk'] },
  { logo: 'https://catsoncrack.co.uk/coc-logo-purple.png', marks: ['catsoncrack.co.uk'] },
  { logo: 'https://cdn.sanity.io/images/v518t53u/production/0b5d5e7ac5d01c7d532c6f40f006f2940616fe32-1000x600.png?w=600&fm=png', marks: ['thebikerbabies.com', 'v518t53u'] },
];
const OWN = SITE_CONFIG.LOGO_URL;
const FOREIGN = [
  ...BRANDS.filter((b) => b.logo !== OWN).flatMap((b) => [b.logo, esc(b.logo), ...b.marks]),
  'wyrmfuel', 'pixel8multimedia', 'comicstripcanvas', 'dottyandfriends',
];

function assertOwnLogo(html, label) {
  assert.ok(html.includes(`src="${esc(OWN)}"`), `${label}: has this brand's logo (${OWN})`);
  const lower = html.toLowerCase();
  for (const m of FOREIGN) assert.ok(!lower.includes(m.toLowerCase()), `${label}: must not contain ${m}`);
}

test("this repo's site-config logo is one of the four IP brands' logos", () => {
  assert.ok(BRANDS.some((b) => b.logo === OWN), OWN);
  assert.equal(process.env.LOGO_URL, undefined);
});

/* ── team emails (shipping-emails.mjs plainWrap) ─────────────────────── */

const who = { ref: 'FG-TEST1', id: 'order.abc', name: 'Ada Test', address: { line1: '1 High St', city: 'Leeds', postal_code: 'LS1 1AA', country: 'GB' } };
const parcel = { parcelRef: 'P1', band: 'B1', carrier: 'royal_mail', option: 'Tracked 48', quotedPrice: 4.2, trackingNumber: 'RM1', labelUrl: 'https://example.com/label.pdf' };
const ret = {
  _id: 'return.1', type: 'return', returnNumber: 'R-1', customerName: 'Ada Test', customerEmail: 'ada@example.com',
  orderNumber: 'FG-TEST1', carrier: 'inpost', band: 'X1', lines: [{ title: 'Print', format: 'poster', size: 'A3', quantity: 1, price: 20 }],
};
const claim = { ...ret, _id: 'claim.1', type: 'printfulClaim' };
const event = { status: 'exception', carrierStatus: 'Delayed', trackingNumber: 'RM1', occurredAt: '2026-11-01T10:00:00Z' };

const TEAM = {
  labelReadyEmail: () => E.labelReadyEmail(who, [parcel], { expiresAt: '2026-11-10T10:00:00Z' }),
  shipmentProblemEmail: () => E.shipmentProblemEmail(who, 'No rate'),
  parcelAlertEmail: () => E.parcelAlertEmail(who, parcel, event, 'delivery_problem'),
  newReturnEmail: () => E.newReturnEmail(ret),
  returnProblemEmail: () => E.returnProblemEmail(ret, 'No label'),
  returnAlertEmail: () => E.returnAlertEmail(ret, event, 'returned_to_sender'),
  returnReadyEmail: () => E.returnReadyEmail(ret, event),
  newClaimEmail: () => E.newClaimEmail(claim),
};

for (const [name, build] of Object.entries(TEAM)) {
  test(`team email ${name}: this brand's logo in a header-colour bar, no other brand`, () => {
    const msg = build();
    assert.deepEqual(msg.to, [SITE_CONFIG.TEAM_EMAIL]);
    assertOwnLogo(msg.html, name);
    assert.ok(msg.html.includes(`background:${esc(SITE_CONFIG.EMAIL_HEADER_BG)}`), `${name}: logo bar uses EMAIL_HEADER_BG`);
  });
}

test('the team logo bar follows a LOGO_URL override and falls back to the brand name with no logo', () => {
  const b = (logo) => ({ logo, name: SITE_CONFIG.BRAND_NAME, accent: '#ff0000', headerBg: '#000000' });
  assert.match(E.teamLogoBar(b('https://example.com/x.png')), /<img src="https:\/\/example\.com\/x\.png"/);
  const none = E.teamLogoBar(b(''));
  assert.doesNotMatch(none, /<img/);
  assert.ok(none.includes(esc(SITE_CONFIG.BRAND_NAME)));
});

/* ── customer emails built on brandCard (already branded; guarded here) ── */

test('customer brandCard emails carry this brand\'s logo only', () => {
  assertOwnLogo(E.returnDeclinedEmail(ret).html, 'returnDeclinedEmail');
  assertOwnLogo(E.claimReceivedEmail(claim).html, 'claimReceivedEmail');
  assertOwnLogo(rewardEmail('THX-TEST').html, 'rewardEmail');
  assertOwnLogo(buildDispatchEmail({ _id: 'order.abc', orderRef: 'FG-TEST1', customerName: 'Ada Test', items: [] }).html, 'buildDispatchEmail');
});

/* ── stripe-webhook: order confirmation and the team's new-order alert ── */

const session = {
  id: 'cs_test_a1B2c3D4e5F6g7H8i9J0', livemode: false, amount_total: 2500,
  customer_details: { name: 'Ada Test', email: 'ada@example.com' },
  shipping_details: { name: 'Ada Test', address: { line1: '1 High St', city: 'Leeds', postal_code: 'LS1 1AA', country: 'GB' } },
};
const lineItems = { data: [{ id: 'li_1', description: 'Tee — Black (M)', quantity: 1, amount_total: 2500, price: { product: { metadata: {} } } }] };

test('order confirmation has the site-config logo with LOGO_URL unset', () => {
  assertOwnLogo(stripeWebhook.buildOrderEmailHtml(session, lineItems, {}), 'order confirmation');
});

async function merchantHtml(status, promo = {}) {
  const realFetch = globalThis.fetch;
  const sent = [];
  process.env.RESEND_API_KEY = 're_test';
  globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: JSON.parse(init.body) }); return { ok: true, status: 200, text: async () => '', json: async () => ({ id: 'e1' }) }; };
  try {
    await stripeWebhook.sendMerchantEmail(session, lineItems, status, status === 'fulfilment-failed' ? null : '123', promo);
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
  }
  assert.equal(sent.length, 1);
  return sent[0].body;
}

for (const [status, promo] of [['sent-to-printful', {}], ['fulfilment-failed', { fulfilmentAlert: 'Printful said no' }], ['inhouse', {}]]) {
  test(`new-order alert (${status}) opens with this brand's logo in a header-colour bar`, async () => {
    const { html, to } = await merchantHtml(status, promo);
    assert.equal(to, 'team@example.com');
    assertOwnLogo(html, `merchant alert ${status}`);
    assert.ok(html.includes(`background:${esc(SITE_CONFIG.EMAIL_HEADER_BG)}`));
    assert.ok(html.indexOf(esc(OWN)) < html.indexOf('New order #'), 'logo is above the heading');
  });
}

/* ── printful-webhook: "It's shipped" ─────────────────────────────────── */

test("Printful's shipped email has the site-config logo with LOGO_URL unset", () => {
  const html = buildShippedEmailHtml({ orderRef: 'FG-TEST1' }, { carrier: 'Royal Mail', tracking_number: 'RM1', tracking_url: 'https://example.com/t' });
  assertOwnLogo(html, 'shipped email');
});
