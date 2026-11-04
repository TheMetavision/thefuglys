/**
 * Every email this repo can send is readable: each visible text element
 * reaches WCAG contrast 4.5:1 against what is actually behind it (3:1 for
 * large text), checked with tests/_email-contrast.mjs. Customer and team
 * emails, rendered with full sample data (order numbers, references, reasons,
 * tracking, discount rows, warning and flag blocks), so nothing is hidden by
 * a blank field.
 *
 * Identical in thefuglys, labrats, catsoncrack and bikerbabies. Brand colours
 * come from this repo's site-config; the "override" tests then set awkward
 * colours in the environment to prove the shared helper
 * (_shared/readable-colour.mjs) keeps an env override readable too.
 * Labrats' Vent Runner emails are checked in tests/vr-email-logos.test.mjs.
 *
 * Nothing is sent: fetch is stubbed (stripe-webhook, printful-webhook), and
 * @sanity/client and resend are stubbed for the contact form's handler.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import { contrastIssues, assertReadable, contrast } from './_email-contrast.mjs';

const require = createRequire(import.meta.url);
const quiet = () => {};
console.log = quiet; console.warn = quiet; console.error = quiet;

// ── stubs: nothing leaves the machine ───────────────────────────────────
const contactSent = [];
globalThis.__contrastContactSent = contactSent;
const STUBS = {
  '@sanity/client': 'export function createClient() { return { fetch: async () => 0, create: async (doc) => ({ ...doc }) }; }',
  resend: 'export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__contrastContactSent.push(m); return { id: "stub" }; } }; } }',
};
registerHooks({
  resolve(spec, ctx, next) { return spec in STUBS ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, ctx); },
  load(url, ctx, next) { return url.startsWith('stub:') ? { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true } : next(url, ctx); },
});
const noNetwork = async (url) => { throw new Error(`network blocked in tests: ${url}`); };
globalThis.fetch = noNetwork;

const COLOUR_ENV = ['LOGO_URL', 'BRAND_NAME', 'BRAND_ACCENT', 'EMAIL_ACCENT', 'EMAIL_HIGHLIGHT', 'EMAIL_HEADER_BG', 'EMAIL_PAGE_BG', 'EMAIL_CARD_BG',
  'EMAIL_HEADING', 'EMAIL_TEXT', 'EMAIL_MUTED', 'EMAIL_RULE', 'EMAIL_BUTTON_TEXT', 'SITE_URL', 'SHIPPING_TEST_MODE', 'RESEND_API_KEY'];
for (const k of COLOUR_ENV) delete process.env[k];
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
// Read once when stripe-webhook loads, so it has to be set before the require.
process.env.NOTIFICATION_TO = 'team@example.com';
delete process.env.ORDER_NOTIFICATION_TO;
require.cache[require.resolve('stripe')] = { exports: () => ({ webhooks: {}, checkout: { sessions: {} } }) };

const { SITE_CONFIG } = await import('../netlify/functions/_shared/site-config.mjs');
const { readableOn, contrastRatio } = await import('../netlify/functions/_shared/readable-colour.mjs');
const D = await import('../netlify/functions/_shared/dispatch-email.mjs');
const E = await import('../netlify/functions/_shared/shipping-emails.mjs');
const { rewardEmail } = await import('../netlify/functions/_shared/referral-reward.mjs');
const stripeWebhook = require('../netlify/functions/stripe-webhook.cjs');
const { buildShippedEmailHtml } = await import('../netlify/functions/printful-webhook.mjs');
const contact = await import('../netlify/functions/contact.mts');
const HAS_SUBSCRIBE = fs.existsSync(new URL('../netlify/functions/subscribe.mts', import.meta.url));
const newsletter = HAS_SUBSCRIBE ? await import('../netlify/functions/_shared/newsletter-email.mjs') : null;
const subscribe = HAS_SUBSCRIBE ? await import('../netlify/functions/subscribe.mts') : null;

/** Sets env vars for one call, then puts them back. */
async function withEnv(vars, fn) {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  Object.assign(process.env, vars);
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

// ── sample data, every field filled ─────────────────────────────────────

const ORDER_REF = 'FG7H8I9J0';
const who = {
  ref: ORDER_REF, id: 'order.abc', name: 'Ada Test', email: 'ada@example.com', test: true,
  address: { line1: '1 High St', city: 'Leeds', postalCode: 'LS1 1AA', country: 'GB' },
};
const parcels = [
  { parcelRef: 'P1', band: 'B1', extraWeightG: 120, carrier: 'royal_mail', option: 'Tracked 48', quotedPrice: 4.2, trackingNumber: 'RM123456785GB', labelUrl: 'https://example.com/label-1.pdf' },
  { parcelRef: 'P2', band: 'B2', carrier: 'inpost', option: 'Locker to locker', quotedPrice: 3.5, trackingNumber: 'IP0987654321', labelUrl: '' },
];
const event = {
  status: 'Delivery attempt failed', statusCode: 13, carrierStatus: 'Address not found', trackingNumber: 'RM123456785GB',
  trackingUrl: 'https://example.com/track/RM123456785GB', at: '2026-11-01T10:00:00Z',
};
const lines = [
  { title: 'Fugly Portrait', format: 'canvas-gallery', size: 'large', quantity: 1, unitPrice: 89, fulfilment: 'inhouse' },
  { title: 'Wasteland Tee', format: 'Black', size: 'M', quantity: 2, unitPrice: 25, fulfilment: 'printful' },
];
const ret = {
  _id: 'returnRequest.1', type: 'return', returnNumber: 'R-2611-0042', customerName: 'Ada Test', customerEmail: 'ada@example.com',
  orderNumber: `#${ORDER_REF}`, carrier: 'inpost', band: 'X1', lines, reasonLabel: 'Changed my mind', reason: 'changed_mind',
  customerNotes: 'The colours were not what I expected.\nHappy to send it back.', quotedPostage: 3.95, postageDeduction: 3.95,
  deliveredAt: '2026-10-20T12:00:00Z', windowEndsOn: '3 November 2026', shippedAt: '2026-10-15T12:00:00Z',
  deliveryDateUnknown: true, underwear: true, shipDateUnknown: true, packingNote: 'Tube and box: send as two parcels',
  trackingNumber: 'IPRET0042', rejectionReason: 'The item was returned after the 14-day window.', refundAmount: 25,
};
const claim = {
  ...ret, _id: 'returnRequest.2', type: 'printfulClaim', returnNumber: 'C-2611-0007', reasonLabel: 'Arrived damaged',
  printfulOrderId: '123456789', claimDeadline: '2026-11-14', claimOverdue: true,
};
const order = {
  _id: 'order.abc', _type: 'order', orderRef: ORDER_REF, customerName: 'Ada Test', customerEmail: 'ada@example.com', test: true,
  items: [{ title: 'Fugly Portrait', quantity: 2, fulfilment: 'inhouse' }, { title: 'Wasteland Tee', quantity: 1, fulfilment: 'printful' }],
  shipmentResult: { dispatchedAt: '2026-11-02T09:00:00Z', parcels: [
    { parcelRef: 'P1', carrier: 'royal_mail', trackingNumber: 'RM123456785GB', trackingUrl: 'https://example.com/t/1' },
    { parcelRef: 'P2', carrier: 'inpost', trackingNumber: 'IP0987654321', trackingUrl: 'https://example.com/t/2' },
  ] },
};
const byHandOrder = { ...order, shipmentResult: null, inhouseStatus: 'dispatched', wallArtCarrier: 'royal_mail', wallArtTrackingNumber: 'RM123456785GB' };

const session = (livemode = false) => ({
  id: 'cs_test_a1B2c3D4e5F6g7H8i9J0', livemode, amount_total: 13400,
  customer_details: { name: 'Ada Test', email: 'ada@example.com' },
  shipping_details: { name: 'Ada Test', address: { line1: '1 High St', line2: 'Flat 2', city: 'Leeds', state: 'West Yorkshire', postal_code: 'LS1 1AA', country: 'GB' } },
  shipping_cost: { amount_total: 495 },
});
const lineItems = { data: [
  { id: 'li_1', description: 'Wasteland Tee — Black (M)', quantity: 2, amount_subtotal: 5000, amount_total: 4500, price: { product: { metadata: { printful_variant_id: '4012' } } } },
  { id: 'li_2', description: 'Fugly Portrait', quantity: 1, amount_subtotal: 8900, amount_total: 8900, price: { product: { metadata: { fulfilment: 'inhouse', wallart_format: 'canvas-gallery', wallart_size: 'large', wallart_orientation: 'portrait' } } } },
] };
const promo = {
  amountPence: 500, codes: ['WELCOME10', 'FUGFRIEND'], printfulConfirmed: true,
  crossBrandCode: 'Code LRFRIEND belongs to another brand; it was accepted by Stripe.',
  repeatWelcomeCode: 'WELCOME10 was used before by ada@example.com (order #AB12CD34).',
  referralNote: 'Friend code FUGFRIEND used, but the buyer has ordered before: no reward issued.',
};

/** stripe-webhook's team alert, as it would be posted to Resend. */
async function merchantMail(status, p, livemode = false) {
  const sent = [];
  process.env.RESEND_API_KEY = 're_test_stub';
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, text: async () => '', json: async () => ({ id: 'stub' }) }; };
  try {
    await stripeWebhook.sendMerchantEmail(session(livemode), lineItems, status, status === 'fulfilment-failed' ? null : '987654', p);
  } finally {
    globalThis.fetch = noNetwork;
    delete process.env.RESEND_API_KEY;
  }
  assert.equal(sent.length, 1, `${status}: one alert`);
  return sent[0];
}

/** The contact form's two emails, as its handler sends them. */
async function contactMails() {
  contactSent.length = 0;
  return withEnv({
    SANITY_PROJECT_ID: 'stubproj', SANITY_DATASET: 'test', SANITY_API_TOKEN: 'stub-token', RESEND_API_KEY: 'stub-resend',
    NOTIFICATION_FROM: 'Team <team@example.com>', BRAND_NAME: SITE_CONFIG.BRAND_NAME, SITE_URL: SITE_CONFIG.SITE_URL,
  }, async () => {
    const res = await contact.handler({
      httpMethod: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      body: JSON.stringify({ name: 'Ada Test', email: 'ada@example.com', company: 'Acme Ltd', subject: 'Wholesale enquiry', message: 'Hi, do you ship to Ireland?\nThanks, Ada', botcheck: '', pageUri: `${SITE_CONFIG.SITE_URL}/contact/` }),
    });
    assert.equal(res.statusCode, 200, res.body);
    return { team: contactSent.find((m) => m.to === 'team@example.com'), ack: contactSent.find((m) => m.to === 'ada@example.com') };
  });
}

/** The newsletter confirmation as subscribe.mts builds it, with the brand's env as set in Netlify (or none). */
function confirmationMail(env) {
  return newsletter.confirmationEmail({ brand: newsletter.brandFromEnv(env), copy: subscribe.COPY, confirmUrl: `${SITE_CONFIG.SITE_URL}/newsletter/confirm/?t=abc.def` });
}
const NETLIFY_BRAND_ENV = {
  BRAND_NAME: SITE_CONFIG.BRAND_NAME, LOGO_URL: SITE_CONFIG.LOGO_URL, EMAIL_HEADER_BG: SITE_CONFIG.EMAIL_HEADER_BG,
  BRAND_ACCENT: SITE_CONFIG.BRAND_ACCENT, SITE_URL: SITE_CONFIG.SITE_URL,
};

/**
 * Every email, by name -> its HTML. Async because some go through a handler.
 * Keep in step with the senders: the inventory test below fails if
 * shipping-emails.mjs gains an email that isn't listed here.
 */
const EMAILS = {
  // stripe-webhook.cjs
  'order confirmation': () => stripeWebhook.buildOrderEmailHtml(session(), lineItems, promo),
  'order confirmation (no discount, no shipping)': () => stripeWebhook.buildOrderEmailHtml({ ...session(true), shipping_cost: null, shipping_details: null }, { data: [lineItems.data[0]] }, {}),
  'team alert: sent to Printful (test mode, every flag)': async () => (await merchantMail('sent-to-printful', promo)).html,
  'team alert: sent to Printful as a draft (live)': async () => (await merchantMail('sent-to-printful', { ...promo, printfulConfirmed: false }, true)).html,
  'team alert: fulfilment failed': async () => (await merchantMail('fulfilment-failed', { ...promo, fulfilmentAlert: 'Printful 400: variant 4012 is discontinued' })).html,
  'team alert: in-house (MAKE)': async () => (await merchantMail('inhouse', promo)).html,
  // printful-webhook.mjs
  'Printful "It\'s shipped" (mixed order)': () => buildShippedEmailHtml({ orderRef: ORDER_REF, customerName: 'Ada Test', hasInhouse: true }, { carrier: 'Royal Mail', tracking_number: 'RM123456785GB', tracking_url: 'https://example.com/t' }),
  'Printful "It\'s shipped" (no tracking link)': () => buildShippedEmailHtml({ orderRef: ORDER_REF, customerName: 'Ada Test' }, { carrier: 'DPD', tracking_number: '15501234567890', tracking_url: '' }),
  // _shared/dispatch-email.mjs
  'wall-art dispatch (two parcels, mixed order)': () => D.buildDispatchEmail(order).html,
  'wall-art dispatch (by hand)': () => D.buildDispatchEmail(byHandOrder).html,
  // _shared/referral-reward.mjs
  'referral thank-you': () => rewardEmail('FGTHX-7Q2M9').html,
  // _shared/shipping-emails.mjs: team (shipping-dispatch, shipping-events, shipping-returns, returns-api)
  labelReadyEmail: () => E.labelReadyEmail(who, parcels, { expiresAt: '2026-12-02T10:00:00Z' }).html,
  'labelReadyEmail (renewed)': () => E.labelReadyEmail(who, parcels, { renewed: true, expiresAt: '2026-12-02T10:00:00Z' }).html,
  shipmentProblemEmail: () => E.shipmentProblemEmail(who, 'Sendcloud: no shipping method for band B2 to GB\n(422 Unprocessable)').html,
  'parcelAlertEmail (delivery problem)': () => E.parcelAlertEmail(who, parcels[0], event, 'delivery_problem').html,
  'parcelAlertEmail (returned to sender)': () => E.parcelAlertEmail(who, parcels[0], event, 'returned_to_sender').html,
  newReturnEmail: () => E.newReturnEmail(ret).html,
  'newReturnEmail (no band chosen)': () => E.newReturnEmail({ ...ret, band: '' }).html,
  returnProblemEmail: () => E.returnProblemEmail(ret, 'No label: the return has no parcel band').html,
  'returnProblemEmail (claim)': () => E.returnProblemEmail(claim, 'Customer email bounced').html,
  'returnAlertEmail (carrier problem)': () => E.returnAlertEmail(ret, event, 'delivery_problem').html,
  'returnAlertEmail (returned to sender)': () => E.returnAlertEmail(ret, event, 'returned_to_sender').html,
  returnReadyEmail: () => E.returnReadyEmail(ret, event).html,
  'returnReadyEmail (free label)': () => E.returnReadyEmail({ ...ret, freeLabel: true }, event).html,
  newClaimEmail: () => E.newClaimEmail(claim).html,
  // _shared/shipping-emails.mjs: customer
  returnLabelEmail: () => E.returnLabelEmail(ret, { pdf: Buffer.from('%PDF-1.4'), instructions: 'Drop it at any InPost locker.\nScan the QR code on the label.', postage: 3.95 }).html,
  'returnLabelEmail (free label)': () => E.returnLabelEmail({ ...ret, freeLabel: true }, { pdf: Buffer.from('%PDF-1.4'), instructions: 'Drop it at any InPost locker.', postage: null }).html,
  returnDeclinedEmail: () => E.returnDeclinedEmail(ret).html,
  'returnDeclinedEmail (claim)': () => E.returnDeclinedEmail({ ...claim, rejectionReason: 'The photo shows wear from use, not a print fault.' }).html,
  claimReceivedEmail: () => E.claimReceivedEmail(claim).html,
  claimReplacementEmail: () => E.claimReplacementEmail(claim).html,
  claimRefundEmail: () => E.claimRefundEmail(claim).html,
  // contact.mts
  'contact form: team notification': async () => (await contactMails()).team.html,
  'contact form: acknowledgement': async () => (await contactMails()).ack.html,
  ...(HAS_SUBSCRIBE ? {
    // subscribe.mts + _shared/newsletter-email.mjs
    'newsletter confirmation (Netlify brand env)': () => confirmationMail(NETLIFY_BRAND_ENV).html,
    'newsletter confirmation (no brand env)': () => confirmationMail({}).html,
  } : {}),
};

// ── the checker itself ──────────────────────────────────────────────────

test('the checker flags known-bad samples and passes good ones', () => {
  const bad = '<table><tr><td style="background:#1e3238"><p style="color:#99132f;font-size:14px">#G7H8I9J0</p><p style="font-size:12px;color:#7e9093">footer</p></td></tr></table>'
    + '<a href="#" style="background:#ff00ff;color:#ffffff;font-size:14px">Track your order</a><p style="color:#888;font-size:11px">Item</p>';
  const issues = contrastIssues(bad);
  assert.deepEqual(issues.map((i) => i.text), ['#G7H8I9J0', 'footer', 'Track your order', 'Item']);
  assert.throws(() => assertReadable(bad, 'bad sample'), /4 text element\(s\) below WCAG contrast/);
  assert.equal(contrastIssues('<div style="background:#000"><p style="color:#fff">fine</p><h1 style="color:#767676;font-size:24px">large</h1></div>').length, 0);
});

// ── the shared helper ───────────────────────────────────────────────────

test('readableOn keeps a colour that passes and otherwise moves it to the nearest readable shade of the same hue', () => {
  assert.equal(readableOn('#ffffff', '#000000'), '#ffffff');
  assert.equal(readableOn(SITE_CONFIG.EMAIL_TEXT, SITE_CONFIG.EMAIL_CARD_BG), SITE_CONFIG.EMAIL_TEXT);
  const hue = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const d = max - min;
    if (!d) return null;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };
  for (const [fg, bg, min, lighter] of [
    ['#99132F', '#1e3238', 4.5, true], ['#FF2E45', '#1e3238', 4.5, true], ['#FF00FF', '#ffffff', 4.5, false],
    ['#F0C020', '#ffffff', 4.5, false], ['#ff6b00', '#ffffff', 4.5, false], ['#7e9093', '#1e3238', 4.5, true],
    ['#F0C020', '#01C2D4', 3, false], [SITE_CONFIG.BRAND_ACCENT, SITE_CONFIG.EMAIL_CARD_BG, 4.5, null],
    [SITE_CONFIG.BRAND_ACCENT, '#ffffff', 4.5, null], [SITE_CONFIG.BRAND_ACCENT, SITE_CONFIG.EMAIL_BUTTON_TEXT, 4.5, null],
  ]) {
    const out = readableOn(fg, bg, min);
    assert.ok(contrastRatio(out, bg) >= min, `${fg} on ${bg} -> ${out}: ${contrastRatio(out, bg).toFixed(2)}`);
    assert.ok(Math.abs(contrastRatio(out, bg) - contrast(out, bg)) < 1e-9, 'same maths as the checker');
    if (out.toLowerCase() !== fg.toLowerCase()) {
      const dh = Math.abs(hue(out) - hue(fg));
      assert.ok(Math.min(dh, 360 - dh) < 4, `${fg} -> ${out} keeps its hue`);
      if (lighter !== null) {
        const l = (hex) => contrastRatio(hex, '#000000');
        assert.equal(l(out) > l(fg), lighter, `${fg} on ${bg}: ${lighter ? 'lighter' : 'darker'}`);
      }
    }
  }
  assert.equal(readableOn('not-a-colour', '#ffffff'), 'not-a-colour');
});

// ── every email, this brand's colours ───────────────────────────────────

test('the shipping-emails inventory: every exported email is listed above', () => {
  const builders = Object.keys(E).filter((k) => /Email$/.test(k) && k !== 'sendEmail' && typeof E[k] === 'function');
  assert.equal(builders.length, 13, builders.join(', '));
  for (const name of builders) assert.ok(Object.keys(EMAILS).some((k) => k === name || k.startsWith(`${name} `)), `${name} is covered`);
});

for (const [name, render] of Object.entries(EMAILS)) {
  test(`readable: ${name}`, async () => {
    const html = await render();
    assert.ok(typeof html === 'string' && html.length > 200, `${name}: rendered`);
    assertReadable(html, name);
  });
}

test(`${SITE_CONFIG.BRAND_NAME}: order ref and prices on the order confirmation are the brand accent, in a readable shade`, () => {
  const html = stripeWebhook.buildOrderEmailHtml(session(), lineItems, promo);
  assertReadable(html, 'order confirmation');
  for (const text of ['#G7H8I9J0', '£50.00', '£134.00']) assert.ok(html.includes(text), `${text} shown`);
});

// ── env overrides: awkward colours still come out readable ──────────────

const AWKWARD = [
  // a dark accent on a dark card, a pale one on a light card, a mid grey button
  { BRAND_ACCENT: '#3a1020', EMAIL_ACCENT: '#3a1020', EMAIL_HEADER_BG: '#f4f4f4', EMAIL_MUTED: '#333333', EMAIL_TEXT: '#444444', EMAIL_HEADING: '#2a2a2a', EMAIL_BUTTON_TEXT: '#ffffff' },
  { BRAND_ACCENT: '#fff3a0', EMAIL_ACCENT: '#fff3a0', EMAIL_HEADER_BG: '#ffe9f0', EMAIL_CARD_BG: '#ffffff', EMAIL_PAGE_BG: '#eeeeee', EMAIL_TEXT: '#cccccc', EMAIL_MUTED: '#dddddd', EMAIL_HEADING: '#eeeeee', EMAIL_BUTTON_TEXT: '#ffffff' },
  { BRAND_ACCENT: '#808080', EMAIL_ACCENT: '#808080', EMAIL_HEADER_BG: '#808080', EMAIL_BUTTON_TEXT: '#7a7a7a', EMAIL_HIGHLIGHT: '#303030' },
];

for (const [i, env] of AWKWARD.entries()) {
  test(`env override ${i + 1}: the brand-coloured emails stay readable (no logo, so the wordmark shows too)`, async () => {
    await withEnv({ ...env, LOGO_URL: 'not-a-url' }, async () => {
      for (const name of ['order confirmation', 'Printful "It\'s shipped" (mixed order)', 'wall-art dispatch (two parcels, mixed order)', 'referral thank-you',
        'returnLabelEmail', 'returnDeclinedEmail', 'claimReceivedEmail', 'claimReplacementEmail', 'claimRefundEmail', 'labelReadyEmail',
        'contact form: acknowledgement', 'team alert: in-house (MAKE)']) {
        assertReadable(await EMAILS[name](), `${name} with override ${i + 1}`);
      }
    });
  });
}
