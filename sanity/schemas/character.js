export default {
  name: 'character',
  title: 'Character',
  type: 'document',
  fields: [
    {
      name: 'name',
      title: 'Name',
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
      name: 'age',
      title: 'Age',
      type: 'string',
      description: 'e.g. "13" or "Unknown" for creatures',
    },
    {
      name: 'role',
      title: 'Role',
      type: 'string',
      description: 'e.g. "The Heart", "The Wildcard", "Antagonist"',
    },
    {
      name: 'characterType',
      title: 'Character Type',
      type: 'string',
      options: {
        list: [
          { title: 'Main Cast', value: 'main' },
          { title: 'Supporting', value: 'supporting' },
          { title: 'Antagonist / Creature', value: 'antagonist' },
        ],
      },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'bio',
      title: 'Biography',
      type: 'text',
      rows: 4,
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'extendedBio',
      title: 'Extended Biography',
      type: 'array',
      of: [{ type: 'block' }],
      description: 'Rich text for detailed character page (optional)',
    },
    {
      name: 'portrait',
      title: 'Character Portrait',
      type: 'image',
      options: { hotspot: true },
    },
    {
      name: 'imageUrl',
      title: 'External Image URL',
      type: 'url',
      description: 'Fallback image URL if no portrait uploaded to Sanity (e.g. Zyro CDN URL)',
    },
    {
      name: 'galleryImages',
      title: 'Gallery Images',
      type: 'array',
      of: [{ type: 'image', options: { hotspot: true } }],
    },
    {
      name: 'traits',
      title: 'Key Traits',
      type: 'array',
      of: [{ type: 'string' }],
      description: 'e.g. ["Resourceful", "Cunning", "Loyal"]',
    },
    {
      name: 'quote',
      title: 'Signature Quote',
      type: 'string',
    },
    {
      name: 'sortOrder',
      title: 'Display Order',
      type: 'number',
      description: 'Lower numbers appear first on the Meet The Misfits page',
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
  orderings: [
    {
      title: 'Display Order',
      name: 'sortOrderAsc',
      by: [{ field: 'sortOrder', direction: 'asc' }],
    },
  ],
  preview: {
    select: {
      title: 'name',
      subtitle: 'role',
      media: 'portrait',
    },
  },
};
