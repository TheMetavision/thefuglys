import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
export default defineConfig({
  site: 'https://thefuglys.com',
  output: 'static',
  integrations: [
    react(),
    // Transactional pages (noindex) stay out of the sitemap.
    sitemap({ filter: (page) => !/\/order-success\/?$/.test(new URL(page).pathname) }),
  ],
  vite: {
    ssr: {
      noExternal: ['@sanity/client', '@sanity/image-url'],
    },
  },
});