// index.js — Schema registry for Sanity Studio
// Import all schemas and export as a flat array.
//
// 2026-05-30: book and merchCategory imports commented out until those
// schema files are created (future work — placeholder names reserved).
// faq and legalPage previously existed as files but weren't registered;
// brought into the active set. Added contactSubmission for the new
// Sanity-backed contact form intake.
// 2026-06-03: added printfulVariant (object type) for the Wyrmfuel-model
// product schema, so the variants[].printfulVariants field resolves.
import character from './character';
import product from './product';
import printfulVariant from './printfulVariant';
import blogPost from './blogPost';
import episode from './episode';
// import book from './book';                  // TODO: create book.js
// import merchCategory from './merchCategory'; // TODO: create merchCategory.js
import category from './category';
import worldLocation from './worldLocation';
import page from './page';
import faq from './faq';
import legalPage from './legalPage';
import siteSettings from './siteSettings';
import contactSubmission from './contactSubmission';
export const schemaTypes = [
  // Content types
  character,
  product,
  printfulVariant,
  blogPost,
  episode,
  // book,           // re-enable when book.js exists
  // merchCategory,  // re-enable when merchCategory.js exists
  category,
  worldLocation,
  page,
  faq,
  legalPage,
  // Singletons
  siteSettings,
  // Form submissions
  contactSubmission,
];
