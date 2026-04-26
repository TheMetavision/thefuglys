/**
 * Publishes all character drafts (drafts.character-*) in one go.
 * Run with: npx sanity exec ./publish-character-drafts.mjs --with-user-token
 *
 * Uses the auth token from your sanity login session.
 */
import { getCliClient } from 'sanity/cli';

const client = getCliClient({ apiVersion: '2024-01-01' });

const drafts = await client.fetch(
  `*[_type == "character" && _id in path("drafts.**")]{ _id, name }`
);

console.log(`Found ${drafts.length} drafts to publish.\n`);

let success = 0;
let failed = 0;

for (const draft of drafts) {
  const publishedId = draft._id.replace(/^drafts\./, '');
  try {
    // Fetch the draft, strip the drafts. prefix, write as published, delete draft
    const draftDoc = await client.getDocument(draft._id);
    if (!draftDoc) {
      throw new Error('Draft document not found');
    }
    const { _id, _rev, ...rest } = draftDoc;
    await client
      .transaction()
      .createOrReplace({ ...rest, _id: publishedId })
      .delete(draft._id)
      .commit();
    console.log(`  ✓ Published ${draft.name} (${publishedId})`);
    success++;
  } catch (err) {
    console.error(`  ✗ Failed ${draft.name}: ${err.message}`);
    failed++;
  }
}

console.log(`\nDone. ${success} published, ${failed} failed.`);
