import {defineField, defineType} from 'sanity'
import {PinIcon} from '@sanity/icons'

/**
 * worldLocation
 * ------------------------------------------------------------------
 * Represents a location within the brand's world/universe.
 * On The Fuglys this powers the "Welcome To The Pits" section.
 * The same schema is designed to drop into other IP brand datasets
 * (Cats On Crack, Labrats, Biker Babies) with no modification —
 * the "world" itself is defined by the parent brand's content.
 *
 * v2 (2026-04-27): extended with rich content fields driven by the
 * IP World Locations Bibles — sensoryDetail, dramaticFunction,
 * conflicts, storyHooks, merchandisePotential. The original 7 fields
 * are unchanged.
 *
 * v3 (2026-10-19): residents and featuredProducts for The Pits drawer on the
 * homepage. `description` keeps its Portable Text type (existing lore lives in
 * it); a location becomes clickable on the homepage once it has one.
 * ------------------------------------------------------------------
 */
export default defineType({
  name: 'worldLocation',
  title: 'World Location',
  type: 'document',
  icon: PinIcon,
  fields: [
    defineField({
      name: 'title',
      title: 'Name',
      type: 'string',
      description: 'The name of the location, e.g. "Big Ma\'s Clinic"',
      validation: (rule) => rule.required().max(60),
    }),
    defineField({
      name: 'slug',
      title: 'Slug',
      type: 'slug',
      description: 'Used for future dedicated lore pages (e.g. /world/big-mas-clinic)',
      options: {
        source: 'title',
        maxLength: 96,
      },
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'tagline',
      title: 'Tagline',
      type: 'string',
      description: 'Short one-liner shown under the title on the card',
      validation: (rule) => rule.required().max(80),
    }),
    defineField({
      name: 'image',
      title: 'Card Image',
      type: 'image',
      description: 'Background image for the card. Use the hotspot to control where the focal point sits on mobile crops.',
      options: {
        hotspot: true,
      },
      fields: [
        defineField({
          name: 'alt',
          title: 'Alt text',
          type: 'string',
          validation: (rule) => rule.required().warning('Alt text is important for SEO and accessibility'),
        }),
      ],
      validation: (rule) => rule.required(),
    }),
    defineField({
      name: 'order',
      title: 'Display order',
      type: 'number',
      description: 'Lower numbers appear first on the homepage (1, 2, 3, ...)',
      validation: (rule) => rule.required().min(0).integer(),
    }),
    defineField({
      name: 'featuredOnHomepage',
      title: 'Featured on homepage',
      type: 'boolean',
      description: 'Uncheck to hide this location from the homepage section without deleting it',
      initialValue: true,
    }),
    defineField({
      name: 'description',
      title: 'Long description',
      type: 'array',
      description: 'Lore copy. When filled in, the homepage card opens a drawer showing it (with residents and featured products below). Leave empty to keep the card non-clickable.',
      of: [{type: 'block'}],
    }),
    defineField({
      name: 'residents',
      title: 'Residents',
      type: 'array',
      description: 'Up to 4 characters shown as chips in the homepage drawer, linking to Meet the Misfits.',
      of: [{type: 'reference', to: [{type: 'character'}]}],
      validation: (rule) => rule.max(4).unique(),
    }),
    defineField({
      name: 'featuredProducts',
      title: 'Featured products',
      type: 'array',
      description: 'Up to 2 products shown as cards in the homepage drawer. Inactive products are skipped.',
      of: [{type: 'reference', to: [{type: 'product'}]}],
      validation: (rule) => rule.max(2).unique(),
    }),

    // ─── v2 fields (2026-04-27) — rich content from the World Locations Bibles ───

    defineField({
      name: 'sensoryDetail',
      title: 'Sensory detail',
      type: 'array',
      description: 'Sight, sound, smell. Atmosphere paragraph used by detail pages and to brief illustrators.',
      of: [{type: 'block'}],
    }),
    defineField({
      name: 'dramaticFunction',
      title: 'Dramatic function',
      type: 'array',
      description: 'What kind of scene belongs here narratively. Short paragraph.',
      of: [{type: 'block'}],
    }),
    defineField({
      name: 'conflicts',
      title: 'Recurring conflicts',
      type: 'array',
      description: 'What tends to happen at this location — recurring tensions and dilemmas.',
      of: [{type: 'block'}],
    }),
    defineField({
      name: 'storyHooks',
      title: 'Story hooks',
      type: 'array',
      description: '4–5 episode or issue seeds tied to this location. Used by Arc for ideation and by detail pages to surface story possibilities.',
      of: [
        {
          type: 'object',
          name: 'storyHook',
          title: 'Story hook',
          fields: [
            defineField({
              name: 'title',
              title: 'Hook title',
              type: 'string',
              validation: (rule) => rule.required().max(120),
            }),
            defineField({
              name: 'description',
              title: 'Hook description',
              type: 'text',
              rows: 3,
              validation: (rule) => rule.required().max(600),
            }),
          ],
          preview: {
            select: {title: 'title', subtitle: 'description'},
          },
        },
      ],
      validation: (rule) =>
        rule.max(8).warning('Most locations have 4–5 hooks; over 8 may signal scope creep.'),
    }),
    defineField({
      name: 'merchandisePotential',
      title: 'Merchandise potential',
      type: 'array',
      description: 'Product concepts derived from this location (one-liners). Used by Vale and Arc for merch ideation.',
      of: [{type: 'string'}],
      options: {layout: 'tags'},
      validation: (rule) =>
        rule.max(8).warning('Most locations have ~4 merch concepts.'),
    }),
  ],
  orderings: [
    {
      title: 'Display order',
      name: 'orderAsc',
      by: [{field: 'order', direction: 'asc'}],
    },
    {
      title: 'Title A–Z',
      name: 'titleAsc',
      by: [{field: 'title', direction: 'asc'}],
    },
  ],
  preview: {
    select: {
      title: 'title',
      subtitle: 'tagline',
      media: 'image',
      order: 'order',
      featured: 'featuredOnHomepage',
    },
    prepare({title, subtitle, media, order, featured}) {
      const prefix = order !== undefined ? `${order}. ` : ''
      const suffix = featured === false ? ' (hidden)' : ''
      return {
        title: `${prefix}${title}${suffix}`,
        subtitle,
        media,
      }
    },
  },
})
