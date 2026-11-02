// sanity/schemas/postDeliveryFields.ts
//
// Marketing consent, the referral programme, the post-delivery sequence and
// Printful's per-package tracking on an order. Every field is written by the
// server and read-only here:
//   marketingConsent        stripe-webhook (from the cart drawer's box)
//   referralCode,
//   postDeliveryStartedAt,
//   postDeliveryError       netlify/functions/_shared/post-delivery.mjs
//   referredBy,
//   referralError           netlify/functions/_shared/referral-reward.mjs
//   printfulShipments       netlify/functions/_shared/printful-shipped.mjs
//
// Identical in thefuglys, labrats, catsoncrack and bikerbabies.

import { defineField, defineArrayMember } from 'sanity';

export function postDeliveryFields() {
  return [
    defineField({
      name: 'marketingConsent',
      title: 'Marketing',
      type: 'string',
      readOnly: true,
      options: {
        list: [
          { title: 'Not asked (soft opt-in: offers and referral emails allowed)', value: 'not_asked' },
          { title: 'Refused at checkout (no offers or referral emails)', value: 'refused' },
        ],
      },
      description: 'From the “Don’t send me offers or referral emails” box in the cart. Empty on orders placed before it existed: those never get the referral email (MailerLite marketing_ok = no).',
    }),
    defineField({
      name: 'referralCode',
      title: 'Referral code (theirs to share)',
      type: 'string',
      readOnly: true,
      description: 'The buyer’s own code: 10% off a friend’s first order. Created when the order first shipped.',
      hidden: ({ value }) => !value,
    }),
    defineField({
      name: 'postDeliveryStartedAt',
      title: 'Post-delivery emails started',
      type: 'datetime',
      readOnly: true,
      description: 'Stamped at the first shipping email (Printful or wall art), when the buyer was added to the MailerLite Customers group. Its presence stops a second start.',
      hidden: ({ value }) => !value,
    }),
    defineField({
      name: 'postDeliveryError',
      title: 'Post-delivery problem',
      type: 'string',
      readOnly: true,
      hidden: ({ value }) => !value,
    }),
    defineField({
      name: 'referredBy',
      title: 'Referred by',
      type: 'object',
      readOnly: true,
      description: 'A friend’s referral code was used on this checkout; the friend was sent a thank-you code.',
      hidden: ({ value }) => !value,
      fields: [
        defineField({ name: 'code', title: 'Code used', type: 'string' }),
        defineField({ name: 'referrerEmail', title: 'Referrer email', type: 'string' }),
        defineField({ name: 'referrerOrder', title: 'Referrer’s order', type: 'string' }),
        defineField({ name: 'rewardCode', title: 'Thank-you code sent', type: 'string' }),
      ],
    }),
    defineField({
      name: 'referralError',
      title: 'Referral reward problem',
      type: 'string',
      readOnly: true,
      hidden: ({ value }) => !value,
    }),
    defineField({
      name: 'printfulShipments',
      title: 'Printful packages',
      type: 'array',
      readOnly: true,
      description: 'One entry per Printful package (an order can ship in several). The tracking fields above show the latest.',
      hidden: ({ value }) => !value || !value.length,
      of: [
        defineArrayMember({
          name: 'printfulShipment',
          title: 'Package',
          type: 'object',
          fields: [
            defineField({ name: 'carrier', title: 'Carrier', type: 'string' }),
            defineField({ name: 'trackingNumber', title: 'Tracking number', type: 'string' }),
            defineField({ name: 'trackingUrl', title: 'Tracking URL', type: 'string' }),
            defineField({ name: 'shippedAt', title: 'Shipped at', type: 'datetime' }),
          ],
          preview: { select: { title: 'trackingNumber', subtitle: 'carrier' } },
        }),
      ],
    }),
  ];
}
