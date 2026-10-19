// merchCategory — in the deployed schema (3 docs exist) but had no file here.
// 2026-10-19: restored as-is so a schema deploy from this folder doesn't drop it.
// Not read by the site; products use `category`.
export default {
  name: 'merchCategory',
  title: 'Merch Category (legacy)',
  type: 'document',
  fields: [
    {
      name: 'title',
      title: 'Category Name',
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
    { name: 'description', title: 'Description', type: 'text', rows: 2, description: 'Legacy', hidden: false },
    { name: 'icon', title: 'Icon SVG', type: 'text', rows: 3, description: 'Legacy', hidden: false },
    { name: 'displayOrder', title: 'Display Order', type: 'number', description: 'Legacy', hidden: false },
  ],
};
