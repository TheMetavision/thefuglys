/**
 * Whether the Studio shows the Sendcloud dispatch and returns UI.
 *
 * The Netlify functions read SHIPPING_ENABLED, which the Studio cannot see: it
 * is a separate bundle, built by `npx sanity deploy`. Sanity inlines any
 * SANITY_STUDIO_* variable at build time (the exact expression
 * `process.env.SANITY_STUDIO_SHIPPING_ENABLED` is replaced by its value), so
 * this one is set in sanity/.env (SANITY_STUDIO_SHIPPING_ENABLED=true) before
 * deploying. A switch, not a secret -- the Studio bundle is public.
 *
 * Off (unset), the order form, the desk and the actions are as before apart
 * from the wall-art carrier / tracking fields and the dispatch-email stamp,
 * which show either way: hand-dispatch emails do not need Sendcloud.
 */
let on = false;
try {
  // Written out in full so the build can replace it; `process` may not exist
  // in the browser when it isn't replaced, hence the try.
  on = process.env.SANITY_STUDIO_SHIPPING_ENABLED === 'true';
} catch {
  on = false;
}
export const SHIPPING_UI = on;
