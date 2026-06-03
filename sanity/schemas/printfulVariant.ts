/**
 * sanity/schemas/printfulVariant.ts
 *
 * One entry per real Printful sync variant — i.e. per size x colour
 * combination. This is what the Printful Orders API needs to fulfil
 * an order accurately.
 *
 * Registered in schema index; referenced by the `printfulVariants`
 * field on the `variant` object inside product.ts.
 */

import {defineField, defineType} from 'sanity'

export default defineType({
  name: 'printfulVariant',
  title: 'Printful Variant',
  type: 'object',
  fields: [
    defineField({
      name: 'size',
      title: 'Size',
      type: 'string',
      description: 'e.g. "M", "3XL", "One Size" — must match the size string shown to the customer.',
    }),
    defineField({
      name: 'colour',
      title: 'Colour',
      type: 'string',
      description: 'e.g. "Black", "Military Green" — must match the colour string shown to the customer. Empty for products with no colour (stickers, pins).',
    }),
    defineField({
      name: 'syncVariantId',
      title: 'Printful Sync Variant ID',
      type: 'string',
      description: 'The Printful sync_variant_id for this exact size+colour. Used by the Stripe webhook to place the fulfilment order. Populated automatically by the sync script — do not edit by hand.',
      readOnly: true,
    }),
  ],
  preview: {
    select: {size: 'size', colour: 'colour', id: 'syncVariantId'},
    prepare({size, colour, id}) {
      const label = [colour, size].filter(Boolean).join(' / ') || 'Variant'
      return {title: label, subtitle: id ? `Printful #${id}` : 'No ID — re-run sync'}
    },
  },
})
