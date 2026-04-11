/**
 * Patch quotes onto the Core Six Fuglys characters
 * 
 * Usage:
 *   $env:SANITY_TOKEN="your_token_here"
 *   node patch-quotes.js
 */

import { createClient } from '@sanity/client';

const SANITY_TOKEN = process.env.SANITY_TOKEN || 'YOUR_TOKEN_HERE';

const client = createClient({
  projectId: 'ngx60q2x',
  dataset: 'production',
  apiVersion: '2024-01-01',
  useCdn: false,
  token: SANITY_TOKEN,
});

const quotes = [
  {
    name: 'Luna',
    quote: "Every broken thing out here has a story. I just wanna find 'em all.",
  },
  {
    name: 'Flint',
    quote: "I didn't say it was a good plan. I said it was MY plan.",
  },
  {
    name: 'Axel',
    quote: "I'm small, I'm fast, and I bite. What else d'you need?",
  },
  {
    name: 'Big Ma',
    quote: "Hold still, quit whinin', and let me fix what's left of ya.",
  },
  {
    name: 'Billy Ray',
    quote: "Somebody's gotta clean up after these idiots. Might as well be me.",
  },
  {
    name: 'Bud',
    quote: "Look, that only exploded ONCE. And it was barely on fire.",
  },
];

async function patchQuotes() {
  const characters = await client.fetch(
    `*[_type == "character" && characterType == "main"]{ _id, name }`
  );

  console.log(`Found ${characters.length} main characters\n`);

  let transaction = client.transaction();

  for (const quote of quotes) {
    const char = characters.find((c) => c.name === quote.name);
    if (!char) {
      console.log(`  ✗ ${quote.name} — not found in Sanity`);
      continue;
    }

    transaction = transaction.patch(char._id, (p) =>
      p.set({ quote: quote.quote })
    );
    console.log(`  ✓ ${quote.name} → "${quote.quote}"`);
  }

  console.log('\nCommitting...');
  const result = await transaction.commit();
  console.log(`\n✅ Done! Patched ${result.results.length} documents.`);
  console.log('Trigger a Netlify redeploy to see the quotes on the carousel.');
}

patchQuotes().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
