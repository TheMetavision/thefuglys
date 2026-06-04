import { defineType, defineField } from 'sanity';

export default defineType({
  name: 'product',
  title: 'Product (Design)',
  type: 'document',
  icon: () => '🔥',
  fields: [
    defineField({
      name: 'name',
      title: 'Design Name',
      type: 'string',
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'name', maxLength: 96 },
      validation: (r) => r.required(),
    }),
    defineField({
      name: 'heroImage',
      title: 'Hero Image',
      type: 'image',
      options: { hotspot: true },
      description: 'Primary design artwork (t-shirt mockup by default)',
    }),
    defineField({
      name: 'accent',
      title: 'Accent Colour',
      type: 'string',
      description: 'Hex colour for UI accents, e.g. #39FF14',
      validation: (r) => r.regex(/^#[0-9a-fA-F]{6}$/, { name: 'hex colour' }),
    }),
    defineField({
      name: 'creatureArtwork',
      title: 'Creature Artwork URL',
      type: 'url',
      description: 'Raw creature illustration (not on a product). Used in Meet the Creatures section.',
    }),
    defineField({
      name: 'tagline',
      title: 'Tagline',
      type: 'string',
    }),
    defineField({
      name: 'backstory',
      title: 'Backstory',
      type: 'text',
      rows: 3,
    }),
    defineField({
      name: 'care',
      title: 'Care Instructions',
      type: 'string',
    }),
    // ADDED (COC parity) — longer editorial copy rendered on the PDP
    defineField({
      name: 'designStory',
      title: 'Design Story',
      type: 'text',
      rows: 4,
      description: 'Longer-form story behind the design (rendered on the product page).',
    }),
    // ADDED (COC parity) — optional link to a Fuglys character
    defineField({
      name: 'featuredCharacter',
      title: 'Featured Character',
      type: 'reference',
      to: [{ type: 'character' }],
      description: 'Optional — links this design to a Fuglys character.',
    }),
    defineField({
      name: 'category',
      title: 'Category',
      type: 'reference',
      to: [{ type: 'category' }],
      description: 'Optional primary category grouping',
    }),
    defineField({
      name: 'variants',
      title: 'Product Variants',
      type: 'array',
      of: [
        {
          type: 'object',
          name: 'variant',
          title: 'Variant',
          fields: [
            defineField({
              name: 'productType',
              title: 'Product Type',
              type: 'string',
              options: {
                list: [
                  { title: 'T-Shirt', value: 'tshirt' },
                  { title: 'Hoodie', value: 'hoodie' },
                  { title: 'Vest Tank', value: 'tank' },
                  { title: 'Long Sleeve', value: 'longsleeve' },
                  { title: 'Socks', value: 'socks' },
                  { title: '20oz Tumbler', value: 'tumbler' },
                  { title: '16oz Can Glass', value: 'glass' },
                  { title: 'Cap', value: 'cap' },   // ADDED — Scavenger Cap
                  { title: 'Mug', value: 'mug' },   // ADDED — Scrap Metal Mug
                ],
              },
              validation: (r) => r.required(),
            }),
            defineField({
              name: 'label',
              title: 'Display Label',
              type: 'string',
              description: 'e.g. "T-Shirt", "Hoodie", "20oz Tumbler"',
            }),
            defineField({
              name: 'thumbnail',
              title: 'Mockup Image',
              type: 'image',
              options: { hotspot: true },
            }),
            defineField({
              name: 'printfulImageUrl',
              title: 'Printful CDN URL',
              type: 'url',
              description: 'Default mockup URL (first colour)',
            }),
            defineField({
              name: 'basePrice',
              title: 'Base Price (£)',
              type: 'number',
              validation: (r) => r.required().positive(),
            }),
            defineField({
              name: 'sizes',
              title: 'Available Sizes',
              type: 'array',
              of: [{ type: 'string' }],
              options: {
                list: [
                  'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'One Size',
                  '16 oz', '16 oz With Lid & Straw', '20 oz',
                  '11 oz', '15 oz',   // ADDED — ceramic mug sizes
                ],
              },
            }),
            defineField({
              name: 'colours',
              title: 'Available Colours',
              type: 'array',
              of: [{ type: 'string' }],
            }),
            defineField({
              name: 'sizePrices',
              title: 'Size-based Pricing',
              type: 'array',
              description: 'Per-size pricing from Printful (larger sizes cost more)',
              of: [
                {
                  type: 'object',
                  name: 'sizePrice',
                  fields: [
                    defineField({ name: 'size', title: 'Size', type: 'string' }),
                    defineField({ name: 'price', title: 'Price (£)', type: 'number' }),
                  ],
                  preview: {
                    select: { title: 'size', subtitle: 'price' },
                    prepare: ({ title, subtitle }) => ({ title, subtitle: `£${subtitle}` }),
                  },
                },
              ],
            }),
            defineField({
              name: 'colourImages',
              title: 'Colour Mockup Images',
              type: 'array',
              description: 'Per-colour mockup URLs from Printful',
              of: [
                {
                  type: 'object',
                  name: 'colourImage',
                  fields: [
                    defineField({
                      name: 'colour',
                      title: 'Colour Name',
                      type: 'string',
                    }),
                    defineField({
                      name: 'imageUrl',
                      title: 'Front Mockup URL',
                      type: 'url',
                    }),
                    defineField({
                      name: 'backImageUrl',
                      title: 'Back Mockup URL',
                      type: 'url',
                      description: 'Back-of-garment mockup (used for shop card carousel)',
                    }),
                  ],
                  preview: {
                    select: { title: 'colour', subtitle: 'imageUrl' },
                  },
                },
              ],
            }),
            defineField({
              name: 'stripePriceId',
              title: 'Stripe Price ID',
              type: 'string',
              description: 'e.g. price_1abc... — used for checkout',
            }),
            defineField({
              name: 'printfulVariantId',
              title: 'Printful Variant ID',
              type: 'string',
            }),
            defineField({
              name: 'printfulVariants',
              title: 'Printful Variants',
              type: 'array',
              description: 'One entry per size x colour — populated automatically by the sync script.',
              of: [{ type: 'printfulVariant' }],
            }),
          ],
          preview: {
            select: { title: 'label', subtitle: 'productType', media: 'thumbnail' },
          },
        },
      ],
    }),
    defineField({
      name: 'printfulProductId',
      title: 'Printful Product ID',
      type: 'string',
      description: 'Top-level Printful sync product ID',
    }),
    defineField({
      name: 'active',
      title: 'Active',
      type: 'boolean',
      initialValue: true,
    }),
    defineField({
      name: 'sortOrder',
      title: 'Sort Order',
      type: 'number',
      initialValue: 0,
    }),
    // ADDED (COC parity) — SEO meta read by the PDP <head>
    defineField({
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'string',
    }),
    defineField({
      name: 'seoDescription',
      title: 'SEO Description',
      type: 'text',
      rows: 2,
    }),
  ],
  orderings: [
    { title: 'Sort Order', name: 'sortOrder', by: [{ field: 'sortOrder', direction: 'asc' }] },
    { title: 'Name A-Z', name: 'nameAsc', by: [{ field: 'name', direction: 'asc' }] },
  ],
  preview: {
    select: { title: 'name', subtitle: 'tagline', media: 'heroImage' },
  },
});
