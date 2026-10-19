export default {
  name: 'page',
  title: 'Page',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Title',
      type: 'string',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title', maxLength: 96 },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'body',
      title: 'Body',
      type: 'array',
      of: [
        { type: 'block' },
        {
          type: 'image',
          options: { hotspot: true },
          fields: [
            { name: 'alt', title: 'Alt Text', type: 'string' },
            { name: 'caption', title: 'Caption', type: 'string' },
          ],
        },
      ],
    },
    // Legacy (2026-10-19): in the deployed schema, not read by the site.
    {
      name: 'pageType',
      title: 'Page Type',
      type: 'string',
      options: {
        list: [
          { title: 'Home', value: 'home' },
          { title: 'Characters', value: 'characters' },
          { title: 'Media', value: 'media' },
          { title: 'Merch', value: 'merch' },
          { title: 'Blog', value: 'blog' },
          { title: 'Contact', value: 'contact' },
          { title: 'About / World', value: 'about' },
          { title: 'Legal', value: 'legal' },
        ],
      },
      description: 'Legacy',
      hidden: false,
    },
    { name: 'heroImage', title: 'Hero / Banner Image', type: 'image', options: { hotspot: true }, description: 'Legacy', hidden: false },
    { name: 'heroTitle', title: 'Hero Title', type: 'string', description: 'Legacy', hidden: false },
    { name: 'heroSubtitle', title: 'Hero Subtitle', type: 'string', description: 'Legacy', hidden: false },
    { name: 'introText', title: 'Intro Text', type: 'text', rows: 3, description: 'Legacy', hidden: false },
    {
      name: 'sectionImages',
      title: 'Section Images',
      type: 'array',
      of: [
        {
          type: 'object',
          fields: [
            { name: 'sectionId', title: 'Section Identifier', type: 'string' },
            { name: 'image', title: 'Image', type: 'image', options: { hotspot: true } },
            { name: 'alt', title: 'Alt Text', type: 'string' },
          ],
        },
      ],
      description: 'Legacy',
      hidden: false,
    },
    { name: 'metaDescription', title: 'Meta Description', type: 'string', description: 'Legacy', hidden: false },
    {
      name: 'noIndex',
      title: 'No Index (hide from search engines)',
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
      title: 'title',
    },
  },
};
