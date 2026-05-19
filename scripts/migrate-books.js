// scripts/migrate-books.js
// Seeds the 4 Fuglys volumes into Sanity.
// Run from project root: node scripts/migrate-books.js
//
// Matches the cross-brand book schema at
// C:\Users\chris\the-fuglys\schemaTypes\book.js
// (fields: title, slug, description, coverImage, seriesOrder, format, orderUrl, status, publishedAt)
//
// Requires SANITY_API_TOKEN environment variable with Editor permission for
// project ngx60q2x. Set in .env at the project root.

import { createClient } from '@sanity/client';
import dotenv from 'dotenv';

dotenv.config();

const client = createClient({
  projectId: 'ngx60q2x',
  dataset: 'production',
  apiVersion: '2025-01-01',
  token: process.env.SANITY_API_TOKEN,
  useCdn: false,
});

const books = [
  {
    _id: 'book-fuglys-blisters-big-night',
    _type: 'book',
    seriesOrder: 1,
    title: "Blister's Big Night",
    slug: { _type: 'slug', current: 'blisters-big-night' },
    description:
      "When the gang's hideout is overrun with toxic fumes, they realise the culprit is none other than Blister, the most revolting possum in the wasteland. Desperate for fresh air, they set off on a chaotic mission to relocate their foul-smelling frenemy — only to discover he might be the key to repelling a gang of raiders.",
    format: 'graphic-novel',
    status: 'coming-soon',
  },
  {
    _id: 'book-fuglys-axels-almost-apocalypse',
    _type: 'book',
    seriesOrder: 2,
    title: "Axel's Almost Apocalypse",
    slug: { _type: 'slug', current: 'axels-almost-apocalypse' },
    description:
      "Axel gets his hands on an old, rusty detonator and — against every warning — decides to push the button. When nothing happens, he assumes it's broken. But as strange tremors begin shaking the wasteland, the gang scrambles to stop whatever disaster Axel may have just unleashed.",
    format: 'graphic-novel',
    status: 'coming-soon',
  },
  {
    _id: 'book-fuglys-great-trash-heist',
    _type: 'book',
    seriesOrder: 3,
    title: 'The Great Trash Heist',
    slug: { _type: 'slug', current: 'the-great-trash-heist' },
    description:
      "Clyde stumbles upon the ultimate jackpot — an untouched landfill rumoured to be loaded with pre-apocalypse treasure. The only problem? A rival gang of scavengers has already claimed it. Flint hatches a ridiculous plan to outwit them, but things quickly spiral into an all-out junkyard battle.",
    format: 'graphic-novel',
    status: 'coming-soon',
  },
  {
    _id: 'book-fuglys-daisys-lost-and-found',
    _type: 'book',
    seriesOrder: 4,
    title: "Daisy's Lost & Found",
    slug: { _type: 'slug', current: 'daisys-lost-and-found' },
    description:
      "While exploring the wasteland, Daisy discovers an abandoned relic from the past — a rusted-out amusement park hidden in the ruins. Determined to bring some joy to the crew, she convinces them to fix it up. But as strange noises echo from the shadows, they begin to wonder if they're really alone...",
    format: 'graphic-novel',
    status: 'coming-soon',
  },
];

async function migrate() {
  console.log(`🚀 Seeding ${books.length} volumes into Sanity (project ngx60q2x)...\n`);

  for (const book of books) {
    try {
      const result = await client.createOrReplace(book);
      console.log(`✅ Vol ${book.seriesOrder}: ${book.title}`);
      console.log(`   _id: ${result._id}\n`);
    } catch (err) {
      console.error(`❌ Failed: ${book.title}`);
      console.error(`   ${err.message}\n`);
    }
  }

  console.log('✨ Migration complete.');
  console.log('Next step: upload cover images via Sanity Studio for each volume.\n');
}

migrate().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
