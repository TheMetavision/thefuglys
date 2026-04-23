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
      description: 'Longer lore copy. Reserved for a future dedicated location page — safe to leave empty for now.',
      of: [{type: 'block'}],
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
