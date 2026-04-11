// ─── Organization Schema ──────────────────────────────────────
export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'The Fuglys',
    url: 'https://thefuglys.com',
    logo: 'https://thefuglys.com/favicon.svg',
    description:
      'Join The Fuglys — an unruly band of wasteland misfits — in animated adventures, blog stories & merch drops.',
    sameAs: [
      'https://www.youtube.com/@TheFuglys',
      'https://www.instagram.com/the_fuglys',
      'https://www.tiktok.com/@thefuglys',
      'https://x.com/TheFuglysMedia',
      'https://www.facebook.com/thefuglysmedia',
    ],
    parentOrganization: {
      '@type': 'Organization',
      name: 'The Metavision Multimedia Limited',
      url: 'https://themetavision.co.uk',
    },
  };
}

// ─── WebSite Schema ───────────────────────────────────────────
export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'The Fuglys',
    url: 'https://thefuglys.com',
    description:
      'Post-apocalyptic animated series, book universe, and official merch from The Fuglys.',
    publisher: {
      '@type': 'Organization',
      name: 'The Fuglys',
    },
  };
}

// ─── Breadcrumb Schema ────────────────────────────────────────
export function breadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// ─── TVSeries Schema (for the animated series) ───────────────
export function tvSeriesSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'TVSeries',
    name: 'The Fuglys',
    description:
      'A post-apocalyptic animated series following a ragtag crew of misfits, scavengers, and troublemakers navigating the wasteland.',
    genre: ['Animation', 'Comedy', 'Post-Apocalyptic'],
    url: 'https://thefuglys.com',
    productionCompany: {
      '@type': 'Organization',
      name: 'The Metavision Multimedia Limited',
    },
  };
}

// ─── Character/Person Schema ──────────────────────────────────
export function characterSchema(character: {
  name: string;
  bio: string;
  image?: string;
  url: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FictionalCharacter',
    name: character.name,
    description: character.bio,
    image: character.image,
    url: character.url,
    partOfSeries: {
      '@type': 'TVSeries',
      name: 'The Fuglys',
    },
  };
}

// ─── Product Schema ───────────────────────────────────────────
export function productSchema(product: {
  name: string;
  description: string;
  price: number;
  image?: string;
  url: string;
  availability?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description,
    image: product.image,
    url: product.url,
    brand: {
      '@type': 'Brand',
      name: 'The Fuglys',
    },
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'GBP',
      availability: product.availability || 'https://schema.org/InStock',
      seller: {
        '@type': 'Organization',
        name: 'The Fuglys',
      },
    },
  };
}

// ─── Article Schema (Blog) ────────────────────────────────────
export function articleSchema(post: {
  title: string;
  excerpt: string;
  publishedAt: string;
  image?: string;
  url: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.excerpt,
    datePublished: post.publishedAt,
    image: post.image,
    url: post.url,
    author: {
      '@type': 'Organization',
      name: 'The Fuglys',
    },
    publisher: {
      '@type': 'Organization',
      name: 'The Metavision Multimedia Limited',
    },
  };
}

// ─── VideoObject Schema ───────────────────────────────────────
export function videoSchema(video: {
  title: string;
  description: string;
  youtubeId: string;
  publishedAt?: string;
  duration?: string;
  thumbnail?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: video.title,
    description: video.description,
    thumbnailUrl:
      video.thumbnail || `https://img.youtube.com/vi/${video.youtubeId}/maxresdefault.jpg`,
    uploadDate: video.publishedAt,
    duration: video.duration,
    embedUrl: `https://www.youtube.com/embed/${video.youtubeId}`,
    contentUrl: `https://www.youtube.com/watch?v=${video.youtubeId}`,
    publisher: {
      '@type': 'Organization',
      name: 'The Fuglys',
    },
  };
}

// ─── FAQ Schema ───────────────────────────────────────────────
export function faqSchema(faqs: { question: string; answer: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };
}

// ─── CollectionPage Schema ────────────────────────────────────
export function collectionSchema(collection: {
  name: string;
  description: string;
  url: string;
  itemCount: number;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: collection.name,
    description: collection.description,
    url: collection.url,
    numberOfItems: collection.itemCount,
    isPartOf: {
      '@type': 'WebSite',
      name: 'The Fuglys',
      url: 'https://thefuglys.com',
    },
  };
}
