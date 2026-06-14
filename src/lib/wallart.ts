// src/lib/wallart.ts  (The Fuglys)
// -----------------------------------------------------------------------------
// Read-side helper for in-house WALL ART. Fetches published `wallArt` docs from
// Sanity at build time for the merch grid and the /wall-art/[slug] PDP.
// Tokenless read against the public dataset (same as create-checkout.js).
//
// Pricing/formats/sizes live in artwork-pricing.cjs, not here.
// -----------------------------------------------------------------------------

const PROJECT_ID = import.meta.env.PUBLIC_SANITY_PROJECT_ID || 'ngx60q2x';
const DATASET = import.meta.env.PUBLIC_SANITY_DATASET || 'production';
const API_VER = '2024-01-01';

export interface WallArtMockup {
  url: string;
  alt?: string;
}

export interface WallArtPiece {
  slug: string;
  title: string;
  tagline?: string;
  description?: string;
  accent?: string;
  featured?: boolean;
  imageUrl: string;
  mockups: WallArtMockup[];
}

const QUERY = `*[_type == "wallArt" && active == true] | order(coalesce(sortOrder, 999) asc, _createdAt desc){
  "slug": slug.current,
  title,
  tagline,
  description,
  accent,
  featured,
  "imageUrl": image.asset->url,
  "mockups": mockups[]{ "url": asset->url, "alt": alt }
}`;

async function runQuery<T>(query: string): Promise<T | null> {
  const url = `https://${PROJECT_ID}.api.sanity.io/v${API_VER}/data/query/${DATASET}?query=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[wallart] Sanity query failed (${res.status})`);
      return null;
    }
    const json = await res.json();
    return (json && json.result) as T;
  } catch (err) {
    console.error('[wallart] Sanity query error:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** All active wall-art pieces, ordered by sortOrder then newest. Never throws —
 *  returns [] on failure so the merch page still builds. */
export async function getAllWallArt(): Promise<WallArtPiece[]> {
  const result = await runQuery<WallArtPiece[]>(QUERY);
  return (result || []).filter((p) => p && p.slug && p.imageUrl)
    .map((p) => ({ ...p, mockups: (p.mockups || []).filter((m) => m && m.url) }));
}
