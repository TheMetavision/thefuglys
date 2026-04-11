export default {
  name: 'product',
  title: 'Product',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Product Name',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'name', maxLength: 96 },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'category',
      title: 'Category',
      type: 'reference',
      to: [{ type: 'category' }],
    },
    {
      name: 'featuredCharacter',
      title: 'Featured Character',
      type: 'reference',
      to: [{ type: 'character' }],
      description: 'Link product to a specific character for cross-selling',
    },
    {
      name: 'description',
      title: 'Description',
      type: 'array',
      of: [{ type: 'block' }],
    },
    {
      name: 'designStory',
      title: 'Design Story',
      type: 'text',
      rows: 3,
      description: 'The inspiration/origin behind this design',
    },
    {
      name: 'price',
      title: 'Price (GBP)',
      type: 'number',
      validation: (Rule) => Rule.required().positive(),
    },
    {
      name: 'compareAtPrice',
      title: 'Compare At Price',
      type: 'number',
      description: 'Original price for sale display',
    },
    {
      name: 'images',
      title: 'Product Images',
      type: 'array',
      of: [{ type: 'image', options: { hotspot: true } }],
    },
    {
      name: 'printfulVariants',
      title: 'Printful Variants',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'size', title: 'Size', type: 'string' },
            { name: 'colour', title: 'Colour', type: 'string' },
            {
              name: 'printfulSyncVariantId',
              title: 'Printful Sync Variant ID',
              type: 'string',
              validation: (Rule) => Rule.required(),
            },
            {
              name: 'stripePriceId',
              title: 'Stripe Price ID',
              type: 'string',
              validation: (Rule) => Rule.required(),
            },
            {
              name: 'inStock',
              title: 'In Stock',
              type: 'boolean',
              initialValue: true,
            },
          ],
          preview: {
            select: {
              size: 'size',
              colour: 'colour',
            },
            prepare({ size, colour }) {
              return { title: `${size || ''}${colour ? ' / ' + colour : ''}` };
            },
          },
        },
      ],
    },
    {
      name: 'material',
      title: 'Material',
      type: 'string',
    },
    {
      name: 'featured',
      title: 'Featured Product',
      type: 'boolean',
      initialValue: false,
    },
    {
      name: 'seoTitle',
      title: 'SEO Title',
      type: 'string',
    },
    {
      name: 'seoDescription',
      title: 'SEO Description',
      type: 'text',
      rows: 2,
    },
  ],
  preview: {
    select: {
      title: 'name',
      subtitle: 'price',
      media: 'images.0',
    },
    prepare({ title, subtitle, media }) {
      return {
        title,
        subtitle: subtitle ? `£${subtitle}` : 'No price set',
        media,
      };
    },
  },
};
