/**
 * The contact form's two emails, as the handler sends them, carry THIS brand's
 * logo and no other brand's (companion to email-logos.test.mjs; a separate file
 * because it stubs @sanity/client and resend, which the webhooks there import).
 *
 * Identical in thefuglys, labrats, catsoncrack and bikerbabies. LOGO_URL is
 * NOT set here, so the logo has to come from site-config. Nothing is written
 * or sent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const sent = [];
globalThis.__contactLogoSent = sent;
const STUBS = {
  '@sanity/client': 'export function createClient() { return { fetch: async () => 0, create: async (doc) => ({ ...doc }) }; }',
  resend: 'export class Resend { constructor() { this.emails = { send: async (m) => { globalThis.__contactLogoSent.push(m); return { id: "stub" }; } }; } }',
};
registerHooks({
  resolve(spec, ctx, next) { return spec in STUBS ? { url: `stub:${spec}`, shortCircuit: true } : next(spec, ctx); },
  load(url, ctx, next) { return url.startsWith('stub:') ? { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true } : next(url, ctx); },
});

const { SITE_CONFIG } = await import('../netlify/functions/_shared/site-config.mjs');
const { esc } = await import('../netlify/functions/_shared/dispatch-email.mjs');
delete process.env.LOGO_URL;
Object.assign(process.env, {
  SANITY_PROJECT_ID: 'stubproj', SANITY_DATASET: 'test', SANITY_API_TOKEN: 'stub-token', RESEND_API_KEY: 'stub-resend',
  NOTIFICATION_FROM: 'Team <team@example.com>', NOTIFICATION_TO: 'team@example.com',
  BRAND_NAME: SITE_CONFIG.BRAND_NAME, SITE_URL: SITE_CONFIG.SITE_URL,
});
const { handler } = await import('../netlify/functions/contact.mts');

const BRANDS = [
  { name: 'The Fuglys', logo: 'https://thefuglys.com/fuglys-email-logo.png', marks: ['thefuglys.com'] },
  { name: 'Labrats', logo: 'https://labrats.uk/labrats-email-logo.png', marks: ['labrats.uk'] },
  { name: 'Cats On Crack', logo: 'https://catsoncrack.co.uk/coc-logo-purple.png', marks: ['catsoncrack.co.uk'] },
  { name: 'The Biker Babies', logo: 'https://cdn.sanity.io/images/v518t53u/production/0b5d5e7ac5d01c7d532c6f40f006f2940616fe32-1000x600.png?w=600&fm=png', marks: ['thebikerbabies.com', 'v518t53u'] },
];
const OWN = SITE_CONFIG.LOGO_URL;
const others = BRANDS.filter((b) => b.logo !== OWN);
const FOREIGN = [...others.flatMap((b) => [b.name, b.logo, esc(b.logo), ...b.marks]), 'wyrmfuel', 'pixel8multimedia', 'comicstripcanvas', 'dottyandfriends', 'metavision'];

function assertOwnLogo(html, label) {
  assert.ok(html.includes(`src="${esc(OWN)}"`), `${label}: has this brand's logo (${OWN})`);
  const lower = html.toLowerCase();
  for (const m of FOREIGN) assert.ok(!lower.includes(m.toLowerCase()), `${label}: must not contain ${m}`);
}

async function submit() {
  sent.length = 0;
  const res = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' },
    body: JSON.stringify({ name: 'Ada Test', email: 'ada@example.com', subject: 'General', message: 'Hello', botcheck: '', pageUri: `${SITE_CONFIG.SITE_URL}/contact/` }),
  });
  assert.equal(res.statusCode, 200, res.body);
  return { team: sent.find((m) => m.to === 'team@example.com'), ack: sent.find((m) => m.to === 'ada@example.com') };
}

test("this repo's site-config logo is one of the four IP brands' logos", () => {
  assert.ok(BRANDS.some((b) => b.logo === OWN), OWN);
});

test('contact form, LOGO_URL unset: the team email and the acknowledgement both carry this brand\'s logo only', async () => {
  const { team, ack } = await submit();
  assertOwnLogo(team.html, 'team notification');
  assert.ok(team.html.indexOf(esc(OWN)) < team.html.indexOf('New contact-form submission'), 'team: logo above the heading');
  assertOwnLogo(ack.html, 'acknowledgement');
  assert.ok(ack.html.indexOf(esc(OWN)) < ack.html.indexOf('got your message'), 'acknowledgement: logo above the heading');
});

// A non-http LOGO_URL is dropped by brandLook (safeUrl) and the brand name shows
// instead, as in every other IP email.
test('the acknowledgement follows a LOGO_URL override and never uses a non-http one', async () => {
  try {
    process.env.LOGO_URL = 'https://cdn.example.com/brand-logo.png';
    assert.ok((await submit()).ack.html.includes('src="https://cdn.example.com/brand-logo.png"'));
    process.env.LOGO_URL = 'javascript:alert(1)';
    const { ack } = await submit();
    assert.ok(!ack.html.includes('javascript:'));
    assert.doesNotMatch(ack.html, /<img/);
    assert.ok(ack.html.includes(esc(SITE_CONFIG.BRAND_NAME)));
  } finally {
    delete process.env.LOGO_URL;
  }
});
