// Every customer email sent through Resend comes from, and takes replies at,
// the brand's own address, set once in netlify/functions/_shared/site-config.mjs.
// Team emails keep their own sender. (fix/brand-sender, 2 Nov 2026)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SITE_CONFIG, setting } from '../netlify/functions/_shared/site-config.mjs';
import { sendEmail, returnDeclinedEmail, returnLabelEmail, labelReadyEmail, newReturnEmail } from '../netlify/functions/_shared/shipping-emails.mjs';
import { CONTACT } from '../netlify/functions/_shared/returns-eligibility.mjs';

const BRAND_FROM = "The Fuglys <chaos@thefuglys.com>";
const BRAND_REPLY = "chaos@thefuglys.com";
const METAVISION = /themetavision\.co\.uk/i;

const fakeResend = () => { const sent = []; return { sent, emails: { send: async (m) => { sent.push(m); return { error: null }; } } }; };
const ret = { orderNumber: '#AB12CD34', customerName: 'Pat', customerEmail: 'pat@example.com', carrier: 'evri', lines: [] };

test('site-config holds the brand sender and reply-to', () => {
  assert.equal(SITE_CONFIG.EMAIL_FROM, BRAND_FROM);
  assert.equal(SITE_CONFIG.EMAIL_REPLY_TO, BRAND_REPLY);
  assert.doesNotMatch(SITE_CONFIG.EMAIL_FROM + SITE_CONFIG.EMAIL_REPLY_TO, METAVISION);
  assert.doesNotMatch(SITE_CONFIG.EMAIL_FROM, /<orders@/);
});

test('no customer-email setting is overridden by this environment', () => {
  for (const k of ['EMAIL_FROM', 'EMAIL_REPLY_TO']) assert.equal(setting(k), SITE_CONFIG[k], k);
});

test('customer return emails: brand sender and reply-to', async () => {
  for (const msg of [returnDeclinedEmail(ret), returnLabelEmail(ret, { pdf: Buffer.from('%PDF'), instructions: '', postage: 3.5 })]) {
    const r = fakeResend();
    assert.equal((await sendEmail(r, msg)).ok, true);
    assert.deepEqual(r.sent[0].to, ['pat@example.com']);
    assert.equal(r.sent[0].from, BRAND_FROM);
    assert.equal(r.sent[0].reply_to, BRAND_REPLY);
  }
});

test('team emails keep their recipient and their own sender', async () => {
  const who = { ref: '#AB12CD34', id: 'order.x', name: 'Pat', address: {} };
  for (const msg of [labelReadyEmail(who, []), newReturnEmail({ ...ret, _id: 'return.x', lines: [] })]) {
    const r = fakeResend();
    await sendEmail(r, msg);
    assert.deepEqual(r.sent[0].to, [SITE_CONFIG.TEAM_EMAIL]);
    assert.equal(r.sent[0].from, SITE_CONFIG.TEAM_EMAIL_FROM);
    assert.equal(r.sent[0].reply_to, SITE_CONFIG.TEAM_EMAIL_REPLY_TO);
  }
});

test('the returns contact address comes from site-config', () => {
  assert.equal(CONTACT, SITE_CONFIG.CONTACT_EMAIL);
});

test('no file that sends customer email hard-codes an address or reads an old sender variable', () => {
  for (const f of [
    "netlify/functions/stripe-webhook.cjs",
    "netlify/functions/printful-webhook.mjs",
    "netlify/functions/contact.mts",
    "netlify/functions/_shared/dispatch-email.mjs",
    "netlify/functions/_shared/referral-reward.mjs",
    "netlify/functions/_shared/shipping-emails.mjs",
    "netlify/functions/_shared/returns-eligibility.mjs",
    "netlify/functions/subscribe.mts"
  ]) {
    const code = readFileSync(new URL('../' + f, import.meta.url), 'utf8')
      .replace(/\/\*[^]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, METAVISION, f);
    assert.doesNotMatch(code, /ORDER_EMAIL_FROM/, f);
    assert.doesNotMatch(code, /'[^'<]*<[^>]*@[^>]*>'/, f + ': a hard-coded "Name <address>"');
  }
});
