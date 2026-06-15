import { defineType, defineField } from 'sanity';

/**
 * Wall Art — in-house printed & dispatched character artwork.  [CROSS-BRAND]
 *
 * Identical across all four IP brands. Unlike `product` (POD via Printful),
 * Wall Art is manufactured and shipped in-house. So there is NO Printful variant
 * matrix here and NO prices on the document: every piece shares the global
 * format × size matrix (see src/lib/artwork-pricing.cjs — mirrored from CSC):
 *
 *   Poster Print            12x8 £9.99   16x12 £12.99  24x16 £16.99
 *   Canvas Standard Frame   12x8 £26.99  16x12 £31.99  24x16 £44.99
 *   Canvas Gallery Frame    12x8 £28.99  16x12 £33.99  24x16 £46.99
 *
 * A piece holds: the display artwork, a mockups[] gallery, an optional character
 * link (group images for now; individual character pieces later), and editorial
 * copy. Format/size are chosen on the storefront, priced from the module, and the
 * cart line is tagged productType:"wallart" so checkout prices it server-side and
 * the webhook routes it to in-house dispatch (never Printful).
 *
 * NOTE: no `category` reference here — the brands disagree on the category type
 * name (merchCategory vs category) and the Wall Art grid is flat, so it's omitted
 * for portability. `character` exists in every IP brand, so the link is safe.
 *
 * DEPLOY: drop into the brand's schemas/, register in schemas/index.js, then
 * `npx sanity deploy` (NOT the MCP deploy_schema tool).
 */
export default defineType({
  name: 'wallArt',
  title: 'Wall Art',
  type: 'document',
  icon: () => '🖼️',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (r) => r.required() }),
    defineField({
      name: 'slug', title: 'Slug', type: 'slug',
      options: { source: 'title', maxLength: 96 }, validation: (r) => r.required(),
    }),

    defineField({
      name: 'image', title: 'Artwork Image', type: 'image', options: { hotspot: true },
      description: 'The display artwork (the print itself). High-res; shown as the main PDP image.',
      validation: (r) => r.required(),
    }),
    defineField({ name: 'posterMockup', title: 'Poster Mockup', type: 'image', options: { hotspot: true } }),
    defineField({ name: 'roomMockup',   title: 'Room Mockup',   type: 'image', options: { hotspot: true } }),
    defineField({ name: 'studioMockup', title: 'Studio Mockup', type: 'image', options: { hotspot: true } }),
    defineField({
      name: 'mockups', title: 'Mockup Gallery', type: 'array',
      description: 'Lifestyle / framed mockups shown in the PDP gallery (poster, standard, gallery frame on a wall, etc.).',
      of: [{
        type: 'image', options: { hotspot: true },
        fields: [defineField({ name: 'alt', title: 'Alt text', type: 'string' })],
      }],
    }),

    defineField({ name: 'tagline', title: 'Tagline', type: 'string' }),
    defineField({ name: 'description', title: 'Description', type: 'text', rows: 4, description: 'PDP blurb.' }),

    /* Optional grouping — group images now; individual character pieces later. */
    defineField({
      name: 'character', title: 'Featured Character', type: 'reference',
      to: [{ type: 'character' }],
      description: 'Optional. Leave blank for group / multi-character pieces.',
    }),

    /* Editorial / housekeeping — mirrors product.ts */
    defineField({
      name: 'accent', title: 'Accent Colour', type: 'string',
      description: 'Hex colour for UI accents, e.g. #b3162e',
      validation: (r) => r.regex(/^#[0-9a-fA-F]{6}$/, { name: 'hex colour' }).warning('Use a #RRGGBB hex value'),
    }),
    defineField({ name: 'featured', title: 'Featured', type: 'boolean', initialValue: false }),
    defineField({ name: 'active', title: 'Active', type: 'boolean', initialValue: true }),
    defineField({ name: 'sortOrder', title: 'Sort Order', type: 'number', initialValue: 0 }),
    defineField({ name: 'seoTitle', title: 'SEO Title', type: 'string' }),
    defineField({ name: 'seoDescription', title: 'SEO Description', type: 'text', rows: 2 }),
  ],
  orderings: [
    { title: 'Sort Order', name: 'sortOrder', by: [{ field: 'sortOrder', direction: 'asc' }] },
    { title: 'Title A-Z', name: 'titleAsc', by: [{ field: 'title', direction: 'asc' }] },
  ],
  preview: {
    select: { title: 'title', subtitle: 'tagline', media: 'image' },
    prepare: ({ title, subtitle, media }) => ({ title, subtitle: subtitle || 'Wall Art', media }),
  },
});
