import {defineType, defineField, defineArrayMember} from 'sanity'

// Ported verbatim from Cats On Crack live schema (project 8ksun996).
// readOnly: orders are written only by the stripe-webhook function via SANITY_TOKEN.

export default defineType({
  name: 'order',
  title: 'Order',
  type: 'document',
  readOnly: true,
  fields: [
    defineField({name: 'orderRef', title: 'Order Ref', type: 'string'}),
    defineField({name: 'placedAt', title: 'Placed At', type: 'datetime'}),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: {
        list: [
          {title: 'Paid (not yet fulfilled)', value: 'paid'},
          {title: 'Fulfilled (sent to Printful)', value: 'fulfilled'},
          {title: 'Fulfilment FAILED — action needed', value: 'fulfilment-failed'},
        ],
      },
    }),
    defineField({name: 'customerName', title: 'Customer Name', type: 'string'}),
    defineField({name: 'customerEmail', title: 'Customer Email', type: 'string'}),
    defineField({
      name: 'items',
      title: 'Items',
      type: 'array',
      of: [
        defineArrayMember({
          name: 'lineItem',
          title: 'Line Item',
          type: 'object',
          fields: [
            defineField({name: 'title', title: 'Item', type: 'string'}),
            defineField({name: 'productType', title: 'Garment', type: 'string'}),
            defineField({name: 'colour', title: 'Colour', type: 'string'}),
            defineField({name: 'size', title: 'Size', type: 'string'}),
            defineField({name: 'quantity', title: 'Qty', type: 'number'}),
            defineField({name: 'price', title: 'Line Total (£)', type: 'number'}),
          ],
          preview: {
            select: {title: 'title', subtitle: 'size'},
          },
        }),
      ],
    }),
    defineField({name: 'shippingCost', title: 'Shipping (£)', type: 'number'}),
    defineField({name: 'total', title: 'Total (£)', type: 'number'}),
    defineField({name: 'currency', title: 'Currency', type: 'string'}),
    defineField({
      name: 'shippingAddress',
      title: 'Shipping Address',
      type: 'object',
      fields: [
        defineField({name: 'name', title: 'Name', type: 'string'}),
        defineField({name: 'line1', title: 'Line 1', type: 'string'}),
        defineField({name: 'line2', title: 'Line 2', type: 'string'}),
        defineField({name: 'city', title: 'City', type: 'string'}),
        defineField({name: 'state', title: 'State/County', type: 'string'}),
        defineField({name: 'postalCode', title: 'Postcode', type: 'string'}),
        defineField({name: 'country', title: 'Country', type: 'string'}),
      ],
    }),
    defineField({name: 'stripeSessionId', title: 'Stripe Session ID', type: 'string'}),
    defineField({name: 'printfulOrderId', title: 'Printful Order ID', type: 'string'}),
  ],
  orderings: [
    {
      title: 'Placed (newest first)',
      name: 'placedAtDesc',
      by: [{field: 'placedAt', direction: 'desc'}],
    },
  ],
  preview: {
    select: {title: 'orderRef', subtitle: 'customerEmail', status: 'status'},
    prepare({title, subtitle, status}) {
      const flag = status === 'fulfilment-failed' ? '⚠️ ' : status === 'fulfilled' ? '✅ ' : '🟡 '
      return {title: `${flag}${title || 'Order'}`, subtitle}
    },
  },
})
