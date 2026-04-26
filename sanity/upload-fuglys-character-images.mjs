/**
 * Fuglys Character Image Upload — REAL RUN
 *
 * Uploads character images from C:\Users\chris\Documents\The Fuglys\Characters\<n>\<n>.jpeg
 * to Sanity, patches each character doc's `portrait` field, and publishes the result.
 *
 * Idempotent: re-running will skip characters that already have a portrait.
 * Only touches PUBLISHED docs — the duplicate Bud draft is ignored.
 *
 * Requires SANITY_AUTH_TOKEN environment variable with Editor or Deploy token.
 * Get one at: https://www.sanity.io/manage/personal/project/ngx60q2x/api
 *
 * Usage (PowerShell):
 *   $env:SANITY_AUTH_TOKEN = "<your-token>"
 *   node upload-fuglys-character-images.mjs
 */

import {createClient} from '@sanity/client';
import fs from 'fs';
import path from 'path';

const token = process.env.SANITY_AUTH_TOKEN;
if (!token) {
  console.error('ERROR: SANITY_AUTH_TOKEN env var not set.');
  console.error('In PowerShell: $env:SANITY_AUTH_TOKEN = "your-token-here"');
  console.error('Then re-run this script.');
  console.error('Get a token from: https://www.sanity.io/manage/personal/project/ngx60q2x/api');
  process.exit(1);
}

const client = createClient({
  projectId: 'ngx60q2x',
  dataset: 'production',
  apiVersion: '2024-01-01',
  useCdn: false,
  token,
});

const IMAGES_ROOT = 'C:\\Users\\chris\\Documents\\The Fuglys\\Characters';

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function main() {
  console.log('\n=== Fuglys Character Image Upload — REAL RUN ===\n');

  // Fetch only PUBLISHED characters that don't yet have a portrait (idempotent)
  const characters = await client.fetch(
    `*[_type == "character" && !(_id in path("drafts.**")) && !defined(portrait.asset)] | order(name asc){_id, name, "slug": slug.current}`,
  );

  if (characters.length === 0) {
    console.log('No characters need portraits. All done already.\n');
    return;
  }

  console.log(`${characters.length} characters need portraits. Starting upload.\n`);

  const succeeded = [];
  const failed = [];

  for (const char of characters) {
    const folderPath = path.join(IMAGES_ROOT, char.name);
    const jpegPath = path.join(folderPath, `${char.name}.jpeg`);
    const jpgPath = path.join(folderPath, `${char.name}.jpg`);

    let filePath = null;
    if (fs.existsSync(jpegPath)) filePath = jpegPath;
    else if (fs.existsSync(jpgPath)) filePath = jpgPath;

    if (!filePath) {
      failed.push({name: char.name, reason: 'file not found'});
      console.log(`✗ ${char.name.padEnd(22)} — file not found, skipped`);
      continue;
    }

    try {
      process.stdout.write(`→ ${char.name.padEnd(22)} uploading asset... `);

      // Upload the image asset
      const imageBuffer = fs.readFileSync(filePath);
      const asset = await client.assets.upload('image', imageBuffer, {
        filename: path.basename(filePath),
      });

      process.stdout.write(`patching doc... `);

      // Patch the character doc's portrait field
      await client
        .patch(char._id)
        .set({
          portrait: {
            _type: 'image',
            asset: {
              _type: 'reference',
              _ref: asset._id,
            },
          },
        })
        .commit();

      console.log('✓');
      succeeded.push({name: char.name, assetId: asset._id});

      // Small pause to avoid rate limits
      await sleep(200);
    } catch (err) {
      console.log(`✗ ${err.message}`);
      failed.push({name: char.name, reason: err.message});
    }
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Succeeded: ${succeeded.length}`);
  console.log(`Failed:    ${failed.length}`);

  if (failed.length > 0) {
    console.log(`\nFailures:`);
    for (const f of failed) {
      console.log(`  ${f.name.padEnd(22)} ${f.reason}`);
    }
  }

  if (succeeded.length > 0) {
    console.log(
      `\nPortraits uploaded and attached to ${succeeded.length} character docs.`,
    );
    console.log(
      `The changes may be drafts depending on your auth token — check Studio to verify.`,
    );
    console.log(`Re-run this script safely if needed — it skips characters that already have portraits.\n`);
  }
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
