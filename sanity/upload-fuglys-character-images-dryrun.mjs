/**
 * Fuglys Character Image Upload — DRY RUN
 *
 * What it does:
 *   - Queries Sanity for all Fuglys characters without portraits
 *   - For each, looks for a matching file at:
 *     C:\Users\chris\Documents\The Fuglys\Characters\<name>\<name>.jpeg
 *   - Reports what it WOULD upload. Does NOT touch Sanity.
 *
 * Usage:
 *   node upload-fuglys-character-images-dryrun.mjs
 */

import {createClient} from '@sanity/client';
import fs from 'fs';
import path from 'path';

const client = createClient({
  projectId: 'ngx60q2x',
  dataset: 'production',
  apiVersion: '2024-01-01',
  useCdn: false,
});

const IMAGES_ROOT = 'C:\\Users\\chris\\Documents\\The Fuglys\\Characters';

async function main() {
  console.log('\n=== Fuglys Character Image Upload — DRY RUN ===\n');

  // Fetch only PUBLISHED character docs that have no portrait asset
  // Exclude drafts (the duplicate Bud draft etc) to keep this clean
  const characters = await client.fetch(
    `*[_type == "character" && !(_id in path("drafts.**")) && !defined(portrait.asset)] | order(name asc){_id, name, "slug": slug.current}`,
  );

  console.log(`Found ${characters.length} published characters without portraits in Sanity.\n`);

  const matched = [];
  const missing = [];

  for (const char of characters) {
    const folderPath = path.join(IMAGES_ROOT, char.name);
    const jpegPath = path.join(folderPath, `${char.name}.jpeg`);
    const jpgPath = path.join(folderPath, `${char.name}.jpg`);

    let found = null;
    if (fs.existsSync(jpegPath)) {
      found = jpegPath;
    } else if (fs.existsSync(jpgPath)) {
      found = jpgPath;
    } else if (fs.existsSync(folderPath)) {
      const files = fs.readdirSync(folderPath).filter((f) =>
        /\.(jpe?g|png|webp)$/i.test(f),
      );
      missing.push({name: char.name, reason: 'no matching file', folderContents: files.slice(0, 10)});
      continue;
    } else {
      missing.push({name: char.name, reason: 'folder missing'});
      continue;
    }

    const stats = fs.statSync(found);
    matched.push({name: char.name, file: found, size: stats.size});
  }

  console.log(`✓ MATCHED (${matched.length}):`);
  for (const m of matched) {
    const sizeKb = (m.size / 1024).toFixed(0);
    console.log(`  ${m.name.padEnd(22)} ${sizeKb}kb`);
  }

  if (missing.length > 0) {
    console.log(`\n✗ MISSING (${missing.length}):`);
    for (const m of missing) {
      console.log(`  ${m.name.padEnd(22)} (${m.reason})`);
      if (m.folderContents && m.folderContents.length > 0) {
        console.log(`      folder has: ${m.folderContents.join(', ')}`);
      }
    }
  }

  console.log(`\nSummary: ${matched.length} ready to upload, ${missing.length} need attention.\n`);
  if (missing.length === 0 && matched.length > 0) {
    console.log('All clear. Run the real upload script next.\n');
  } else if (missing.length > 0) {
    console.log('Review the missing list before running the real upload.\n');
  }
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});
