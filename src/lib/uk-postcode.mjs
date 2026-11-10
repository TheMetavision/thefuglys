/**
 * UK postcodes for the leaderboard prizes (Scrap Dash; shared with Labrats' Vent Runner): England, Scotland, Wales and
 * Northern Ireland only. Used by the claim page (src/pages/games/claim.astro)
 * and the server (netlify/functions/sd-claim.mjs), so both apply one rule.
 *
 * Refused, each with its own reason so the page can say why:
 *   'crown'   Channel Islands (GY, JE) and the Isle of Man (IM): not part of the UK
 *   'bfpo'    British Forces Post Office addresses
 *   'format'  anything that isn't a UK postcode (including GIR 0AA and the
 *             overseas territories' ASCN 1ZZ-style codes)
 *
 *   ukPostcode(' sw1a 1aa ')  ->  { ok: true, postcode: 'SW1A 1AA' }
 *   ukPostcode('JE2 3AB')     ->  { ok: false, reason: 'crown' }
 */

const SHAPE = /^([A-Z]{1,2}\d[A-Z\d]?) ?(\d[A-Z]{2})$/;
const CROWN = ['GY', 'JE', 'IM'];

/** @returns {{ ok: true, postcode: string } | { ok: false, reason: 'crown'|'bfpo'|'format' }} */
export function ukPostcode(value) {
  const raw = String(value ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
  if (/^BFPO\b/.test(raw.replace(/\s/g, ' '))) return { ok: false, reason: 'bfpo' };
  const m = SHAPE.exec(raw);
  if (!m) return { ok: false, reason: 'format' };
  const area = m[1].match(/^[A-Z]+/)[0];
  if (CROWN.includes(area)) return { ok: false, reason: 'crown' };
  return { ok: true, postcode: `${m[1]} ${m[2]}` };
}

/** What the claim page and the server say for each refusal. */
export const POSTCODE_MESSAGES = {
  crown: "We can only post prizes to England, Scotland, Wales and Northern Ireland, so Channel Islands (GY, JE) and Isle of Man (IM) addresses can't be used.",
  bfpo: "We can't post prizes to BFPO addresses. Please give an address in England, Scotland, Wales or Northern Ireland.",
  format: "That doesn't look like a UK postcode. Prizes can only be posted to England, Scotland, Wales and Northern Ireland.",
};
