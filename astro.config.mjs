import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
/* Blog posts get a sitemap <lastmod> from their Sanity _updatedAt.
   A failed fetch only drops the lastmod values; it never fails the build. */
async function blogLastmods() {
  try {
    const query = encodeURIComponent(`*[_type == "blogPost" && defined(slug.current)]{"slug": slug.current, "updatedAt": _updatedAt}`);
    const token = process.env.SANITY_READ_TOKEN || process.env.SANITY_API_TOKEN || process.env.SANITY_TOKEN;
    const res = await fetch(`https://ngx60q2x.api.sanity.io/v2024-01-01/data/query/production?query=${query}&perspective=published`,
      token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    const { result } = await res.json();
    return new Map((result || []).map((p) => [`/wasteland-whispers/${p.slug}`, p.updatedAt]));
  } catch (err) {
    console.warn('[sitemap] blog lastmod fetch failed:', err);
    return new Map();
  }
}
const BLOG_LASTMOD = await blogLastmods();
const withBlogLastmod = (item) => {
  const lastmod = BLOG_LASTMOD.get(new URL(item.url).pathname.replace(/\/$/, ''));
  return lastmod ? { ...item, lastmod } : item;
};

export default defineConfig({
  site: 'https://thefuglys.com',
  output: 'static',
  integrations: [
    react(),
    // Transactional pages (noindex) stay out of the sitemap.
    sitemap({ serialize: withBlogLastmod, filter: (page) => !/^\/(order-success|newsletter)(\/|$)/.test(new URL(page).pathname) }),
  ],
  vite: {
    ssr: {
      noExternal: ['@sanity/client', '@sanity/image-url'],
    },
  },
});