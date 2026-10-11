// netlify/functions/newsletter.mts  (The Fuglys)
//
// /api/newsletter: an older sign-up endpoint that no page uses any more (the
// form posts to /.netlify/functions/subscribe). It used to create subscribers
// as "active" with no checks at all, which made it an open door for
// subscription bombing even with the form fixed. It is kept, so the address
// still answers, but as an alias of subscribe.mts: the same Turnstile, limits,
// domain checks and double opt-in apply whichever address is used.
import type { Config } from "@netlify/functions";

export { default } from "./subscribe.mts";

export const config: Config = {
  path: "/api/newsletter",
};
