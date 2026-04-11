export default {
  name: 'episode',
  title: 'Episode / Video',
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
      name: 'videoType',
      title: 'Video Type',
      type: 'string',
      options: {
        list: [
          { title: 'Full Episode', value: 'episode' },
          { title: 'Trailer', value: 'trailer' },
          { title: 'Behind The Scenes', value: 'bts' },
          { title: 'Character Spotlight', value: 'spotlight' },
          { title: 'Short / Clip', value: 'short' },
        ],
      },
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'season',
      title: 'Season',
      type: 'number',
    },
    {
      name: 'episodeNumber',
      title: 'Episode Number',
      type: 'number',
    },
    {
      name: 'youtubeUrl',
      title: 'YouTube URL',
      type: 'url',
      description: 'Full YouTube video or Shorts URL',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'youtubeId',
      title: 'YouTube Video ID',
      type: 'string',
      description: 'Extracted from URL for embedding (e.g. XgwfSjIJre4)',
    },
    {
      name: 'thumbnail',
      title: 'Custom Thumbnail',
      type: 'image',
      options: { hotspot: true },
      description: 'Override YouTube thumbnail if needed',
    },
    {
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 4,
    },
    {
      name: 'richDescription',
      title: 'Rich Description',
      type: 'array',
      of: [{ type: 'block' }],
    },
    {
      name: 'featuredCharacters',
      title: 'Featured Characters',
      type: 'array',
      of: [{ type: 'reference', to: [{ type: 'character' }] }],
    },
    {
      name: 'publishedAt',
      title: 'Published Date',
      type: 'datetime',
    },
    {
      name: 'duration',
      title: 'Duration',
      type: 'string',
      description: 'e.g. "3:45" or "12:30"',
    },
    {
      name: 'featured',
      title: 'Featured on Homepage',
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
  orderings: [
    {
      title: 'Published Date (Newest)',
      name: 'publishedAtDesc',
      by: [{ field: 'publishedAt', direction: 'desc' }],
    },
    {
      title: 'Episode Number',
      name: 'episodeAsc',
      by: [
        { field: 'season', direction: 'asc' },
        { field: 'episodeNumber', direction: 'asc' },
      ],
    },
  ],
  preview: {
    select: {
      title: 'title',
      subtitle: 'videoType',
      media: 'thumbnail',
    },
  },
};
