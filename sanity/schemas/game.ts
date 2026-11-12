import { defineArrayMember, defineField, defineType } from 'sanity';

/**
 * game — a brand game (e.g. Junkyard Racers) and its private art.  [CROSS-BRAND]
 *
 * Studio and Social Content Studio only: the website never queries this type,
 * and it has no page or sitemap entry.
 *
 * The dataset is publicly readable (Free plan). A document whose _id contains a
 * "." (e.g. game.junkyard-racers) can only be read with a token, so create game
 * records through the API with a dotted id rather than from the Studio "+"
 * button, which makes a random undotted id.
 */
export default defineType({
  name: 'game',
  title: 'Game',
  type: 'document',
  fields: [
    defineField({
      name: 'title',
      title: 'Title',
      type: 'string',
      description: 'e.g. "Junkyard Racers"',
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      options: { source: 'title', maxLength: 96 },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'url',
      title: 'Live game page',
      type: 'url',
    }),
    defineField({
      name: 'characters',
      title: 'Characters',
      type: 'array',
      of: [defineArrayMember({ type: 'reference', to: [{ type: 'character' }] })],
      validation: (rule) => rule.unique(),
    }),
    defineField({
      name: 'gameArt',
      title: 'Game art (private)',
      description: 'Title cards, level cards, stage art, model renders and promos. Not shown on the website.',
      type: 'array',
      options: { layout: 'grid' },
      of: [defineArrayMember({ type: 'galleryImage' })],
    }),
  ],
  preview: {
    select: { title: 'title', subtitle: 'url', media: 'gameArt.0.asset' },
  },
});
