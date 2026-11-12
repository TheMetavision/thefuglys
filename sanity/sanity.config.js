import { defineConfig } from 'sanity';
import { structureTool } from 'sanity/structure';
import { schemaTypes } from './schemas';
import { shippingDeskItems, shippingTemplates, shippingActions } from './lib/shipping-desk';
export default defineConfig({
  name: 'thefuglys',
  title: 'The Fuglys CMS',
  projectId: 'ngx60q2x',
  dataset: 'production',
  plugins: [
    structureTool({
      structure: (S) =>
        S.list()
          .title('Content')
          .items([
            S.listItem()
              .title('Site Settings')
              .child(
                S.document()
                  .schemaType('siteSettings')
                  .documentId('siteSettings')
              ),
            S.divider(),
            S.documentTypeListItem('character').title('Characters'),
            S.documentTypeListItem('episode').title('Episodes & Videos'),
            S.documentTypeListItem('book').title('Books'),
            S.documentTypeListItem('blogPost').title('Blog Posts'),
            S.divider(),
            S.documentTypeListItem('worldLocation').title('World Locations'),
            S.documentTypeListItem('game').title('Games'),
            S.divider(),
            S.documentTypeListItem('product').title('Products'),
            S.documentTypeListItem('wallArt').title('Wall Art'),
            S.documentTypeListItem('category').title('Categories'),
            S.documentTypeListItem('merchCategory').title('Merch Categories (legacy)'),
            S.documentTypeListItem('order').title('Orders'),
            // Sendcloud wall art: only with SANITY_STUDIO_SHIPPING_ENABLED=true (lib/shipping-desk.js).
            ...shippingDeskItems(S),
            S.divider(),
            S.documentTypeListItem('faq').title('FAQs'),
            S.documentTypeListItem('page').title('Pages'),
            S.divider(),
            S.documentTypeListItem('legalPage').title('Legal Pages'),
            S.divider(),
            S.documentTypeListItem('contactSubmission').title('Contact Submissions'),
          ]),
    }),
  ],
  schema: { types: schemaTypes, templates: shippingTemplates },
  document: { actions: shippingActions },
});
