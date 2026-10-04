/**
 * scripts/seo-content-oct-2026.mjs — blog SEO descriptions from
 * the October 2026 audit (limits: titles 60, descriptions 155).
 *
 *   node --env-file=.env scripts/seo-content-oct-2026.mjs            dry run: prints old → new, writes the plan
 *   node --env-file=.env scripts/seo-content-oct-2026.mjs --apply    applies the plan written by the dry run
 *
 * The dry run records each document's _rev. --apply patches a document only
 * if it is unchanged since then (ifRevisionID) and has no open draft, so
 * anything edited in Studio in between is skipped and reported, not
 * overwritten. Needs SANITY_TOKEN_FUGLYS (write) in .env.
 */
import fs from 'node:fs';
import { createClient } from '@sanity/client';

const PLAN = new URL('./seo-content-oct-2026.plan.json', import.meta.url);
const MAX = { seoTitle: 60, seoDescription: 155 };

/** [_type, slug, field path, new value] */
const EDITS = [
  ['blogPost', 'blister-the-possum-nobody-asked-for', 'seoDescription',
    "Something oozing, hissing and smelling three kinds of wrong stirs in the trailer park. Behind the scenes on the Fuglys' most repulsive cast member."],
  ['blogPost', 'building-the-wasteland-our-world-design-process', 'seoTitle',
    'Building the Wasteland: Our World Design Process'],
  ['blogPost', 'building-the-wasteland-our-world-design-process', 'seoDescription',
    'Every rusted fence post, cracked trailer window and scorched patch of dirt was a decision. How we built the world of The Fuglys from the ground up.'],
  ['blogPost', 'axel-s-slingshot-prop-design-in-animation', 'seoTitle',
    "Axel's Slingshot: Prop Design in Animation"],
  ['blogPost', 'chaos-theory-writing-comedy-into-the-apocalypse', 'seoDescription',
    'The wasteland is grim. The Fuglys are not. Our writers on threading real laughs through a post-apocalyptic world without undermining the stakes.'],
  ['blogPost', 'the-razor-boars-designing-wasteland-creatures', 'seoDescription',
    'Mutant pigs with armored hides and glowing orange eyes: the concept art and iterations behind the Razor Boars, and why Bristleback got meaner.'],
  ['blogPost', 'why-post-apocalyptic-the-story-behind-the-fuglys', 'seoDescription',
    "What happens to the people the hero stories forget? The weird ones, the broken ones, the ones just surviving Tuesday. That's where The Fuglys came from."],
];

const client = createClient({
  projectId: 'ngx60q2x', dataset: 'production', apiVersion: '2024-12-01',
  token: process.env.SANITY_TOKEN_FUGLYS || process.env.SANITY_API_TOKEN, useCdn: false, perspective: 'raw',
});
const get = (doc, path) => path.split('.').reduce((o, k) => o?.[k], doc);

async function dryRun() {
  const plan = [];
  for (const [type, slug, path, next] of EDITS) {
    if (next.length > MAX[path]) throw new Error(`${slug}: new value is ${next.length} chars (> ${MAX[path]})`);
    const doc = await client.fetch(`*[_type == $type && slug.current == $slug && !(_id in path("drafts.**"))][0]`, { type, slug });
    if (!doc) { console.log(`MISSING  ${type} ${slug}`); continue; }
    const old = get(doc, path) ?? '';
    if (old === next) { console.log(`SAME     ${slug} ${path}`); continue; }
    plan.push({ _id: doc._id, _rev: doc._rev, slug, path, old, next });
    console.log(`${slug} ${path}\n  old (${old.length}): ${old}\n  new (${next.length}): ${next}`);
  }
  fs.writeFileSync(PLAN, JSON.stringify(plan, null, 2));
  console.log(`\n${plan.length} change(s) planned. Run with --apply to write them.`);
}

async function apply() {
  const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'));
  // One patch per document, so several fields on one document share its _rev.
  const byDoc = new Map();
  for (const p of plan) byDoc.set(p._id, [...(byDoc.get(p._id) || []), p]);
  let done = 0;
  for (const [id, edits] of byDoc) {
    const label = `${edits[0].slug} (${edits.map((e) => e.path).join(', ')})`;
    const draft = await client.fetch(`count(*[_id == $id])`, { id: `drafts.${id}` });
    if (draft) { console.log(`SKIP (open draft)       ${label}`); continue; }
    try {
      await client.patch(id).ifRevisionId(edits[0]._rev)
        .set(Object.fromEntries(edits.map((e) => [e.path, e.next]))).commit();
      console.log(`DONE     ${label}`); done += edits.length;
    } catch (e) {
      console.log(`SKIP (edited since dry run) ${label}: ${e.message}`);
    }
  }
  console.log(`
${done}/${plan.length} applied.`);
}

await (process.argv.includes('--apply') ? apply() : dryRun());
