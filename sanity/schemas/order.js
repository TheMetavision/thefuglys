import {defineType, defineField, defineArrayMember} from 'sanity';

// Ported from Cats On Crack live schema (project 8ksun996), extended for The Fuglys
// with a `shipped` status + tracking / failure fields written by the printful-webhook,
// and the in-house wall-art fields stripe-webhook writes (status "inhouse",
// `fulfilment` per line, `hasInhouse`, `inhouseStatus`).
// readOnly: orders are written only by the webhooks via SANITY_TOKEN.

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
          {title: 'In-house (make & dispatch)', value: 'inhouse'},
          {title: 'Shipped (tracking sent)', value: 'shipped'},
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
            defineField({name: 'fulfilment', title: 'Fulfilment', type: 'string', options: {list: ['printful', 'inhouse']}}),
          ],
          preview: {
            select: {title: 'title', subtitle: 'size'},
          },
        }),
      ],
    }),
    defineField({name: 'hasInhouse', title: 'Has In-house Items', type: 'boolean'}),
    defineField({
      name: 'inhouseStatus',
      title: 'In-house Status',
      type: 'string',
      description: 'Wall art made & dispatched by us. Set to "to-make" when the order comes in.',
      hidden: ({document}) => !document?.hasInhouse,
      options: {
        list: [
          {title: 'To make', value: 'to-make'},
          {title: 'Made', value: 'made'},
          {title: 'Dispatched', value: 'dispatched'},
        ],
      },
    }),
    defineField({
      name: 'crossBrandCode', title: '⚠ Other brand’s code', type: 'text', rows: 3, readOnly: true,
      description: 'A promotion code that belongs to another IP brand (shared Stripe account). The order stands; decide whether to follow up.',
      hidden: ({value}) => !value,
    }),
    defineField({
      name: 'repeatWelcomeCode', title: '⚠ Repeat welcome code', type: 'text', rows: 3, readOnly: true,
      description: 'A first-order welcome code (CHAOS10) used by an email that already has a paid order. The order stands; decide whether to follow up.',
      hidden: ({value}) => !value,
    }),
    defineField({
      name: 'discountAmount', title: 'Discount (£)', type: 'number', readOnly: true,
      description: 'Promotion code discount on the goods, from Stripe. Line totals above are before it; shipping is never discounted.',
      hidden: ({value}) => !value,
    }),
    defineField({name: 'discountCode', title: 'Discount Code', type: 'string', readOnly: true, hidden: ({value}) => !value}),
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
    // ── Written by printful-webhook on package_shipped / order_failed ──
    defineField({name: 'carrier', title: 'Carrier', type: 'string', readOnly: true}),
    defineField({name: 'trackingNumber', title: 'Tracking Number', type: 'string', readOnly: true}),
    defineField({name: 'trackingUrl', title: 'Tracking URL', type: 'url', readOnly: true}),
    defineField({name: 'shippedAt', title: 'Shipped At', type: 'datetime', readOnly: true}),
    defineField({name: 'failureReason', title: 'Printful Failure Reason', type: 'string', readOnly: true}),
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
      const flag =
        status === 'fulfilment-failed' ? '⚠️ '
        : status === 'shipped' ? '📦 '
        : status === 'fulfilled' ? '✅ '
        : status === 'inhouse' ? '🛠️ '
        : '🟡 ';
      return {title: `${flag}${title || 'Order'}`, subtitle};
    },
  },
});
