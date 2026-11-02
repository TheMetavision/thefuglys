/**
 * What one "<Brand> orders" webhook delivery asks for.
 *
 * Sanity's plan allows two webhooks. The rebuild webhook holds one (content
 * builds, untouched); the free slot holds a new "<Brand> orders" webhook ->
 * /api/sanity-orders-webhook, and every order and return-request event comes
 * here. Both slots are then used: ANY future order or return job must be
 * routed through this file, never a third webhook.
 *
 *   order with wall art and no parcel plan yet
 *       -> plan             write the default plan (+ problems)    SHIPPING_ENABLED only
 *   order, wall art Dispatched by hand with a wall-art tracking number, email unsent
 *       -> dispatch-email   ALWAYS, SHIPPING_ENABLED or not
 *   order, Shipment "Ready to ship", a planned parcel unlabelled
 *       (or every parcel labelled but the print links expired)
 *       -> shipping-dispatch                                       SHIPPING_ENABLED only
 *   returnRequest, Approved with no label sent (a Printful claim: no claim
 *       email sent) / Rejected with no decline sent
 *       -> shipping-return                                         SHIPPING_ENABLED only
 *
 * The Printful side of an order (status, carrier, trackingNumber, shippedAt,
 * printfulOrderId) and Printful's own "It's shipped" email
 * (printful-webhook.mjs) are never involved.
 *
 * TRANSITIONS. The webhook's projection carries
 *   "before": before(){ inhouseStatus, wallArtTrackingNumber, status, "shipmentStatus": shipment.status }
 * so an action fires when the document MOVES into the state, not every time a
 * document already in it is saved. That matters twice:
 *   - orders dispatched by hand before this existed have no dispatch-email
 *     stamp, and must not all be emailed the next time someone edits them;
 *   - after a failed label or return, the server writes the error to the
 *     document; that write must not start the job again (a loop). Alan
 *     retries by moving the status away and back. Re-issuing expired print
 *     links works the same way (On hold -> Ready to ship).
 * Without `before` in the body (projection not set yet) the safe defaults
 * apply: no retry after an exception, no link re-issue, and no dispatch email
 * for an order placed before DISPATCH_EMAIL_SINCE.
 *
 * This decides what to START. Each handler re-reads the document and claims it
 * with a conditional write; that claim, not this router, stops a double send.
 */
import { orderNotDue } from './dispatch-email.mjs';
import { isWallArtLine } from './parcel-plan.mjs';
import { labelLinkStale } from './shipping-internal.mjs';
import { orderRefFor } from './order-ref.mjs';

/** Orders placed before this never get an automatic dispatch email. */
export const DISPATCH_EMAIL_SINCE = '2026-11-01T00:00:00Z';

const hasBefore = (doc) => Object.prototype.hasOwnProperty.call(doc, 'before');
const beforeOf = (doc) => (hasBefore(doc) ? (doc.before || {}) : null);

/** Labels exist for every planned parcel: nothing left to buy. */
export function everyPlannedParcelLabelled(doc) {
  const plan = Array.isArray(doc.parcelPlan) ? doc.parcelPlan : [];
  if (!plan.length) return false;
  const labelled = new Set((doc.shipmentResult?.parcels || []).filter((p) => p?.labelId).map((p) => String(p.parcelRef)));
  return plan.every((p) => labelled.has(String(p?.parcelRef)));
}

function shippingDispatchDue(doc, now) {
  if (doc.shipment?.status !== 'ready_to_ship') return `shipment ${doc.shipment?.status || 'not ready'}`;
  const b = beforeOf(doc);
  const movedIn = Boolean(b) && b.shipmentStatus !== 'ready_to_ship';
  if (everyPlannedParcelLabelled(doc)) {
    if (!labelLinkStale(doc.shipmentResult?.labelLinksExpireAt, now)) return 'every planned parcel already has a label';
    return movedIn ? null : 'print links expired: set On hold, then Ready to ship, to re-issue them';
  }
  if (doc.shipmentResult?.state === 'exception' && !movedIn) return 'last attempt failed: set On hold, then Ready to ship, to retry';
  return null;
}

function planDue(doc) {
  if (!(doc.items || []).some(isWallArtLine)) return 'no wall art';
  if (Array.isArray(doc.parcelPlan) && doc.parcelPlan.length) return 'plan exists';
  if (doc.shipmentResult?.planProposedAt) return 'plan already proposed';
  return null;
}

/**
 * @param {object} doc  the webhook body
 * @param {{ since?: string, now?: number }} [opts]
 * @returns {{ actions: string[], reason: string }}
 */
export function routeFor(doc, { since = DISPATCH_EMAIL_SINCE, now = Date.now() } = {}) {
  if (!doc || typeof doc._id !== 'string' || typeof doc._type !== 'string') return { actions: [], reason: 'no document in the body' };
  if (doc._id.startsWith('drafts.') || doc._id.startsWith('versions.')) return { actions: [], reason: 'a draft or version' };
  const b = beforeOf(doc);
  const actions = [];
  const why = [];

  if (doc._type === 'order') {
    const plan = planDue(doc);
    if (plan) why.push(plan); else actions.push('plan');

    const notDue = orderNotDue(doc);
    if (notDue) why.push(`dispatch email: ${notDue}`);
    else if (b && b.inhouseStatus === 'dispatched' && String(b.wallArtTrackingNumber || '').trim()) why.push('dispatch email: already dispatched before this edit');
    else if (!b && (!doc.placedAt || doc.placedAt < since)) why.push('dispatch email: order predates dispatch emails');
    else actions.push('dispatch-email');

    const ship = shippingDispatchDue(doc, now);
    if (ship) why.push(ship); else actions.push('shipping-dispatch');
    return { actions, reason: actions.length ? actions.join(' + ') : why.join('; ') };
  }

  if (doc._type === 'returnRequest') {
    const retry = (s) => !doc.error || (b && b.status !== s);
    if (doc.status === 'approved' && !doc.labelSentAt && !doc.claimEmailSentAt) {
      return retry('approved') ? { actions: ['shipping-return'], reason: 'return approved' } : { actions: [], reason: 'last attempt failed: set Requested, then Approved, to retry' };
    }
    if (doc.status === 'rejected' && !doc.rejectionEmailSentAt) {
      return retry('rejected') ? { actions: ['shipping-return'], reason: 'return rejected' } : { actions: [], reason: 'last attempt failed: set Requested, then Rejected, to retry' };
    }
    return { actions: [], reason: `return ${doc.status || 'unset'}${doc.labelSentAt || doc.claimEmailSentAt || doc.rejectionEmailSentAt ? ', already actioned' : ''}` };
  }

  return { actions: [], reason: `type ${doc._type}` };
}

/** Where each background job lives (netlify.toml: /api/* -> the function of that name). */
export const BACKGROUND_PATHS = {
  'shipping-dispatch': '/api/shipping-dispatch-background',
  'shipping-return': '/api/shipping-return-background',
};

const SHIPPING_ONLY = new Set(['plan', 'shipping-dispatch', 'shipping-return']);

/**
 * Run the route for one verified body. Exported for the tests.
 *
 * @param {object} doc
 * @param {object} deps
 * @param {boolean} deps.shippingOn
 * @param {(id: string) => Promise<{status:number, reason:string}>} deps.sendDispatch
 * @param {(id: string) => Promise<string>} deps.proposePlan
 * @param {(action: string, doc: object) => Promise<{ok:boolean, status?:number, error?:string}>} deps.start
 */
export async function runRoute(doc, deps) {
  const log = deps.log || console;
  const { actions, reason } = routeFor(doc, deps.routeOpts);
  const name = (doc?._type === 'order' && orderRefFor(doc)) || doc?.returnNumber || doc?._id || '?';
  if (!actions.length) {
    log.log(`sanity-orders-webhook: ${name}: no action (${reason})`);
    return { status: 200, body: `No action — ${reason}` };
  }
  const results = [];
  let status = 200;
  for (const action of actions) {
    if (SHIPPING_ONLY.has(action) && !deps.shippingOn) {
      results.push(`${action}: shipping is not enabled`);
      continue;
    }
    try {
      if (action === 'dispatch-email') {
        const r = await deps.sendDispatch(doc._id);
        results.push(`dispatch-email: ${r.reason}`);
        if (r.status >= 500) status = Math.max(status, r.status);
      } else if (action === 'plan') {
        results.push(`plan: ${await deps.proposePlan(doc._id)}`);
      } else {
        const r = await deps.start(action, doc);
        if (r.ok) results.push(`${action}: started`);
        else {
          // 502, so Sanity retries; the handler's claim makes a retry harmless.
          log.error(`sanity-orders-webhook: ${name}: ${action} did not start: ${r.error}`);
          results.push(`${action}: not started (${r.error})`);
          status = Math.max(status, 502);
        }
      }
    } catch (err) {
      log.error(`sanity-orders-webhook: ${name}: ${action} failed:`, err?.message || err);
      results.push(`${action}: failed`);
      status = Math.max(status, 500);
    }
  }
  log.log(`sanity-orders-webhook: ${name}: ${results.join(' | ')}`);
  return { status, body: results.join('\n') };
}
