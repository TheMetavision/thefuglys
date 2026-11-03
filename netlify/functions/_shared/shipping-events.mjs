/**
 * What a tracking event from the shipping service does.
 *
 * metavision-shipping forwards each Sendcloud status change for one of our
 * parcels to /api/shipping-event (shipping-event.mts), signed with
 * SHIPPING_SECRET. It wants a 2xx within 4 seconds; anything else is queued
 * and retried hourly, so every step here is safe to repeat.
 *
 * Only wall art is ever on a Sendcloud label, so none of this touches the
 * Printful side of an order (status, carrier, trackingNumber, trackingUrl,
 * shippedAt, printfulOrderId) or Printful's emails.
 *
 * Outbound parcel ("kind": "parcel"), matched by orderRef (the order's
 * 8-character orderRef, with or without "#") and parcelRef:
 *   - the event is appended to shipmentResult.events (newest 30; a repeat of
 *     the same parcel + status + time is recognised and not added twice);
 *   - first carrier scan: shipmentResult.dispatchedAt and state in_transit;
 *     In-house Status moves to Dispatched, and the wall-art tracking number
 *     and carrier (wallArtTrackingNumber, wallArtCarrier) are filled in if
 *     Alan left them empty, so the existing Studio views read right; then the wall-art dispatch email, ONCE (dispatch-email.mjs
 *     claims the order first);
 *   - every parcel delivered: shipmentResult.deliveredAt (the 14-day return
 *     window counts from it), state delivered;
 *   - exception / returned to sender: the team is emailed.
 *
 * Return ("kind": "return", matched by returnRef): the return request's
 * events, In transit, and Ready to collect when it reaches Alan's collection
 * point, with an email to the team saying which point.
 *
 * All writes go through server-patch.mjs (published + draft).
 */
import { createHash } from 'node:crypto';
import { classifyStatus, isCarrierScan } from './tracking-status.mjs';
import { mapCarrier } from './parcel-plan.mjs';
import { sendDispatchEmail } from './dispatch-email.mjs';
import { readDecideWrite } from './server-patch.mjs';
import { orderRefFor, normaliseOrderRef } from './order-ref.mjs';
import { sendEmail, parcelAlertEmail, returnReadyEmail, returnAlertEmail } from './shipping-emails.mjs';

const EVENT_CAP = 30;

/** The same event delivered twice has the same key. */
export const eventKey = (e) => createHash('sha256')
  .update([e.kind, e.parcelRef ?? e.returnRef ?? '', e.parcelId ?? '', e.statusCode ?? '', e.status ?? '', e.at ?? ''].join('|'))
  .digest('hex').slice(0, 16);

function eventRecord(e, kind) {
  return {
    _key: eventKey(e),
    _type: 'shipmentEvent',
    at: e.at || new Date().toISOString(),
    ...(e.parcelRef != null ? { parcelRef: String(e.parcelRef) } : {}),
    status: e.status || undefined,
    statusCode: e.statusCode != null ? Number(e.statusCode) : undefined,
    carrierStatus: e.carrierStatus || undefined,
    kind,
    ...(e.test ? { test: true } : {}),
  };
}

/** Newest EVENT_CAP, oldest first. */
const capped = (events) => [...events].sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(-EVENT_CAP);

/**
 * Which order an outbound event belongs to. orderRef is 8 characters of a
 * session id, so in the (vanishingly rare) case two orders share it, the one
 * with labels wins, then the newest.
 */
export async function findShipmentDoc(sanity, orderRef) {
  const ref = normaliseOrderRef(orderRef);
  if (!ref) return null;
  const rows = await sanity.fetch(
    '*[_type == "order" && orderRef == $r && !(_id in path("drafts.**"))]{ _id, placedAt, "labelled": count(shipmentResult.parcels) > 0 } | order(placedAt desc)[0...5]',
    { r: ref },
  );
  const pick = (rows || []).find((r) => r.labelled) || (rows || [])[0];
  return pick ? { id: pick._id } : null;
}

/* ------------------------------------------------------------------ parcels */

/** The decision for one event against one order. Pure, so the table is testable. */
export function parcelEventPatch(doc, event, { now = Date.now() } = {}) {
  const kind = classifyStatus(event.statusCode, event.status);
  const rec = eventRecord(event, kind);
  const result = doc.shipmentResult || {};
  const events = Array.isArray(result.events) ? result.events : [];
  const effects = { kind, duplicate: false, firstScan: false, alert: false, delivered: false, dispatched: Boolean(result.dispatchedAt), parcel: null };
  if (events.some((x) => x._key === rec._key)) return { effects: { ...effects, duplicate: true }, set: null };

  const parcels = (result.parcels || []).map((p) => ({ ...p }));
  const parcel = parcels.find((p) => String(p.parcelRef) === String(event.parcelRef))
    || parcels.find((p) => event.parcelId != null && String(p.parcelId) === String(event.parcelId));
  if (parcel) {
    parcel.status = kind;
    parcel.statusText = event.status || undefined;
    if (event.trackingNumber) parcel.trackingNumber = event.trackingNumber;
    if (event.trackingUrl) parcel.trackingUrl = event.trackingUrl;
  }
  effects.parcel = parcel || null;

  const iso = new Date(now).toISOString();
  const set = { 'shipmentResult.events': capped([...events, rec]), 'shipmentResult.parcels': parcels };

  if (isCarrierScan(kind) && !result.dispatchedAt) {
    effects.firstScan = true;
    effects.dispatched = true;
    set['shipmentResult.dispatchedAt'] = iso;
    if (!result.state || result.state === 'label_created') set['shipmentResult.state'] = 'in_transit';
    const tracked = parcel?.trackingNumber ? parcel : parcels.find((p) => p.trackingNumber);
    // In-house Status is Alan's field, but "Dispatched" here is the server
    // reporting what the carrier saw; serverPatch writes the draft too.
    if (doc.inhouseStatus !== 'dispatched') set.inhouseStatus = 'dispatched';
    // Never the order's carrier / trackingNumber: those are Printful's.
    if (!String(doc.wallArtTrackingNumber || '').trim() && tracked?.trackingNumber) set.wallArtTrackingNumber = tracked.trackingNumber;
    if (!doc.wallArtCarrier && (parcel || tracked)?.carrier) {
      const c = mapCarrier((parcel || tracked).carrier);
      set.wallArtCarrier = c.carrier;
      if (c.carrierOther) set.wallArtCarrierOther = c.carrierOther;
    }
  } else if (kind === 'in_transit' && result.state === 'label_created') {
    set['shipmentResult.state'] = 'in_transit';
  }

  if (kind === 'delivered') {
    const labelled = parcels.filter((p) => p.labelId);
    if (labelled.length && labelled.every((p) => p.status === 'delivered') && !result.deliveredAt) {
      effects.delivered = true;
      set['shipmentResult.deliveredAt'] = iso;
      set['shipmentResult.state'] = 'delivered';
    }
  }
  if (kind === 'exception' || kind === 'returned_to_sender') {
    effects.alert = true;
    set['shipmentResult.state'] = kind;
  }
  return { effects, set };
}

export async function applyParcelEvent(event, deps) {
  const { sanity, getResend, now = () => Date.now(), log = console, sendDispatch = sendDispatchEmail } = deps;
  const found = await findShipmentDoc(sanity, event.orderRef);
  if (!found) {
    log.warn(`shipping-event: no order ${event.orderRef} — ignored`);
    return { status: 200, body: 'Unknown order — ignored' };
  }
  let effects = null;
  const { doc } = await readDecideWrite(sanity, found.id, (d) => {
    const r = parcelEventPatch(d, event, { now: now() });
    effects = r.effects;
    return r.set ? { set: r.set } : null;
  });
  const ref = orderRefFor(doc) || doc._id;
  if (!effects.parcel && !effects.duplicate) log.warn(`shipping-event: ${ref} has no parcel ${event.parcelRef} on record; event kept`);

  const resend = getResend();
  if (effects.alert) {
    const who = { ref, id: doc._id, name: doc.customerName, email: doc.customerEmail, test: doc.test === true };
    const sent = await sendEmail(resend, parcelAlertEmail(who, effects.parcel, event, effects.kind));
    if (!sent.ok) log.error(`shipping-event: ${ref} alert email not sent: ${sent.error}`);
  }

  /* Due once a carrier has the parcel. Checked on EVERY event, not only the
     first scan, so an email that failed is sent by the next event to arrive;
     dispatch-email.mjs makes it once only. */
  let emailed = null;
  if (effects.dispatched && !doc.dispatchEmailSentAt) {
    emailed = await sendDispatch({ id: found.id, sanity, getResend, log });
  }
  log.log(`shipping-event: ${ref} parcel ${event.parcelRef} ${event.statusCode} ${effects.kind}`
    + `${effects.duplicate ? ' (repeat)' : ''}${effects.firstScan ? ' first scan' : ''}${effects.delivered ? ' all delivered' : ''}`
    + `${emailed ? ` dispatch email: ${emailed.reason}` : ''}`);
  // A failed email is retried by the service only if we say so.
  if (emailed && emailed.status >= 500) return { status: 503, body: `Dispatch email not sent: ${emailed.reason}`, effects, emailed };
  return { status: 200, body: 'OK', effects, emailed };
}

/* ------------------------------------------------------------------ returns */

export function returnEventPatch(ret, event, { now = Date.now() } = {}) {
  const kind = classifyStatus(event.statusCode, event.status);
  const rec = eventRecord(event, kind);
  const events = Array.isArray(ret.events) ? ret.events : [];
  const effects = { kind, becameReady: false, alert: false };
  if (events.some((x) => x._key === rec._key)) return { effects, set: null };
  const iso = new Date(now).toISOString();
  const set = { events: capped([...events, rec]) };
  if (event.trackingNumber) set.trackingNumber = event.trackingNumber;
  if (event.trackingUrl) set.trackingUrl = event.trackingUrl;
  const s = ret.status;
  const before = ['approved', 'label_sent', 'in_transit'].includes(s);
  if (kind === 'in_transit' && ['approved', 'label_sent'].includes(s)) set.status = 'in_transit';
  if (kind === 'ready_to_collect' && before) set.status = 'ready_to_collect';
  if (kind === 'delivered') {
    // Delivered to the point (some carriers say "delivered" on arrival), or
    // collected from it after "awaiting pickup".
    if (before) set.status = 'ready_to_collect';
    else if (s === 'ready_to_collect') { set.status = 'received'; set.receivedAt = iso; }
  }
  if (set.status === 'ready_to_collect') { set.readyToCollectAt = iso; effects.becameReady = true; }
  if (kind === 'exception' || kind === 'returned_to_sender') effects.alert = true;
  return { effects, set };
}

export async function applyReturnEvent(event, { sanity, getResend, now = () => Date.now(), log = console }) {
  const retId = await sanity.fetch('*[_type == "returnRequest" && returnRef == $r && !(_id in path("drafts.**"))][0]._id', { r: String(event.returnRef || '') });
  if (!retId) {
    log.warn(`shipping-event: no return ${event.returnRef} — ignored`);
    return { status: 200, body: 'Unknown return — ignored' };
  }
  let effects = null;
  let set = null;
  const { doc } = await readDecideWrite(sanity, retId, (d) => {
    const r = returnEventPatch(d, event, { now: now() });
    effects = r.effects;
    set = r.set;
    return r.set ? { set: r.set } : null;
  });
  const ret = { ...doc, ...(set || {}) };
  const resend = getResend();
  if (effects.becameReady) {
    const sent = await sendEmail(resend, returnReadyEmail(ret, event));
    if (!sent.ok) log.error(`shipping-event: return ${ret.returnNumber} ready email not sent: ${sent.error}`);
  }
  if (effects.alert) {
    const sent = await sendEmail(resend, returnAlertEmail(ret, event, effects.kind));
    if (!sent.ok) log.error(`shipping-event: return ${ret.returnNumber} alert email not sent: ${sent.error}`);
  }
  log.log(`shipping-event: return ${ret.returnNumber} ${event.statusCode} ${effects.kind} -> ${ret.status}`);
  return { status: 200, body: 'OK', effects };
}
