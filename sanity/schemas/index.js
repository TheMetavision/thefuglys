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
// 2026-06-04: added order (readOnly document) for the COC-model commerce
// build — written by the stripe-webhook function via SANITY_TOKEN.
// Registration only; the Orders desk item is added in the structure file.
// 2026-10-19: book.js created (mirrors the deployed type, adds buyUrl) and registered.
// 2026-10-19: merchCategory.js restored from the deployed schema and registered; live
// fields missing from other types added back (marked Legacy where the site doesn't read them).
import character from './character';
import product from './product';
import printfulVariant from './printfulVariant';
import order from './order';
import wallArt from './wallArt';
import blogPost from './blogPost';
import episode from './episode';
import book from './book';
import merchCategory from './merchCategory';
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
  // Commerce
  product,
  printfulVariant,
  order,
  wallArt,
  // Content types (cont.)
  blogPost,
  episode,
  book,
  merchCategory,
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
