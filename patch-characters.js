/**
 * Patch characterType + sortOrder on all 32 Fuglys characters
 * 
 * Usage:
 *   1. cd into your thefuglys-build project root
 *   2. npm install @sanity/client  (if not already installed)
 *   3. node patch-characters.js
 * 
 * This uses the Sanity Write API with a token.
 * You'll need a token with Editor/Admin permissions from:
 *   https://www.sanity.io/manage/project/ngx60q2x → API → Tokens → Add API Token
 */

import { createClient } from '@sanity/client';

// ── Replace with your write token ───────────────────────────────
const SANITY_TOKEN = process.env.SANITY_TOKEN || 'YOUR_TOKEN_HERE';
// ─────────────────────────────────────────────────────────────────

const client = createClient({
  projectId: 'ngx60q2x',
  dataset: 'production',
  apiVersion: '2024-01-01',
  useCdn: false,
  token: SANITY_TOKEN,
});

// ── Core Six (characterType: "main") ────────────────────────────
const coreSix = [
  { name: 'Luna',      sortOrder: 1 },
  { name: 'Flint',     sortOrder: 2 },
  { name: 'Axel',      sortOrder: 3 },
  { name: 'Big Ma',    sortOrder: 4 },
  { name: 'Billy Ray', sortOrder: 5 },
  { name: 'Bud',       sortOrder: 6 },
];

// ── Antagonists / Creatures ─────────────────────────────────────
const antagonists = [
  'Blister',           // Mutant Possum
  'Bristleback',       // Leader of the Razor Boars
  'The Blight Hounds', // Rabid Dog Pack
  'Lurk',              // Shadow Bat Leader
  'Scorch',            // Leader of the Fever Foxes
];

// ── Everyone else → "supporting" ────────────────────────────────

async function patchAll() {
  // Fetch all character IDs + names
  const characters = await client.fetch(
    `*[_type == "character"]{ _id, name } | order(name asc)`
  );

  console.log(`Found ${characters.length} characters\n`);

  let transaction = client.transaction();
  let sortCounter = 7; // Core Six take 1-6

  for (const char of characters) {
    const coreSixEntry = coreSix.find(c => c.name === char.name);

    if (coreSixEntry) {
      // Core Six → main
      transaction = transaction.patch(char._id, (p) =>
        p.set({
          characterType: 'main',
          sortOrder: coreSixEntry.sortOrder,
        })
      );
      console.log(`  ✓ ${char.name} → main (sortOrder: ${coreSixEntry.sortOrder})`);

    } else if (antagonists.includes(char.name)) {
      // Creatures / Antagonists
      transaction = transaction.patch(char._id, (p) =>
        p.set({
          characterType: 'antagonist',
          sortOrder: sortCounter++,
        })
      );
      console.log(`  ✓ ${char.name} → antagonist (sortOrder: ${sortCounter - 1})`);

    } else {
      // Supporting characters (Survivors)
      transaction = transaction.patch(char._id, (p) =>
        p.set({
          characterType: 'supporting',
          sortOrder: sortCounter++,
        })
      );
      console.log(`  ✓ ${char.name} → supporting (sortOrder: ${sortCounter - 1})`);
    }
  }

  console.log('\nCommitting transaction...');
  const result = await transaction.commit();
  console.log(`\n✅ Done! Patched ${result.results.length} documents.`);
  console.log('\nNow trigger a Netlify redeploy and your site will work.');
}

patchAll().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
