// sanity/actions/CreateReturnAction.tsx
//
// "Create return (free label)", on an order with wall art. Only in a Studio
// built with shipping on (lib/shipping-flag.mjs).
//
// For a faulty, damaged or wrong item: the returns policy asks the customer to
// contact us first, so Alan raises the return himself once he has agreed it.
// It starts with every wall-art line on the order (remove what is not coming
// back), ticked as a free label, and opens it. Approving it then sends the
// label exactly as a customer's request does, with no postage deducted.
// Merchandise is left off: Printful handles faulty merchandise.
//
// Created at returnRequest.<ref>, a dotted id like every customer document.

import { useState } from 'react';
import { useToast } from '@sanity/ui';
import { useClient, type DocumentActionComponent } from 'sanity';
import { useRouter } from 'sanity/router';
import { returnBandFor, isWallArtLine, formatKeyOf, sizeKeyOf } from '../../netlify/functions/_shared/parcel-plan.mjs';
import { orderRefFor } from '../../netlify/functions/_shared/order-ref.mjs';

const randomRef = () => {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return `ret-${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
};

export const CreateReturnAction: DocumentActionComponent = (props) => {
  const client = useClient({ apiVersion: '2026-04-14' });
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const order = props.published as any;
  if (!order || !order.hasInhouse) return null;

  return {
    label: busy ? 'Creating return…' : 'Create return (free label)',
    title: 'For a faulty, damaged or wrong print: a return request with a free label, for you to check and approve.',
    disabled: busy,
    onHandle: async () => {
      setBusy(true);
      try {
        const lines = (order.items || []).filter(isWallArtLine).map((l: any) => {
          const qty = Math.max(1, Math.floor(Number(l.quantity) || 1));
          return {
            _key: l._key, _type: 'returnLine', lineKey: l._key, title: l.title, format: l.colour || '', size: l.size || '',
            fulfilment: 'inhouse', formatKey: formatKeyOf(l) || undefined, sizeKey: sizeKeyOf(l) || undefined,
            quantity: qty, unitPrice: Math.round(((Number(l.price) || 0) / qty) * 100) / 100,
          };
        });
        const count = await client.fetch('count(*[_type == "returnRequest" && orderId == $id])', { id: order._id });
        const ref = randomRef();
        const orderNumber = orderRefFor(order) || order._id;
        const band = returnBandFor(lines);
        const doc = {
          _id: `returnRequest.${ref}`,
          _type: 'returnRequest',
          returnRef: ref,
          returnNumber: `${orderNumber}-R${count + 1}`,
          source: 'studio',
          order: { _type: 'reference', _ref: order._id, _weak: true },
          orderId: order._id,
          orderNumber,
          customerName: order.customerName || '',
          customerEmail: order.customerEmail,
          lines,
          reason: 'faulty_or_wrong',
          reasonLabel: 'Faulty, damaged or wrong item (raised by us)',
          status: 'requested',
          freeLabel: true,
          ...(band ? { band } : {}),
          ...(order.shipmentResult?.deliveredAt ? { deliveredAt: order.shipmentResult.deliveredAt } : {}),
          deliveryDateUnknown: false,
          requestedAt: new Date().toISOString(),
        };
        await client.create(doc);
        toast.push({ status: 'success', title: `Return ${doc.returnNumber} created`, description: 'Check the items and band, then approve it.' });
        props.onComplete();
        router.navigateIntent('edit', { id: doc._id, type: 'returnRequest' });
      } catch (err: any) {
        toast.push({ status: 'error', title: 'Return not created', description: err?.message || String(err) });
      } finally {
        setBusy(false);
      }
    },
  };
};
