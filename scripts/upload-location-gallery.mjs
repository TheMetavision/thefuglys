/**
 * scripts/upload-location-gallery.mjs — uploads canon environment renders
 * into worldLocation.referenceGallery from the Higgsfield gallery manifest.
 * One-off content tool; not part of the site build.
 *
 *   node --env-file=.env scripts/upload-location-gallery.mjs --dry-run       lists what would be uploaded
 *   node --env-file=.env scripts/upload-location-gallery.mjs --limit 1       uploads the first pending entry only
 *   node --env-file=.env scripts/upload-location-gallery.mjs                 uploads every pending entry
 *   ... --manifest <path>                                                    overrides the manifest location
 *
 * Writes go to the DRAFT of each document (drafts.<documentId>); a missing
 * draft is created from the published doc. Nothing is published. Entries whose
 * higgsfieldJobId is already in that draft's gallery are skipped, so re-runs
 * never duplicate. Needs SANITY_API_TOKEN (write) in .env.
 */
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@sanity/client';

const DEFAULT_MANIFEST = 'C:\\Users\\chris\\Documents\\The Fuglys\\Locations\\fuglys-location-gallery-manifest.json';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => { const i = args.indexOf(name); return i === -1 ? undefined : args[i + 1]; };
const DRY_RUN = flag('--dry-run');
const LIMIT = opt('--limit') ? Number(opt('--limit')) : Infinity;
const MANIFEST = opt('--manifest') ?? DEFAULT_MANIFEST;

if (!process.env.SANITY_API_TOKEN) throw new Error('SANITY_API_TOKEN is not set (run with --env-file=.env)');

const client = createClient({
  projectId: 'ngx60q2x', dataset: 'production', apiVersion: '2024-12-01',
  token: process.env.SANITY_API_TOKEN, useCdn: false, perspective: 'raw',
});

const entries = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const byDoc = Map.groupBy(entries, (e) => e.documentId.replace(/^drafts\./, ''));

/** Returns the draft, creating it from the published doc if needed (unless dry run). */
async function ensureDraft(id) {
  const draftId = `drafts.${id}`;
  const [draft, published] = await Promise.all([client.getDocument(draftId), client.getDocument(id)]);
  if (draft) return draft;
  if (!published) throw new Error(`${id}: neither draft nor published document exists`);
  if (DRY_RUN) return { ...published, _id: draftId };
  const { _rev, _createdAt, _updatedAt, ...rest } = published;
  console.log(`CREATE   ${draftId} (from published)`);
  return client.createIfNotExists({ ...rest, _id: draftId });
}

let uploaded = 0, skipped = 0;
for (const [id, items] of byDoc) {
  if (uploaded >= LIMIT) break;
  const draft = await ensureDraft(id);
  const slug = draft.slug?.current;
  if (!slug) throw new Error(`${id}: document has no slug`);
  const have = new Set((draft.referenceGallery ?? []).map((g) => g.higgsfieldJobId).filter(Boolean));

  for (const e of items) {
    if (uploaded >= LIMIT) break;
    if (have.has(e.higgsfieldJobId)) { skipped++; console.log(`SKIP     ${slug} ${e.label} (already in gallery)`); continue; }
    const filename = `fuglys-${slug}-${e.label}.png`;
    if (DRY_RUN) { uploaded++; console.log(`WOULD    ${draft._id} ← ${filename}`); continue; }

    const res = await fetch(e.url);
    if (!res.ok) throw new Error(`${e.label}: download failed ${res.status}`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) throw new Error(`${e.label}: unexpected content-type ${type}`);
    const asset = await client.assets.upload('image', Buffer.from(await res.arrayBuffer()), { filename, contentType: type });

    await client.patch(draft._id)
      .setIfMissing({ referenceGallery: [] })
      .append('referenceGallery', [{
        _type: 'image',
        _key: randomUUID().replace(/-/g, '').slice(0, 12),
        asset: { _type: 'reference', _ref: asset._id },
        view: e.view,
        timeOfDay: e.timeOfDay,
        isMaster: Boolean(e.isMaster),
        label: e.label,
        higgsfieldJobId: e.higgsfieldJobId,
      }])
      .commit();
    have.add(e.higgsfieldJobId);
    uploaded++;
    console.log(`ADDED    ${draft._id} ← ${filename} (${asset._id})`);
  }
}
console.log(`\n${uploaded} ${DRY_RUN ? 'pending' : 'uploaded'}, ${skipped} skipped.`);
