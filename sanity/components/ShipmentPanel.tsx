// sanity/components/ShipmentPanel.tsx
//
// The wall-art parcels on an order, each with its "Print label" button.
//
// The button opens the signed, 30-day link the server stored on the parcel
// (shipmentResult.parcels[].labelUrl -> /api/shipping-label), which proxies
// the PDF from the shipping service -- the Studio never holds the shipping
// secret. Stores nothing; drawn from shipmentResult, which only the server
// writes. An expired link says how to re-issue it (On hold -> Ready to ship).

import { Box, Button, Card, Flex, Stack, Text } from '@sanity/ui';
import { useFormValue } from 'sanity';

type Parcel = {
  _key?: string; parcelRef?: string; band?: string; carrier?: string; option?: string; extraWeightG?: number;
  quotedPrice?: number; trackingNumber?: string; trackingUrl?: string; labelId?: string; labelUrl?: string;
  status?: string; statusText?: string; test?: boolean;
};

const STATUS: Record<string, string> = {
  label_created: 'Label created',
  pre_transit: 'Label created',
  in_transit: 'In transit',
  ready_to_collect: 'Awaiting pickup',
  delivered: 'Delivered',
  exception: '⚠ Exception',
  returned_to_sender: '⚠ Returned to sender',
};

export function ShipmentPanel() {
  const result = (useFormValue(['shipmentResult']) as any) || {};
  const parcels: Parcel[] = Array.isArray(result.parcels) ? result.parcels : [];
  const expiresAt = Date.parse(result.labelLinksExpireAt || '');
  const expired = Number.isFinite(expiresAt) && expiresAt <= Date.now();

  return (
    <Stack space={3}>
      {result.international ? (
        <Card padding={3} radius={2} tone="caution">
          <Text size={1}>Delivery is outside the UK: Sendcloud is UK-only for now. Dispatch by hand: set In-house Status to Dispatched with the wall-art carrier and tracking number, and the customer is emailed once.</Text>
        </Card>
      ) : null}
      {result.planProblem ? (
        <Card padding={3} radius={2} tone="caution">
          <Text size={1} style={{ whiteSpace: 'pre-wrap' }}>Parcel plan needs a decision: {result.planProblem}</Text>
        </Card>
      ) : null}
      {result.state === 'exception' && result.error ? (
        <Card padding={3} radius={2} tone="critical">
          <Text size={1} style={{ whiteSpace: 'pre-wrap' }}>{result.error}</Text>
          <Box marginTop={2}><Text size={1} muted>Fix it, then set Shipment to “On hold” and back to “Ready to ship” to try again.</Text></Box>
        </Card>
      ) : null}
      {parcels.length && expired ? (
        <Card padding={3} radius={2} tone="caution">
          <Text size={1}>The print links have expired. Set Shipment to “On hold”, publish, then “Ready to ship” and publish to get new ones.</Text>
        </Card>
      ) : null}
      {parcels.length === 0 ? (
        <Card padding={3} radius={2} tone="transparent">
          <Text size={1} muted>No labels yet. Check the parcel plan below, then set Shipment to “Ready to ship” and publish.</Text>
        </Card>
      ) : parcels.map((p, i) => (
        <Card key={p._key || i} padding={3} radius={2} shadow={1}>
          <Flex align="center" gap={3} wrap="wrap">
            <Box flex={1}>
              <Text size={2} weight="semibold">Parcel {p.parcelRef} · {p.band}{p.extraWeightG ? ` · +${p.extraWeightG} g` : ''}{p.test ? ' · TEST' : ''}</Text>
              <Box marginTop={2}>
                <Text size={1} muted>
                  {[p.carrier, p.option, p.quotedPrice != null ? `£${Number(p.quotedPrice).toFixed(2)}` : null,
                    STATUS[p.status || ''] || p.statusText || p.status].filter(Boolean).join(' · ')}
                </Text>
              </Box>
              {p.trackingNumber || p.trackingUrl ? (
                <Box marginTop={2}>
                  <Text size={1}>
                    {p.trackingUrl ? <a href={p.trackingUrl} target="_blank" rel="noreferrer">{p.trackingNumber || 'Tracking'}</a> : p.trackingNumber}
                  </Text>
                </Box>
              ) : null}
            </Box>
            {p.labelUrl ? (
              <Button
                as="a"
                href={p.labelUrl}
                target="_blank"
                rel="noreferrer"
                text={expired ? 'Print label (link expired)' : 'Print label'}
                tone={expired ? 'caution' : 'primary'}
                mode="ghost"
                disabled={expired}
              />
            ) : null}
          </Flex>
        </Card>
      ))}
    </Stack>
  );
}
