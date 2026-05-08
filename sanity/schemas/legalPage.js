import { defineField, defineType } from 'sanity'

/**
 * Legal Page schema
 *
 * Drop this file into:  studio/schemaTypes/legalPage.ts
 * Then register it in studio/schemaTypes/index.ts
 */
export default defineType({
  name: 'legalPage',
  title: 'Legal Page',
  type: 'document',
  fields: [
    defineField({ name: 'title', title: 'Title', type: 'string', validation: (R) => R.required().max(120) }),
    defineField({ name: 'slug',  title: 'Slug',  type: 'slug', options: { source: 'title', maxLength: 96 }, validation: (R) => R.required() }),
    defineField({ name: 'order', title: 'Display Order', type: 'number', initialValue: 100 }),
    defineField({ name: 'summary', title: 'Summary', type: 'text', rows: 3, validation: (R) => R.max(300) }),
    defineField({ name: 'effectiveDate', title: 'Effective Date', type: 'date', validation: (R) => R.required() }),
    defineField({ name: 'lastUpdated',   title: 'Last Updated',   type: 'date', validation: (R) => R.required() }),
    defineField({
      name: 'body', title: 'Body', type: 'array',
      of: [{
        type: 'block',
        styles: [
          { title: 'Normal', value: 'normal' },
          { title: 'H2', value: 'h2' },
          { title: 'H3', value: 'h3' },
          { title: 'H4', value: 'h4' },
          { title: 'Quote', value: 'blockquote' },
        ],
        lists: [
          { title: 'Bullet', value: 'bullet' },
          { title: 'Number', value: 'number' },
        ],
        marks: {
          decorators: [
            { title: 'Strong', value: 'strong' },
            { title: 'Emphasis', value: 'em' },
            { title: 'Code', value: 'code' },
          ],
          annotations: [{
            name: 'link', type: 'object', title: 'Link',
            fields: [
              { name: 'href', type: 'url', title: 'URL',
                validation: (R) => R.uri({ scheme: ['http','https','mailto','tel'] }) },
              { name: 'newTab', type: 'boolean', title: 'Open in new tab', initialValue: false },
            ],
          }],
        },
      }],
      validation: (R) => R.required().min(1),
    }),
    defineField({ name: 'showInFooter', title: 'Show in site footer', type: 'boolean', initialValue: true }),
    defineField({ name: 'noIndex', title: 'Hide from search engines', type: 'boolean', initialValue: false }),
  ],
  orderings: [
    { title: 'Display Order', name: 'orderAsc', by: [{ field: 'order', direction: 'asc' }] },
    { title: 'Last Updated, Newest', name: 'lastUpdatedDesc', by: [{ field: 'lastUpdated', direction: 'desc' }] },
  ],
  preview: {
    select: { title: 'title', slug: 'slug.current', lastUpdated: 'lastUpdated' },
    prepare({ title, slug, lastUpdated }) {
      return { title: title || 'Untitled Legal Page', subtitle: `/legal/${slug || '...'}  ·  Updated ${lastUpdated || '—'}` }
    },
  },
})
