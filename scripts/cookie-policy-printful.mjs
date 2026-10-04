/**
 * scripts/cookie-policy-printful.mjs — Task 7 of the October 2026 audit.
 *
 * Merch images now load through Netlify Image CDN, so visitors never contact
 * printful.com and its Cloudflare __cf_bm cookie can no longer appear. This
 * removes the Printful bullet and any sentence naming Printful or __cf_bm from
 * the cookie policy, and sets lastUpdated to today.
 *
 *   node --env-file=.env scripts/cookie-policy-printful.mjs            dry run
 *   node --env-file=.env scripts/cookie-policy-printful.mjs --apply    write + publish
 *
 * --apply re-reads the document and refuses if its _rev changed since the dry
 * run (plan file) or if it has an open draft. Edits the published document
 * directly, so the change is live on the next build.
 */
import fs from 'node:fs';
import { createClient } from '@sanity/client';

const ID = 'legalPage.cookie-policy';
const PLAN = new URL('./cookie-policy-printful.plan.json', import.meta.url);
const MENTION = /printful|__cf_bm/i;

const client = createClient({
  projectId: 'ngx60q2x', dataset: 'production', apiVersion: '2024-01-01',
  token: process.env.SANITY_API_TOKEN, useCdn: false, perspective: 'raw',
});

const textOf = (b) => (b.children || []).map((c) => c.text || '').join('');
const today = new Date().toISOString().slice(0, 10);

function plan(doc) {
  const unset = [];
  const set = {};
  for (const b of doc.body || []) {
    if (b._type !== 'block' || !MENTION.test(textOf(b))) continue;
    // The bullet that is about Printful goes; anywhere else (paragraphs, other
    // bullets) only the sentences that mention Printful / __cf_bm go.
    if (b.listItem && /^\s*printful\b/i.test(textOf(b))) { unset.push({ key: b._key, old: textOf(b) }); continue; }
    (b.children || []).forEach((c, i) => {
      if (!MENTION.test(c.text || '')) return;
      // Sentences end at . ! ? followed by a space and a capital, so the dots in
      // "files.cdn.printful.com" don't split one. A sentence that only explains
      // the dropped cookie ("It is used only to filter out bots…") goes with it.
      const sentences = c.text.split(/(?<=[.!?])\s+(?=[A-Z])/);
      const kept = sentences.filter((s, i) =>
        !MENTION.test(s) && !(i > 0 && MENTION.test(sentences[i - 1]) && /^It (is|'s) used only/.test(s))).join(' ');
      set[`body[_key=="${b._key}"].children[_key=="${c._key}"].text`] = { old: c.text, next: kept };
    });
  }
  return { unset, set };
}

const doc = await client.getDocument(ID);
if (!doc) throw new Error(`${ID} not found`);
const p = plan(doc);

if (!process.argv.includes('--apply')) {
  for (const u of p.unset) console.log(`REMOVE bullet ${u.key}:\n  ${u.old}`);
  for (const [path, v] of Object.entries(p.set)) console.log(`EDIT ${path}\n  old: ${v.old}\n  new: ${v.next}`);
  console.log(`lastUpdated: ${doc.lastUpdated} → ${today}`);
  fs.writeFileSync(PLAN, JSON.stringify({ _rev: doc._rev }));
  console.log('\nDry run. Run with --apply to write it.');
} else {
  const { _rev } = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  if (doc._rev !== _rev) throw new Error('Edited since the dry run; run the dry run again.');
  if (await client.getDocument(`drafts.${ID}`)) throw new Error('Open draft in Studio; publish or discard it first.');
  if (!p.unset.length && !Object.keys(p.set).length) { console.log('Nothing to change.'); process.exit(0); }
  await client.patch(ID).ifRevisionId(_rev)
    .unset(p.unset.map((u) => `body[_key=="${u.key}"]`))
    .set({ ...Object.fromEntries(Object.entries(p.set).map(([k, v]) => [k, v.next])), lastUpdated: today })
    .commit();
  fs.unlinkSync(PLAN);
  console.log(`Applied: ${p.unset.length} bullet(s) removed, ${Object.keys(p.set).length} sentence edit(s), lastUpdated ${today}.`);
}
