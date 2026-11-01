/**
 * The Fuglys' non-secret settings for the shipping code, committed instead of
 * held as Netlify environment variables.
 *
 * WHY. Every variable scoped to Functions is copied into every function, and
 * AWS Lambda refuses a function whose environment is over 4 KB. A brand
 * address, a colour or a public URL costs the same bytes as a secret but
 * protects nothing, so new settings live here and only secrets go in Netlify.
 * (Comic Strip Canvas had a deploy fail on exactly this.)
 *
 * OVERRIDES. Each key is the name of an environment variable. If that variable
 * is set (non-empty) it still wins, so a value can be changed for one deploy
 * context without a commit. A few names (SITE_URL, LOGO_URL, BRAND_NAME,
 * BRAND_ACCENT, EMAIL_HEADER_BG, SANITY_PROJECT_ID, SANITY_DATASET) are
 * already set in Netlify with the same values; they keep working.
 *
 * NOTHING SECRET GOES IN THIS FILE. It is in the repository's history for
 * ever. Tokens, API keys and webhook secrets stay in Netlify.
 *
 * This is the ONLY brand-specific file in the shipping code: every other
 * netlify/functions/_shared/ shipping module is the same in The Fuglys,
 * Labrats, Cats On Crack and The Biker Babies.
 */

export const SITE_CONFIG = Object.freeze({
  SITE_URL: 'https://thefuglys.com',
  SITE_HOST: 'thefuglys.com',
  STUDIO_URL: 'https://thefuglys.sanity.studio',

  SANITY_PROJECT_ID: 'ngx60q2x',
  SANITY_DATASET: 'production',

  BRAND_NAME: 'The Fuglys',
  // In email subjects: "Your Labrats wall art is on its way".
  BRAND_SHORT: 'Fuglys',

  // Customer emails come from the same sender as Printful's "It's shipped"
  // email (ORDER_EMAIL_FROM, unset in Netlify, so its default); replies go to the address the
  // Returns & Refunds policy gives.
  EMAIL_FROM: 'The Fuglys <orders@thefuglys.com>',
  EMAIL_REPLY_TO: 'contact@themetavision.co.uk',
  // Shipping, returns and alert emails to the team (NOTIFICATION_TO).
  TEAM_EMAIL: 'chaos@thefuglys.com',
  // The address the policies tell customers to write to.
  CONTACT_EMAIL: 'contact@themetavision.co.uk',

  // The look of the customer emails: the "It's shipped" email's palette
  // (printful-webhook.mjs), so both read as one brand.
  LOGO_URL: 'https://thefuglys.com/fuglys-email-logo.png',
  BRAND_ACCENT: '#FF2E45',
  EMAIL_HEADER_BG: '#274045',
  EMAIL_PAGE_BG: '#16262b',
  EMAIL_CARD_BG: '#1e3238',
  EMAIL_HEADING: '#ffffff',
  EMAIL_TEXT: '#c4d0d1',
  EMAIL_MUTED: '#9aa8aa',
  EMAIL_RULE: '#2e4a51',
  EMAIL_BUTTON_TEXT: '#ffffff',
  // The wall-art dispatch email's opening line, in the voice of the
  // "It's shipped" email ("Your gear's left the wasteland…").
  DISPATCH_LINE: "Your wall art's left the wasteland and is on its way",

  // The metavision-shipping service. Every call is HMAC-signed with
  // SHIPPING_SECRET, which stays in Netlify.
  SHIPPING_API_URL: 'https://mv-shipping-svc-26.netlify.app',
  SHIPPING_BRAND: 'FUGLYS',

  // Several posters travel rolled in one tube. The service declares the
  // band's weight (the largest poster's band), so each poster beyond the
  // first adds this many grams, sent to create-parcel as extraWeightG.
  // ⚠ Alan to confirm against a weighed tube.
  POSTER_EXTRA_WEIGHT_G: '70',

  // /returns covers wall art. Merchandise (Printful) returns are built but off
  // until the X1 (mailer) and X2 (bulky box) bands are measured on the
  // shipping service. "true" turns them on.
  RETURNS_CLOTHING: 'false',

  // Where /returns sends people while it is switched off.
  RETURNS_POLICY_PATH: '/legal/returns-refunds/',

  // Where each carrier's returns are collected from. For the team's "ready to
  // collect" email only; never sent to a customer.
  RETURN_POINT_INPOST: 'InPost locker, 59 West Road, Shoeburyness',
  RETURN_POINT_EVRI: 'ASDA Shoebury, North Shoebury Road',
  RETURN_POINT_UPS: 'Skanda, 93-95 West Road, Shoeburyness',
});

/**
 * A setting: the environment variable of the same name if it is set, else the
 * committed value.
 *
 * @param {keyof typeof SITE_CONFIG} name
 * @param {Record<string, string|undefined>} [env] defaults to process.env; tests pass their own
 */
export function setting(name, env = process.env) {
  if (!(name in SITE_CONFIG)) throw new Error(`site-config: unknown setting ${name}`);
  const v = env?.[name];
  return typeof v === 'string' && v.trim() ? v.trim() : SITE_CONFIG[name];
}

/** A yes/no setting. */
export const flag = (name, env = process.env) => ['true', '1', 'yes'].includes(setting(name, env).toLowerCase());

/** A whole-number setting (grams and the like); `fallback` if it isn't one. */
export function intSetting(name, fallback = 0, env = process.env) {
  const n = Number(setting(name, env));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

/**
 * The Sanity token for a function that WRITES, in the order stripe-webhook
 * and printful-webhook already read them.
 */
export function sanityWriteToken(env = process.env) {
  for (const name of ['SANITY_API_TOKEN', 'SANITY_TOKEN']) {
    const v = env?.[name];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}
