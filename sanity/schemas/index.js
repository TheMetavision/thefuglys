// index.js — Schema registry for Sanity Studio
// Import all schemas and export as a flat array
//
// Sync state (2026-05-19): brought back into parity with the deployed studio.
// Restored: category, worldLocation (preserves 3 + 8 existing records).
// Dropped: faq (zero records, no near-term use).
// Newly active: book (file existed but was never deployed).

import character from './character';
import product from './product';
import blogPost from './blogPost';
import episode from './episode';
import book from './book';
import merchCategory from './merchCategory';
import category from './category';
import worldLocation from './worldLocation';
import page from './page';
import siteSettings from './siteSettings';

export const schemaTypes = [
  // Content types
  character,
  product,
  blogPost,
  episode,
  book,
  merchCategory,
  category,
  worldLocation,
  page,
  // Singletons
  siteSettings,
];
