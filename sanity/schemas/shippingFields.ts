// sanity/schemas/shippingFields.ts
//
// The wall-art dispatch and Sendcloud fields on an order (wall art only:
// Printful ships everything else and owns the order's status, carrier,
// trackingNumber, trackingUrl and shippedAt).
//
// wallArtDispatchFields() always shows on orders with wall art: setting
// In-house Status to Dispatched with a wall-art tracking number emails the
// customer once, Sendcloud or not. shippingFields() is the Sendcloud part,
// hidden unless the Studio was built with SANITY_STUDIO_SHIPPING_ENABLED=true
// (lib/shipping-flag), and only on orders with wall art.
//
// Shared: this file, returnRequest.ts, components/ShipmentPanel.tsx,
// actions/CreateReturnAction.tsx and lib/shipping-flag.mjs are the same in
// The Fuglys, Labrats, Cats On Crack and The Biker Babies.
//
// WHO OWNS WHAT (server-patch.mjs in the functions):
//   shipment.status, parcelPlan   Alan's. He edits them; the server never does
//                                 (bar writing the default plan into an empty one).
//   shipmentResult                The server's: labels, print links, tracking,
//                                 events, errors. Read-only here. The server
//                                 writes it to the draft as well as the
//                                 published document, so publishing a draft
//                                 never undoes it.

import { defineField } from 'sanity';
import { SHIPPING_UI } from '../lib/shipping-flag.mjs';
import { ALL_BANDS, BAND_TITLES, CARRIER_OPTIONS } from '../../netlify/functions/_shared/parcel-plan.mjs';
import { ShipmentPanel } from '../components/ShipmentPanel';

const BAND_OPTIONS = (ALL_BANDS as string[]).map((b) => ({ title: (BAND_TITLES as Record<string, string>)[b] || b, value: b }));
const noWallArt = (document: any) => !document?.hasInhouse;

export const SHIPMENT_SWITCH = [
  { title: 'Not ready', value: 'not_ready' },
  { title: 'Ready to ship (buys the labels)', value: 'ready_to_ship' },
  { title: 'On hold', value: 'on_hold' },
];

export const RESULT_STATES = [
  { title: 'Label created', value: 'label_created' },
  { title: 'In transit', value: 'in_transit' },
  { title: 'Delivered', value: 'delivered' },
  { title: 'Exception', value: 'exception' },
  { title: 'Returned to sender', value: 'returned_to_sender' },
];

/** The hand-dispatch fields: always shown on wall-art orders. */
export function wallArtDispatchFields() {
  return [
    defineField({
      name: 'wallArtCarrier', title: 'Wall-art carrier', type: 'string',
      hidden: ({ document }) => noWallArt(document),
      options: { list: CARRIER_OPTIONS as { title: string; value: string }[] },
      description: 'Wall art only: Printful writes its own carrier and tracking above. Filled in automatically for Sendcloud labels.',
    }),
    defineField({
      name: 'wallArtCarrierOther', title: 'Wall-art carrier name (Other)', type: 'string',
      hidden: ({ document }) => noWallArt(document) || document?.wallArtCarrier !== 'other',
    }),
    defineField({
      name: 'wallArtTrackingNumber', title: 'Wall-art tracking number', type: 'string',
      hidden: ({ document }) => noWallArt(document),
      description: 'Set In-house Status to Dispatched with a wall-art tracking number and publish: the customer is emailed once, listing the wall art only.',
    }),
    defineField({
      name: 'dispatchEmailSentAt', title: 'Wall-art dispatch email sent', type: 'datetime', readOnly: true,
      hidden: ({ value }) => !value,
    }),
    defineField({ name: 'dispatchEmailClaimedAt', title: 'Dispatch email claimed', type: 'datetime', readOnly: true, hidden: true }),
  ];
}

export function shippingFields() {
  return [
    defineField({
      name: 'shipmentLabels',
      title: 'Wall-art shipment — labels',
      type: 'string',
      readOnly: true,
      hidden: ({ document }) => !SHIPPING_UI || noWallArt(document),
      components: { field: ShipmentPanel as any },
    }),
    defineField({
      name: 'shipment',
      title: 'Wall-art shipment (Sendcloud)',
      type: 'object',
      hidden: ({ document }) => !SHIPPING_UI || noWallArt(document),
      fields: [
        {
          name: 'status',
          title: 'Shipment',
          type: 'string',
          options: { list: SHIPMENT_SWITCH, layout: 'radio' },
          initialValue: 'not_ready',
          description:
            'Set "Ready to ship" and publish to buy one label per parcel in the plan below. The team is emailed the print links; '
            + 'the customer is emailed when the carrier first scans it. After an exception, or when the print links have expired, '
            + 'set "On hold", publish, then "Ready to ship" again: labels already bought are never bought twice.',
        },
      ],
    }),
    defineField({
      name: 'parcelPlan',
      title: 'Parcel plan (wall art)',
      type: 'array',
      hidden: ({ document }) => !SHIPPING_UI || noWallArt(document),
      description:
        'Proposed when the order arrives: every poster in one tube at the largest poster\'s band (a lone 12x8 flat), each canvas on its own. '
        + 'Edit before setting "Ready to ship". Extra weight is added to the band\'s weight on the label (posters after the first in a tube).',
      of: [{
        type: 'object',
        name: 'plannedParcel',
        fields: [
          { name: 'parcelRef', type: 'string', title: 'Parcel ref', description: '1, 2, 3… unique here. Never reuse a ref that already has a label for a different box.' },
          { name: 'band', type: 'string', title: 'Band', options: { list: BAND_OPTIONS } },
          { name: 'extraWeightG', type: 'number', title: 'Extra weight (g)', description: 'Added to the band weight. Posters after the first × POSTER_EXTRA_WEIGHT_G.' },
          {
            name: 'items',
            title: 'Contents',
            type: 'array',
            of: [{
              type: 'object',
              name: 'plannedItem',
              fields: [
                { name: 'title', type: 'string', title: 'Item', readOnly: true },
                { name: 'lineKey', type: 'string', title: 'Line key', description: 'Which order line. Copy an item from one parcel and paste it into another to combine them.' },
                { name: 'quantity', type: 'number', title: 'Quantity', initialValue: 1 },
              ],
              preview: {
                select: { title: 'title', line: 'lineKey', qty: 'quantity' },
                prepare: ({ title, line, qty }: any) => ({ title: `${title || line || '?'} × ${qty || 1}` }),
              },
            }],
          },
        ],
        preview: {
          select: { ref: 'parcelRef', band: 'band', items: 'items', extra: 'extraWeightG' },
          prepare: ({ ref, band, items, extra }: any) => ({
            title: `Parcel ${ref || '?'} · ${band || '⚠ no band'}${extra ? ` · +${extra} g` : ''}`,
            subtitle: (items || []).map((i: any) => `${i.title || i.lineKey} × ${i.quantity || 1}`).join(', '),
          }),
        },
      }],
    }),
    defineField({
      name: 'shipmentResult',
      title: 'Wall-art shipment result (written by the server)',
      type: 'object',
      readOnly: true,
      hidden: ({ document }) => !SHIPPING_UI || noWallArt(document),
      options: { collapsible: true, collapsed: true },
      fields: [
        { name: 'state', title: 'State', type: 'string', options: { list: RESULT_STATES } },
        { name: 'planProblem', title: 'Plan problem', type: 'text', rows: 2 },
        { name: 'international', title: 'Outside the UK: dispatch by hand', type: 'boolean' },
        { name: 'error', title: 'Last error', type: 'text', rows: 3 },
        { name: 'exceptionAt', title: 'Last exception', type: 'datetime' },
        { name: 'planProposedAt', title: 'Plan proposed', type: 'datetime' },
        { name: 'labelCreatedAt', title: 'Labels created', type: 'datetime' },
        { name: 'labelLinksExpireAt', title: 'Print links expire', type: 'datetime' },
        { name: 'dispatchedAt', title: 'First carrier scan', type: 'datetime' },
        { name: 'deliveredAt', title: 'Delivered', type: 'datetime' },
        {
          name: 'parcels',
          title: 'Parcels',
          type: 'array',
          of: [{
            type: 'object',
            name: 'shipmentParcel',
            fields: [
              { name: 'parcelRef', type: 'string', title: 'Parcel' },
              { name: 'band', type: 'string', title: 'Band' },
              { name: 'extraWeightG', type: 'number', title: 'Extra weight (g)' },
              { name: 'parcelId', type: 'string', title: 'Sendcloud parcel id' },
              { name: 'shipmentId', type: 'string', title: 'Sendcloud shipment id' },
              { name: 'carrier', type: 'string', title: 'Carrier' },
              { name: 'option', type: 'string', title: 'Shipping option' },
              { name: 'quotedPrice', type: 'number', title: 'Quoted price (£)' },
              { name: 'trackingNumber', type: 'string', title: 'Tracking number' },
              { name: 'trackingUrl', type: 'url', title: 'Tracking link' },
              { name: 'labelId', type: 'string', title: 'Label id' },
              { name: 'labelUrl', type: 'url', title: 'Print link (signed, 30 days)' },
              { name: 'status', type: 'string', title: 'Status' },
              { name: 'statusText', type: 'string', title: 'Carrier status' },
              { name: 'test', type: 'boolean', title: 'Test label' },
            ],
            preview: {
              select: { ref: 'parcelRef', band: 'band', carrier: 'carrier', status: 'status', tracking: 'trackingNumber' },
              prepare: ({ ref, band, carrier, status, tracking }: any) => ({
                title: `Parcel ${ref} · ${band || '?'}`,
                subtitle: [carrier, status, tracking].filter(Boolean).join(' · '),
              }),
            },
          }],
        },
        {
          name: 'events',
          title: 'Tracking events (newest 30)',
          type: 'array',
          of: [{
            type: 'object',
            name: 'shipmentEvent',
            fields: [
              { name: 'at', type: 'datetime', title: 'At' },
              { name: 'parcelRef', type: 'string', title: 'Parcel' },
              { name: 'status', type: 'string', title: 'Status' },
              { name: 'statusCode', type: 'number', title: 'Code' },
              { name: 'carrierStatus', type: 'string', title: 'Carrier says' },
              { name: 'kind', type: 'string', title: 'Meaning' },
              { name: 'test', type: 'boolean', title: 'Test' },
            ],
            preview: {
              select: { at: 'at', parcel: 'parcelRef', status: 'status', kind: 'kind' },
              prepare: ({ at, parcel, status, kind }: any) => ({
                title: `${status || kind || 'Event'}${parcel ? ` — parcel ${parcel}` : ''}`,
                subtitle: at ? new Date(at).toLocaleString('en-GB') : '',
              }),
            },
          }],
        },
        { name: 'dispatchClaimedAt', title: 'Dispatch claimed', type: 'datetime', hidden: true },
      ],
    }),
  ];
}
