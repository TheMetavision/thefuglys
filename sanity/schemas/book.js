// book — The Fuglys graphic-novel series.
// 2026-10-19: brought into the repo. The deployed schema already had this type
// (four book docs exist), but there was no file here, so a `sanity schema
// deploy` from this folder would have dropped it. Fields mirror the deployed
// type; buyUrl is new. The homepage shows "Get the book" only when buyUrl is
// set and status is not coming-soon.
export default {
  name: 'book',
  title: 'Book',
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
      name: 'description',
      title: 'Description',
      type: 'text',
      rows: 4,
    },
    {
      name: 'coverImage',
      title: 'Cover Image',
      type: 'image',
      options: { hotspot: true },
    },
    {
      name: 'seriesOrder',
      title: 'Series Order',
      type: 'number',
      description: 'Position in the series (1, 2, 3...)',
      validation: (Rule) => Rule.required(),
    },
    {
      name: 'format',
      title: 'Format',
      type: 'string',
      options: {
        list: [
          { title: 'Book', value: 'book' },
          { title: 'Comic', value: 'comic' },
          { title: 'Graphic Novel', value: 'graphic-novel' },
        ],
      },
      initialValue: 'book',
    },
    {
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          { title: 'Available', value: 'available' },
          { title: 'Coming Soon', value: 'coming-soon' },
          { title: 'Pre-Order', value: 'pre-order' },
        ],
      },
      initialValue: 'available',
    },
    {
      name: 'buyUrl',
      title: 'Buy URL',
      type: 'url',
      description: 'Where to buy the book. The homepage shows a "Get the book" button only when this is set and the status is not Coming Soon.',
    },
    {
      name: 'orderUrl',
      title: 'Order URL',
      type: 'url',
      description: 'Legacy field, not read by the homepage. Use Buy URL.',
    },
    {
      name: 'publishedAt',
      title: 'Published Date',
      type: 'datetime',
    },
  ],
  orderings: [
    {
      title: 'Series Order',
      name: 'seriesOrderAsc',
      by: [{ field: 'seriesOrder', direction: 'asc' }],
    },
  ],
  preview: {
    select: { title: 'title', status: 'status', order: 'seriesOrder', media: 'coverImage' },
    prepare({ title, status, order, media }) {
      return {
        title: order !== undefined ? `${order}. ${title}` : title,
        subtitle: status,
        media,
      };
    },
  },
};
