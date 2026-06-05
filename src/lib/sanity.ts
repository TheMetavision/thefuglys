import { createClient } from '@sanity/client';
import imageUrlBuilder from '@sanity/image-url';

export const client = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID || 'ngx60q2x',
  dataset: import.meta.env.SANITY_DATASET || 'production',
  apiVersion: '2024-01-01',
  useCdn: true,
  token: import.meta.env.SANITY_API_TOKEN,
});

// Non-CDN client for content that needs fresh reads (e.g. legal pages)
export const liveClient = createClient({
  projectId: import.meta.env.SANITY_PROJECT_ID || 'ngx60q2x',
  dataset: import.meta.env.SANITY_DATASET || 'production',
  apiVersion: '2024-01-01',
  useCdn: false,
  token: import.meta.env.SANITY_API_TOKEN,
});

const builder = imageUrlBuilder(client);

export function urlFor(source: any) {
  return builder.image(source);
}

/** Returns a resolved image URL — Sanity portrait takes priority, imageUrl as fallback */
export function getCharacterImage(char: any, width = 375, height = 619): string {
  if (char.portrait?.asset) {
    return urlFor(char.portrait).width(width).height(height).fit('crop').auto('format').url();
  }
  if (char.imageUrl) return char.imageUrl;
  return '/images/placeholder-character.jpg';
}

/** Returns a resolved image URL for carousel (larger size) */
export function getCharacterImageLarge(char: any): string {
  if (char.portrait?.asset) {
    return urlFor(char.portrait).width(900).fit('max').auto('format').url();
  }
  if (char.imageUrl) return char.imageUrl;
  return '/images/placeholder-character.jpg';
}

// ─── Characters ───────────────────────────────────────────────
export async function getAllCharacters() {
  return client.fetch(`
    *[_type == "character"] | order(sortOrder asc) {
      _id,
      name,
      "slug": slug.current,
      age,
      role,
      characterType,
      displayCategory,
      bio,
      extendedBio,
      portrait,
      imageUrl,
      galleryImages,
      traits,
      quote,
      sortOrder,
      seoTitle,
      seoDescription
    }
  `);
}

export async function getCoreSixCharacters() {
  return client.fetch(`
    *[_type == "character" && characterType == "main"] | order(sortOrder asc) {
      _id,
      name,
      "slug": slug.current,
      age,
      role,
      characterType,
      bio,
      portrait,
      imageUrl,
      traits,
      quote
    }
  `);
}

export async function getNonCoreCharacters(limit = 6) {
  return client.fetch(`
    *[_type == "character" && characterType != "main"] | order(sortOrder asc)[0...$limit] {
      _id,
      name,
      "slug": slug.current,
      age,
      role,
      characterType,
      bio,
      portrait,
      imageUrl,
      quote
    }
  `, { limit });
}

export async function getCharacterBySlug(slug: string) {
  return client.fetch(`
    *[_type == "character" && slug.current == $slug][0] {
      _id,
      name,
      "slug": slug.current,
      age,
      role,
      characterType,
      bio,
      extendedBio,
      portrait,
      imageUrl,
      galleryImages,
      traits,
      quote,
      seoTitle,
      seoDescription
    }
  `, { slug });
}

// ─── Episodes / Media ─────────────────────────────────────────
export async function getAllEpisodes() {
  return client.fetch(`
    *[_type == "episode"] | order(season asc, episodeNumber asc) {
      _id,
      title,
      "slug": slug.current,
      videoType,
      season,
      episodeNumber,
      youtubeUrl,
      youtubeId,
      thumbnail,
      description,
      "featuredCharacters": featuredCharacters[]->{ name, "slug": slug.current, portrait, imageUrl },
      publishedAt,
      duration,
      featured,
      seoTitle,
      seoDescription
    }
  `);
}

export async function getFeaturedEpisodes() {
  return client.fetch(`
    *[_type == "episode" && featured == true] | order(publishedAt desc)[0...4] {
      _id,
      title,
      "slug": slug.current,
      videoType,
      youtubeUrl,
      youtubeId,
      thumbnail,
      description,
      publishedAt,
      duration
    }
  `);
}

// ─── Blog Posts (Wasteland Whispers) ──────────────────────────
export async function getAllBlogPosts() {
  return client.fetch(`
    *[_type == "blogPost"] | order(publishedAt desc) {
      _id,
      title,
      "slug": slug.current,
      category,
      excerpt,
      body,
      "featuredImage": featuredImage.asset->url,
      "relatedCharacters": relatedCharacters[]->{ name, "slug": slug.current },
      publishedAt,
      seoTitle,
      seoDescription
    }
  `);
}

export async function getBlogPostBySlug(slug: string) {
  return client.fetch(`
    *[_type == "blogPost" && slug.current == $slug][0] {
      _id,
      title,
      "slug": slug.current,
      category,
      excerpt,
      body,
      "featuredImage": featuredImage.asset->url,
      "relatedCharacters": relatedCharacters[]->{ name, "slug": slug.current, portrait, imageUrl },
      publishedAt,
      seoTitle,
      seoDescription
    }
  `, { slug });
}

// ─── Products ─────────────────────────────────────────────────
// NESTED model: one product document = one design, holding a variants[] array
// where each entry is a garment type with its own price ladder, colours,
// per-colour mockups (colourImages) and the Printful syncVariantId matrix.
export async function getAllProducts() {
  return client.fetch(`
    *[_type == "product" && active == true] | order(coalesce(sortOrder, 999), name asc) {
      _id,
      name,
      "slug": slug.current,
      active,
      "category": category->{ title, "slug": slug.current },
      "featuredCharacter": featuredCharacter->{ name, "slug": slug.current },
      description,
      designStory,
      heroImage,
      featured,
      seoTitle,
      seoDescription,
      "price": coalesce(price, variants[0].basePrice),
      compareAtPrice,
      variants[]{
        productType,
        label,
        basePrice,
        colours,
        sizes,
        sizePrices[]{ size, price },
        colourImages[]{ colour, imageUrl },
        printfulVariants[]{ size, colour, syncVariantId }
      }
    }
  `);
}

export async function getProductBySlug(slug: string) {
  return client.fetch(`
    *[_type == "product" && slug.current == $slug][0] {
      _id,
      name,
      "slug": slug.current,
      active,
      "category": category->{ title, "slug": slug.current },
      "featuredCharacter": featuredCharacter->{ name, "slug": slug.current, portrait, imageUrl },
      description,
      designStory,
      heroImage,
      featured,
      seoTitle,
      seoDescription,
      "price": coalesce(price, variants[0].basePrice),
      compareAtPrice,
      variants[]{
        productType,
        label,
        basePrice,
        colours,
        sizes,
        sizePrices[]{ size, price },
        colourImages[]{ colour, imageUrl },
        printfulVariants[]{ size, colour, syncVariantId },
        stripePriceId
      }
    }
  `, { slug });
}

export async function getFeaturedProducts() {
  return client.fetch(`
    *[_type == "product" && featured == true && active == true] | order(coalesce(sortOrder, 999), name asc)[0...6] {
      _id,
      name,
      "slug": slug.current,
      heroImage,
      "price": coalesce(price, variants[0].basePrice),
      "category": category->{ title, "slug": slug.current },
      variants[]{
        colourImages[]{ colour, imageUrl }
      }
    }
  `);
}

// ─── Categories ───────────────────────────────────────────────
export async function getAllCategories() {
  return client.fetch(`
    *[_type == "category"] | order(sortOrder asc) {
      _id,
      title,
      "slug": slug.current,
      description,
      image,
      sortOrder
    }
  `);
}

export async function getProductsByCategory(categorySlug: string) {
  return client.fetch(`
    *[_type == "product" && active == true && category->slug.current == $categorySlug] | order(coalesce(sortOrder, 999), name asc) {
      _id,
      name,
      "slug": slug.current,
      heroImage,
      "price": coalesce(price, variants[0].basePrice),
      compareAtPrice,
      featured,
      variants[]{
        colourImages[]{ colour, imageUrl }
      }
    }
  `, { categorySlug });
}

// ─── FAQs ─────────────────────────────────────────────────────
export async function getAllFaqs() {
  return client.fetch(`
    *[_type == "faq"] | order(order asc) {
      _id,
      question,
      answer,
      category,
      order
    }
  `);
}

// ─── Pages ────────────────────────────────────────────────────
export async function getPageBySlug(slug: string) {
  return client.fetch(`
    *[_type == "page" && slug.current == $slug][0] {
      _id,
      title,
      "slug": slug.current,
      body,
      noIndex,
      seoTitle,
      seoDescription
    }
  `, { slug });
}

// ─── Site Settings ────────────────────────────────────────────
export async function getSiteSettings() {
  return client.fetch(`
    *[_type == "siteSettings"][0] {
      siteName,
      tagline,
      siteDescription,
      contactEmail,
      youtubeChannel,
      socialLinks,
      announcementBar,
      logo,
      footerLogo,
      footerText,
      newsletterHeadline,
      newsletterSubtext
    }
  `);
}

// ─── Theme audio (Transmission Signal — Harlan's radio rig) ───
// Added 2026-04-29 for the IP brand theme tune feature.
// Pinned to the canonical singleton document `_id == "siteSettings"` to avoid
// reading the stray UUID-keyed duplicate doc that exists in this dataset.
export interface ThemeAudio {
  audioUrl: string | null;
  trackTitle: string | null;
  trackArtist: string | null;
  enabled: boolean;
}

export async function getThemeAudio(): Promise<ThemeAudio> {
  const result = await client.fetch(`
    *[_type == "siteSettings" && _id == "siteSettings"][0]{
      "audioUrl": themeAudioFile.asset->url,
      "trackTitle": themeTrackTitle,
      "trackArtist": themeTrackArtist,
      "enabled": themeEnabled
    }
  `);
  return {
    audioUrl: result?.audioUrl ?? null,
    trackTitle: result?.trackTitle ?? 'The Fuglys Main Theme',
    trackArtist: result?.trackArtist ?? null,
    enabled: result?.enabled !== false, // default to true if field missing
  };
}

// ─── World Locations ──────────────────────────────────────────
export async function getWorldLocations() {
  return client.fetch(`
    *[_type == "worldLocation" && featuredOnHomepage == true] | order(order asc) {
      _id,
      title,
      "slug": slug.current,
      tagline,
      image,
      order
    }
  `);
}

/** Returns a resolved image URL for a world location card */
export function getWorldLocationImage(loc: any, width = 1200, height = 680): string {
  if (loc.image?.asset) {
    return urlFor(loc.image).width(width).height(height).fit('crop').auto('format').url();
  }
  return '';
}

// ─── Books (Graphic Novel Series) ─────────────────────────────
export async function getAllBooks() {
  return client.fetch(`
    *[_type == "book"] | order(seriesOrder asc) {
      _id,
      title,
      "slug": slug.current,
      description,
      coverImage,
      seriesOrder,
      format,
      orderUrl,
      status,
      publishedAt
    }
  `);
}

/** Returns a resolved image URL for a book cover (2:3 portrait crop) */
export function getBookCoverImage(book: any, width = 600, height = 900): string {
  if (book.coverImage?.asset) {
    return urlFor(book.coverImage).width(width).height(height).fit('crop').auto('format').url();
  }
  return '';
}

// ─── Fallback Data ────────────────────────────────────────
export const FALLBACK_BOOKS = [
  {
    _id: 'fallback-vol-1',
    title: "Blister's Big Night",
    slug: 'blisters-big-night',
    description: "When the gang's hideout is overrun with toxic fumes, they realise the culprit is none other than Blister, the most revolting possum in the wasteland. Desperate for fresh air, they set off on a chaotic mission to relocate their foul-smelling frenemy — only to discover he might be the key to repelling a gang of raiders.",
    seriesOrder: 1,
    format: 'graphic-novel',
    status: 'coming-soon',
    coverImage: null,
  },
  {
    _id: 'fallback-vol-2',
    title: "Axel's Almost Apocalypse",
    slug: 'axels-almost-apocalypse',
    description: "Axel gets his hands on an old, rusty detonator and — against every warning — decides to push the button. When nothing happens, he assumes it's broken. But as strange tremors begin shaking the wasteland, the gang scrambles to stop whatever disaster Axel may have just unleashed.",
    seriesOrder: 2,
    format: 'graphic-novel',
    status: 'coming-soon',
    coverImage: null,
  },
  {
    _id: 'fallback-vol-3',
    title: 'The Great Trash Heist',
    slug: 'the-great-trash-heist',
    description: "Clyde stumbles upon the ultimate jackpot — an untouched landfill rumoured to be loaded with pre-apocalypse treasure. The only problem? A rival gang of scavengers has already claimed it. Flint hatches a ridiculous plan to outwit them, but things quickly spiral into an all-out junkyard battle.",
    seriesOrder: 3,
    format: 'graphic-novel',
    status: 'coming-soon',
    coverImage: null,
  },
  {
    _id: 'fallback-vol-4',
    title: "Daisy's Lost & Found",
    slug: 'daisys-lost-and-found',
    description: "While exploring the wasteland, Daisy discovers an abandoned relic from the past — a rusted-out amusement park hidden in the ruins. Determined to bring some joy to the crew, she convinces them to fix it up. But as strange noises echo from the shadows, they begin to wonder if they're really alone...",
    seriesOrder: 4,
    format: 'graphic-novel',
    status: 'coming-soon',
    coverImage: null,
  },
];

export const FALLBACK_EPISODES = [
  {
    title: "Blister's Big Night",
    description: "When the gang's hideout is overrun with toxic fumes, they realize the culprit is none other than Blister, the most revolting possum in the wasteland.",
    status: "COMING SOON",
    image: "https://images.pexels.com/photos/3617500/pexels-photo-3617500.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    season: 1,
    episode: 1,
  },
  {
    title: "Axel's Almost Apocalypse",
    description: "Axel gets his hands on an old, rusty detonator and—against every warning—decides to push the button.",
    status: "COMING SOON",
    image: "https://images.pexels.com/photos/1252869/pexels-photo-1252869.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    season: 1,
    episode: 2,
  },
  {
    title: "The Great Trash Heist",
    description: "Clyde stumbles upon the ultimate jackpot—an untouched landfill rumored to be loaded with pre-apocalypse treasure.",
    status: "COMING SOON",
    image: "https://images.pexels.com/photos/2547565/pexels-photo-2547565.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    season: 1,
    episode: 3,
  },
  {
    title: "Daisy's Lost & Found",
    description: "While exploring the wasteland, Daisy discovers an abandoned relic from the past—a rusted-out amusement park hidden in the ruins.",
    status: "COMING SOON",
    image: "https://images.pexels.com/photos/1695052/pexels-photo-1695052.jpeg?auto=compress&cs=tinysrgb&w=600&h=400&fit=crop",
    season: 1,
    episode: 4,
  },
];
