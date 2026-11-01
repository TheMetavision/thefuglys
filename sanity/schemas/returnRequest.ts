import { defineType, defineField } from 'sanity';
import { ALL_BANDS, BAND_TITLES } from '../../netlify/functions/_shared/parcel-plan.mjs';

/**
 * returnRequest
 * --------------------------------------------------------------------------
 * A customer's return (wall art; merchandise too once RETURNS_CLOTHING is on),
 * made by the /returns page (netlify/functions/_shared/returns-api.mjs), or a
 * free-label return for a faulty or wrong print, made by Alan from the
 * order's "Create return" button. Only in a Studio built with shipping on.
 *
 * Stored at returnRequest.<ref> -- a dotted id, so anonymous reads never see
 * it. The Studio's own "new document" is switched off for this type
 * (sanity.config.js), because it would make a random, public id.
 *
 * Alan's part is the decision: status (Approved / Rejected), the parcel band,
 * the free-label flag, which lines, the rejection reason and his notes. The
 * server writes everything else, to the draft as well as the published
 * document (server-patch.mjs), so publishing never undoes it.
 *
 *   Approved  -> the label is bought and emailed (Label sent)
 *   Rejected  -> the customer is emailed the reason written here
 *   then tracking moves it to In transit / Ready to collect; Received and
 *   Refunded are Alan's. Refunds are made by hand in Stripe, less
 *   postageDeduction unless it is a free label.
 */
const STATUSES = [
  { title: 'Requested', value: 'requested' },
  { title: 'Approved (sends the label)', value: 'approved' },
  { title: 'Rejected (emails the reason)', value: 'rejected' },
  { title: 'Label sent', value: 'label_sent' },
  { title: 'In transit', value: 'in_transit' },
  { title: 'Ready to collect', value: 'ready_to_collect' },
  { title: 'Received', value: 'received' },
  { title: 'Refunded', value: 'refunded' },
];
const STATUS_TITLE: Record<string, string> = Object.fromEntries(STATUSES.map((s) => [s.value, s.title.replace(/ \(.*\)$/, '')]));

export default defineType({
  name: 'returnRequest',
  title: 'Return Request',
  type: 'document',
  fields: [
    defineField({ name: 'returnNumber', title: 'Return', type: 'string', readOnly: true }),
    defineField({
      name: 'status',
      title: 'Status',
      type: 'string',
      options: { list: STATUSES, layout: 'radio' },
      initialValue: 'requested',
      description: 'Approve to buy the return label and email it to the customer. Reject to email them the reason below. After a problem (see below), set Requested, publish, then Approved again.',
      validation: (Rule) => Rule.custom((status, ctx) => {
        const doc = ctx.document as any;
        if (status === 'rejected' && !String(doc?.rejectionReason || '').trim()) {
          return 'Write the reason for rejecting: the customer is emailed it.';
        }
        if (status === 'approved' && !doc?.band) return 'Choose the parcel band before approving.';
        return true;
      }),
    }),
    defineField({
      name: 'freeLabel',
      title: 'Faulty / wrong item — free label',
      type: 'boolean',
      initialValue: false,
      description: 'Ticked: no postage is deducted and the email says the label is free. For a faulty, damaged or wrong item.',
    }),
    defineField({
      name: 'band',
      title: 'Parcel band',
      type: 'string',
      options: { list: (ALL_BANDS as string[]).map((b) => ({ title: (BAND_TITLES as Record<string, string>)[b] || b, value: b })) },
      description: 'Filled in when it is clear (posters in one tube, one canvas, one merchandise item). For a mix in one box, choose it. Merchandise: X1 mailer, X2 bulky box.',
    }),
    defineField({
      name: 'rejectionReason',
      title: 'Reason for rejecting',
      type: 'text',
      rows: 3,
      description: 'Sent to the customer word for word if you reject.',
    }),
    defineField({ name: 'alanNotes', title: 'Notes (internal)', type: 'text', rows: 3 }),
    defineField({
      name: 'postageDeduction',
      title: 'Deduct from refund (£)',
      type: 'number',
      readOnly: true,
      description: 'The price the shipping service quoted when it bought the label: the figure in the customer’s label email. 0 for a free label. Blank if the service gave no price (see Last problem). Take it off the refund in Stripe.',
    }),
    defineField({
      name: 'quotedPostage',
      title: 'Postage shown on /returns (£)',
      type: 'number',
      readOnly: true,
      hidden: ({ value }) => value == null,
      description: 'The live quote the customer saw before submitting. The deduction is the price at the moment the label is bought, above.',
    }),
    defineField({ name: 'error', title: '⚠ Last problem', type: 'text', rows: 3, readOnly: true, hidden: ({ value }) => !value }),
    defineField({
      name: 'deliveryDateUnknown',
      title: '⚠ Delivery date unknown',
      type: 'boolean',
      readOnly: true,
      hidden: ({ value }) => !value,
      description: 'No recorded delivery (hand-dispatched wall art, or merchandise), so the 14-day window could not be checked. Judge it yourself.',
    }),
    defineField({ name: 'deliveredAt', title: 'Delivered', type: 'datetime', readOnly: true, hidden: ({ value }) => !value }),
    defineField({
      name: 'underwear', title: '⚠ Underwear', type: 'boolean', readOnly: true, hidden: ({ value }) => !value,
      description: '14 days from delivery; a deduction is allowed if it has been worn or washed (returns policy).',
    }),
    defineField({ name: 'testOrder', title: 'Test order (Stripe test mode)', type: 'boolean', readOnly: true, hidden: ({ value }) => !value }),
    defineField({ name: 'windowEndsOn', title: '14 days end', type: 'string', readOnly: true, hidden: ({ value }) => !value }),
    defineField({
      name: 'lines',
      title: 'Items',
      type: 'array',
      description: 'Remove any item that is not coming back.',
      of: [{
        type: 'object',
        name: 'returnLine',
        fields: [
          { name: 'title', type: 'string', title: 'Item', readOnly: true },
          { name: 'format', type: 'string', title: 'Format / colour', readOnly: true },
          { name: 'size', type: 'string', title: 'Size', readOnly: true },
          { name: 'quantity', type: 'number', title: 'Qty' },
          { name: 'unitPrice', type: 'number', title: 'Unit price (£)', readOnly: true },
          { name: 'fulfilment', type: 'string', title: 'Made by', readOnly: true, description: 'inhouse (wall art) or printful (merchandise)' },
          { name: 'lineKey', type: 'string', title: 'Order line', readOnly: true },
          { name: 'formatKey', type: 'string', title: 'Format key', readOnly: true, hidden: true },
          { name: 'sizeKey', type: 'string', title: 'Size key', readOnly: true, hidden: true },
        ],
        preview: {
          select: { title: 'title', format: 'format', size: 'size', qty: 'quantity' },
          prepare: ({ title, format, size, qty }: any) => ({ title: `${title} × ${qty || 1}`, subtitle: [format, size].filter(Boolean).join(' / ') }),
        },
      }],
    }),
    defineField({ name: 'reasonLabel', title: 'Reason', type: 'string', readOnly: true }),
    defineField({ name: 'customerNotes', title: 'Customer notes', type: 'text', rows: 3, readOnly: true }),
    defineField({ name: 'order', title: 'Order', type: 'reference', to: [{ type: 'order' }], weak: true, readOnly: true }),
    defineField({ name: 'orderNumber', title: 'Order reference', type: 'string', readOnly: true }),
    defineField({ name: 'customerName', title: 'Customer', type: 'string', readOnly: true }),
    defineField({ name: 'customerEmail', title: 'Customer email', type: 'string', readOnly: true }),
    defineField({ name: 'carrier', title: 'Carrier', type: 'string', readOnly: true }),
    defineField({ name: 'option', title: 'Shipping option', type: 'string', readOnly: true }),
    defineField({ name: 'quotedPrice', title: 'Label quoted price (£)', type: 'number', readOnly: true }),
    defineField({ name: 'trackingNumber', title: 'Tracking number', type: 'string', readOnly: true }),
    defineField({ name: 'trackingUrl', title: 'Tracking link', type: 'url', readOnly: true }),
    defineField({ name: 'labelId', title: 'Label id', type: 'string', readOnly: true }),
    defineField({ name: 'parcelId', title: 'Sendcloud parcel id', type: 'string', readOnly: true }),
    defineField({ name: 'customerInstructions', title: 'Instructions sent to the customer', type: 'text', rows: 3, readOnly: true }),
    defineField({ name: 'test', title: 'Test label', type: 'boolean', readOnly: true, hidden: ({ value }) => !value }),
    defineField({ name: 'requestedAt', title: 'Requested', type: 'datetime', readOnly: true }),
    defineField({ name: 'labelSentAt', title: 'Label emailed', type: 'datetime', readOnly: true }),
    defineField({ name: 'rejectionEmailSentAt', title: 'Decline emailed', type: 'datetime', readOnly: true }),
    defineField({ name: 'readyToCollectAt', title: 'Ready to collect', type: 'datetime', readOnly: true }),
    defineField({ name: 'receivedAt', title: 'Received', type: 'datetime', readOnly: true }),
    defineField({
      name: 'events',
      title: 'Tracking events (newest 30)',
      type: 'array',
      readOnly: true,
      of: [{
        type: 'object',
        name: 'shipmentEvent',
        fields: [
          { name: 'at', type: 'datetime', title: 'At' },
          { name: 'status', type: 'string', title: 'Status' },
          { name: 'statusCode', type: 'number', title: 'Code' },
          { name: 'carrierStatus', type: 'string', title: 'Carrier says' },
          { name: 'kind', type: 'string', title: 'Meaning' },
          { name: 'test', type: 'boolean', title: 'Test' },
        ],
      }],
    }),
    defineField({ name: 'source', title: 'Made by', type: 'string', readOnly: true, description: 'customer (the /returns page) or studio (Create return on the order).' }),
    defineField({ name: 'returnRef', title: 'Service reference', type: 'string', readOnly: true }),
    defineField({ name: 'orderId', title: 'Order id', type: 'string', readOnly: true, hidden: true }),
    defineField({ name: 'reason', title: 'Reason key', type: 'string', readOnly: true, hidden: true }),
    defineField({ name: 'errorAt', title: 'Last problem at', type: 'datetime', readOnly: true, hidden: true }),
    defineField({ name: 'claimedAt', title: 'Claimed', type: 'datetime', readOnly: true, hidden: true }),
  ],
  preview: {
    select: { n: 'returnNumber', name: 'customerName', status: 'status', free: 'freeLabel', unknown: 'deliveryDateUnknown' },
    prepare: ({ n, name, status, free, unknown }: any) => ({
      title: `${n || 'Return'} — ${name || ''}`,
      subtitle: [STATUS_TITLE[status] || status, free ? 'free label' : null, unknown ? '⚠ delivery date unknown' : null].filter(Boolean).join(' · '),
    }),
  },
  orderings: [{ title: 'Newest first', name: 'requestedDesc', by: [{ field: 'requestedAt', direction: 'desc' }] }],
});
