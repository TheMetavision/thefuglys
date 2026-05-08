/**
 * seed-world-locations-v2.cjs
 * ------------------------------------------------------------------
 * Seeds the 5 new worldLocation documents per brand, drawn from the
 * IP World Locations Bibles (2026-04-27).
 *
 * Generic across all four brands. Configure project ID at the top.
 * Reads the brand-specific data from `./seed-data-world-locations-v2.cjs`.
 *
 * Idempotent: uses createIfNotExists with stable IDs based on slug.
 * Re-running the script is safe — existing docs won't be duplicated.
 *
 * Defaults applied to every seeded doc:
 *   - featuredOnHomepage: false  (hidden until imagery lands)
 *   - image: omitted              (Studio will flag as invalid until added)
 *
 * The image field is schema-required, so seeded docs WILL show as
 * "needs attention" in Studio. That's by design — they're hidden from
 * the homepage via featuredOnHomepage:false until art is uploaded.
 *
 * Authentication: requires SANITY_AUTH_TOKEN in .env (or env var).
 * Token must have create permissions for the target dataset.
 * ------------------------------------------------------------------
 */

const {createClient} = require('@sanity/client')
require('dotenv').config()

// ─── BRAND CONFIG — edit these per brand ─────────────────────────────
const BRAND_CONFIG = {
  fuglys: {
    projectId: 'ngx60q2x',
    dataset: 'production',
    label: 'The Fuglys',
  },
  catsoncrack: {
    projectId: '8ksun996',
    dataset: 'production',
    label: 'Cats On Crack',
  },
  labrats: {
    projectId: 'o9qrmykx',
    dataset: 'production',
    label: 'Labrats',
  },
  thebikerbabies: {
    projectId: 'v518t53u',
    dataset: 'production',
    label: 'The Biker Babies',
  },
}

// Set this to the brand whose Studio this script lives in.
// (Each brand's Studio gets its own copy of this file with this constant set correctly.)
const BRAND = process.env.SEED_BRAND || 'fuglys'

const config = BRAND_CONFIG[BRAND]
if (!config) {
  console.error(`Unknown brand "${BRAND}". Set SEED_BRAND env var to one of: ${Object.keys(BRAND_CONFIG).join(', ')}`)
  process.exit(1)
}

// ─── Sanity client ────────────────────────────────────────────────────
const client = createClient({
  projectId: config.projectId,
  dataset: config.dataset,
  token: process.env.SANITY_AUTH_TOKEN,
  apiVersion: '2024-01-01',
  useCdn: false,
})

if (!process.env.SANITY_AUTH_TOKEN) {
  console.error('SANITY_AUTH_TOKEN not set. Add it to .env at the Studio root.')
  process.exit(1)
}

// ─── Portable Text helpers ───────────────────────────────────────────
let keyCounter = 0
const nextKey = () => `k${(++keyCounter).toString(36).padStart(4, '0')}`

/**
 * Convert one or more plain-text paragraphs to Portable Text blocks.
 *   pt('First paragraph.', 'Second paragraph.')
 */
function pt(...paragraphs) {
  return paragraphs
    .filter(Boolean)
    .map((text) => ({
      _type: 'block',
      _key: nextKey(),
      style: 'normal',
      markDefs: [],
      children: [
        {
          _type: 'span',
          _key: nextKey(),
          text,
          marks: [],
        },
      ],
    }))
}

/**
 * Convert an array of strings to a bulleted Portable Text list.
 *   ptBullets(['First item.', 'Second item.'])
 */
function ptBullets(items) {
  return items.filter(Boolean).map((text) => ({
    _type: 'block',
    _key: nextKey(),
    style: 'normal',
    listItem: 'bullet',
    level: 1,
    markDefs: [],
    children: [
      {
        _type: 'span',
        _key: nextKey(),
        text,
        marks: [],
      },
    ],
  }))
}

/**
 * Build a storyHooks array from {title, description} objects.
 */
function buildHooks(hooks) {
  return hooks.map((h) => ({
    _type: 'storyHook',
    _key: nextKey(),
    title: h.title,
    description: h.description,
  }))
}

// ─── Build a worldLocation document from a data entry ─────────────────
function buildDoc(entry) {
  return {
    _type: 'worldLocation',
    _id: `worldLocation.${entry.slug}`,
    title: entry.title,
    slug: {_type: 'slug', current: entry.slug},
    tagline: entry.tagline,
    order: entry.order,
    featuredOnHomepage: false,
    description: pt(...entry.description),
    sensoryDetail: pt(...entry.sensoryDetail),
    dramaticFunction: pt(...entry.dramaticFunction),
    conflicts: ptBullets(entry.conflicts),
    storyHooks: buildHooks(entry.storyHooks),
    merchandisePotential: entry.merchandisePotential,
    // Note: image field is intentionally omitted — will be added when art lands.
  }
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🌍  Seeding new worldLocation docs for ${config.label}`)
  console.log(`    Project: ${config.projectId} · Dataset: ${config.dataset}\n`)

  let data
  try {
    data = require('./seed-data-world-locations-v2.cjs')
  } catch (err) {
    console.error('Could not load ./seed-data-world-locations-v2.cjs')
    console.error(err.message)
    process.exit(1)
  }

  if (!Array.isArray(data) || data.length === 0) {
    console.error('Data file did not export an array of locations.')
    process.exit(1)
  }

  let created = 0
  let skipped = 0
  let failed = 0

  for (const entry of data) {
    keyCounter = 0 // reset per doc so keys are deterministic within a doc
    const doc = buildDoc(entry)
    try {
      const existing = await client.getDocument(doc._id)
      if (existing) {
        console.log(`  ⊙  ${doc.title} — already exists (skipped)`)
        skipped++
        continue
      }
      const result = await client.createIfNotExists(doc)
      console.log(`  ✓  ${result.title} (order ${result.order})`)
      created++
    } catch (err) {
      console.error(`  ✗  ${doc.title} — ${err.message}`)
      failed++
    }
  }

  console.log(`\nDone. Created: ${created} · Skipped: ${skipped} · Failed: ${failed}\n`)

  if (failed > 0) process.exit(1)
}

main().catch((err) => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
