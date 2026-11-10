// GET /api/sd-prize-options  ->  { designs: [{ slug, name, garments: [{ type, label, colours: [{ colour, image, sizes }] }] }] }
// The T-shirts a Scrap Dash prize can be: every active Fuglys design with T-shirt (and, where it has them,
// kids T-shirt) variants, built only from its real Printful variants (netlify/lib/sd-prize.mjs). Read only.
import { json } from '../lib/sd-shared.mjs';
import { sanityRead, PRIZE_QUERY, prizeDesigns } from '../lib/sd-prize.mjs';

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'method' }, 405);
  try {
    return json({ designs: prizeDesigns(await sanityRead(PRIZE_QUERY)) }, 200, { 'cache-control': 'public, max-age=300' });
  } catch (e) {
    console.error('[SD-PRIZE] options failed:', e.message);
    return json({ designs: [], error: 'unavailable' }, 503);
  }
};
