/**
 * Printful's events on an order, written the way every other server write
 * is: through server-patch.mjs, so the published order AND an open draft get
 * the same values, and publishing that draft never rolls Printful's tracking
 * back.
 *
 * Shared by the four printful-webhook.mjs files (identical here; each
 * webhook keeps only its own "It's shipped" email template).
 *
 * MULTI-PACKAGE. Printful sends one package_shipped per package. Every
 * package is recorded in printfulShipments (one entry per Printful shipment
 * id, or tracking number), and the order's carrier / trackingNumber /
 * trackingUrl / shippedAt show the latest. The write is readDecideWrite:
 * when two packages arrive together and one write lands first, the other
 * re-reads and writes again, so neither package's tracking or email is
 * dropped (before, the loser of the 409 gave up). A repeat of a package
 * already recorded writes nothing and sends nothing.
 *
 * Printful owns status, carrier, trackingNumber, trackingUrl, shippedAt,
 * failureReason and printfulShipments. The shipping code never writes them.
 */
import { readDecideWrite } from './server-patch.mjs';

/** The order a Printful event is about: by printfulOrderId, then by external_id (order.<key> / order-<key>). */
export async function findPrintfulOrder(sanity, printfulOrderId, externalId) {
  if (printfulOrderId != null && printfulOrderId !== '') {
    const byId = await sanity.fetch(
      '*[_type == "order" && printfulOrderId == $pid && !(_id in path("drafts.**"))][0]{ _id, orderRef }',
      { pid: String(printfulOrderId) },
    );
    if (byId) return byId;
  }
  if (externalId) {
    const key = String(externalId);
    return (await sanity.fetch('*[_type == "order" && _id in [$a, $b]][0]{ _id, orderRef }', { a: `order.${key}`, b: `order-${key}` })) || null;
  }
  return null;
}

/** Printful sends shipped_at as a unix timestamp (seconds); fall back to now. */
export function shippedAtIso(shipment, now = Date.now()) {
  const t = Number(shipment?.shipped_at);
  return Number.isFinite(t) && t > 0 ? new Date(t * 1000).toISOString() : new Date(now).toISOString();
}

/** What identifies one Printful package: its shipment id, else its tracking number. */
export const shipmentKey = (shipment) =>
  (shipment?.id != null && shipment.id !== '' ? `pf${shipment.id}` : `tn${String(shipment?.tracking_number || '')}`).replace(/[^A-Za-z0-9_-]/g, '');

/** The packages recorded so far, including the one an older order kept in its single tracking fields. */
export function recordedShipments(order) {
  const list = Array.isArray(order?.printfulShipments) ? order.printfulShipments : [];
  if (list.length || order?.status !== 'shipped' || !order?.trackingNumber) return list;
  // Shipped before printfulShipments existed: keep that package in the list.
  return [{
    _key: shipmentKey({ tracking_number: order.trackingNumber }), _type: 'printfulShipment',
    carrier: order.carrier || '', trackingNumber: order.trackingNumber, trackingUrl: order.trackingUrl || '',
    ...(order.shippedAt ? { shippedAt: order.shippedAt } : {}),
  }];
}

/** Has this package already been recorded on the order (same shipment id, or same tracking number)? */
export function alreadyRecorded(order, shipment) {
  const key = shipmentKey(shipment);
  const tn = String(shipment?.tracking_number || '');
  const list = recordedShipments(order);
  if (list.some((s) => s?._key === key || (tn && s?.trackingNumber === tn))) return true;
  // An untracked package on an order already shipped untracked: the old repeat check.
  return !tn && !list.length && order?.status === 'shipped' && !order?.trackingNumber;
}

/**
 * Record a package_shipped.
 * @returns {Promise<{ written: boolean, order: object|null, reason?: string }>}
 *   order is the full order as read just before the write that landed.
 */
export async function recordShipped(sanity, id, shipment, { now = () => Date.now() } = {}) {
  let reason = null;
  const res = await readDecideWrite(sanity, id, (order) => {
    if (!order) { reason = 'order not found'; return null; }
    if (alreadyRecorded(order, shipment)) { reason = 'repeat event'; return null; }
    const entry = {
      _key: shipmentKey(shipment),
      _type: 'printfulShipment',
      carrier: String(shipment.carrier || ''),
      trackingNumber: String(shipment.tracking_number || ''),
      trackingUrl: String(shipment.tracking_url || ''),
      shippedAt: shippedAtIso(shipment, now()),
    };
    const list = recordedShipments(order);
    return {
      set: {
        status: 'shipped',
        carrier: entry.carrier,
        trackingNumber: entry.trackingNumber,
        trackingUrl: entry.trackingUrl,
        shippedAt: entry.shippedAt,
        printfulShipments: [...list, entry],
      },
    };
  });
  return { written: res.written, order: res.doc, reason: res.written ? undefined : (reason || 'nothing to do') };
}

/** Record an order_failed. Same shape as recordShipped. */
export async function recordFailed(sanity, id, reasonText) {
  let reason = null;
  const failureReason = String(reasonText || '');
  const res = await readDecideWrite(sanity, id, (order) => {
    if (!order) { reason = 'order not found'; return null; }
    if (order.status === 'fulfilment-failed' && (order.failureReason || '') === failureReason) { reason = 'repeat event'; return null; }
    return { set: { status: 'fulfilment-failed', failureReason } };
  });
  return { written: res.written, order: res.doc, reason: res.written ? undefined : (reason || 'nothing to do') };
}
