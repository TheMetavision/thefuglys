// Contact acknowledgement email: plain-text parts must be plain text.
// The preheader is shown as-is in inbox previews (Gmail etc.) and is
// HTML-escaped by renderEmailShell, so an entity like &rsquo; in it arrived
// as "&amp;rsquo;" and showed up literally. Sanity and Resend are stubbed:
// nothing is written or sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const sent = [];
globalThis.__contactTestSent = sent;

const STUBS = {
  '@sanity/client': `
    export function createClient() {
      return { fetch: async () => 0, create: async (doc) => ({ ...doc, _id: 'stub' }) };
    }`,
  resend: `
    export class Resend {
      constructor() { this.emails = { send: async (msg) => { globalThis.__contactTestSent.push(msg); return { id: 'stub' }; } }; }
    }`,
};
registerHooks({
  resolve(specifier, context, next) {
    if (specifier in STUBS) return { url: `stub:${specifier}`, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('stub:')) {
      return { format: 'module', source: STUBS[url.slice(5)], shortCircuit: true };
    }
    return next(url, context);
  },
});

Object.assign(process.env, {
  SANITY_PROJECT_ID: 'stubproj',
  SANITY_DATASET: 'test',
  SANITY_API_TOKEN: 'stub-token',
  RESEND_API_KEY: 'stub-resend',
  NOTIFICATION_FROM: 'Brand <hello@example.com>',
  NOTIFICATION_TO: 'team@example.com',
  BRAND_NAME: 'Test Brand',
  SITE_URL: 'https://example.com',
});

const { handler } = await import('../netlify/functions/contact.mts');

const ENTITY = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i;
const preheaderOf = (html) => {
  const m = html.match(/<div style="display:none;max-height:0;overflow:hidden;opacity:0;">([\s\S]*?)<\/div>/);
  assert.ok(m, 'preheader div present');
  return m[1];
};

test('acknowledgement email: preheader, subject and text carry no HTML entities', async () => {
  sent.length = 0;
  const res = await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://example.com', 'x-forwarded-for': '203.0.113.9' },
    body: JSON.stringify({
      name: 'Audit Tester',
      email: 'audit@example.com',
      subject: 'General',
      message: 'Local test only.',
      botcheck: '',
      pageUri: 'https://example.com/contact/',
    }),
  });
  assert.equal(res.statusCode, 200, res.body);

  const ack = sent.find((m) => m.to === 'audit@example.com');
  assert.ok(ack, 'acknowledgement sent to the visitor');

  const preheader = preheaderOf(ack.html);
  assert.equal(preheader, 'We’ve received your message — Test Brand');
  assert.doesNotMatch(preheader, ENTITY);
  assert.doesNotMatch(ack.subject, ENTITY);
  assert.doesNotMatch(ack.text, ENTITY);

  // Entities are still fine (and expected) in the HTML body itself.
  assert.match(ack.html, /we&rsquo;ve got your message/);

  const note = sent.find((m) => m.to === 'team@example.com');
  assert.ok(note, 'team notification sent');
  assert.doesNotMatch(preheaderOf(note.html), /&amp;[a-z]+;/i);
  assert.doesNotMatch(note.subject, ENTITY);
});
