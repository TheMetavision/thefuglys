/**
 * Buying the wall-art labels for one order.
 *
 * Alan sets Shipment -> "Ready to ship" in the Studio and publishes. The
 * "<Brand> orders" webhook reaches sanity-orders-webhook, which starts
 * shipping-dispatch-background, which runs dispatchShipment(): one label per
 * planned parcel from the shipping service, the results in shipmentResult
 * (each parcel with a signed 30-day "Print label" link), and the team's
 * "Label ready" email. The CUSTOMER is not emailed here: the wall-art
 * dispatch email goes at the first carrier scan (shipping-event).
 *
 * Any failure -- a plan that doesn't add up, an address outside the UK,
 * band_not_configured, no_available_option, the service down -- sets
 * shipmentResult.state to "exception", records why, and emails the team. Alan
 * retries by setting Shipment to On hold and back to Ready to ship; a parcel
 * that already has a label is never bought twice (skipped here, and the
 * service is idempotent on orderRef + parcelRef anyway).
 *
 * The same On hold -> Ready to ship move, on an order whose labels all exist,
 * re-issues the print links when they have expired (or have under a day left)
 * and emails them again.
 *
 * Fields: Alan owns shipment.status and parcelPlan; this writes only
 * shipmentResult.* (and, when the plan was empty, the default parcelPlan),
 * through server-patch.mjs. Printful's fields (status, carrier, trackingNumber,
 * trackingUrl, shippedAt, printfulOrderId) are never touched.
 *
 * The service gets the bare 8-character order reference (the brand is in the
 * signed header), so labels and callbacks carry the same reference the
 * customer has, without the "#".
 */
import { readDecideWrite, serverPatch } from './server-patch.mjs';
import { quotedPounds } from './shipping-client.mjs';
import { proposeParcelPlan, validateParcelPlan, parcelItems, recipientFor, isWallArtLine, INTERNATIONAL_NOTE } from './parcel-plan.mjs';
import { orderRefFor, bareOrderRef } from './order-ref.mjs';
import { signLabelLink, labelLinkStale } from './shipping-internal.mjs';
import { intSetting, setting } from './site-config.mjs';
import { sendEmail, labelReadyEmail, shipmentProblemEmail } from './shipping-emails.mjs';

export const CLAIM_TTL_MS = 10 * 60 * 1000;

const countryOf = (order) => String(order?.shippingAddress?.country || '').toUpperCase();

/**
 * The default plan as a server patch for an order that has none yet, or null.
 * Used when an order with wall art first arrives (the router) and when
 * Ready to ship is set on an empty plan (below).
 */
export function proposePlanPatch(order, { env = process.env } = {}) {
  if (!order || order._type !== 'order') return null;
  if (!(order.items || []).some(isWallArtLine)) return null;
  if (Array.isArray(order.parcelPlan) && order.parcelPlan.length) return null;
  if (order.shipmentResult?.planProposedAt) return null;
  const country = countryOf(order) || 'GB';
  const { plan, problems, international } = proposeParcelPlan(order.items, {
    country, posterExtraWeightG: intSetting('POSTER_EXTRA_WEIGHT_G', 0, env),
  });
  const set = { 'shipmentResult.planProposedAt': new Date().toISOString() };
  if (plan.length) set.parcelPlan = plan;
  if (problems.length) set['shipmentResult.planProblem'] = problems.join('\n');
  if (international) set['shipmentResult.international'] = true;
  return { set };
}

/** What we keep about a parcel. */
export function parcelRecord(planned, res, link) {
  return {
    _key: `parcel-${planned.parcelRef}`,
    _type: 'shipmentParcel',
    parcelRef: String(planned.parcelRef),
    band: planned.band,
    ...(planned.extraWeightG ? { extraWeightG: Number(planned.extraWeightG) } : {}),
    parcelId: res.parcelId != null ? String(res.parcelId) : undefined,
    shipmentId: res.shipmentId != null ? String(res.shipmentId) : undefined,
    carrier: res.carrier || undefined,
    option: res.method || undefined,
    quotedPrice: quotedPounds(res) ?? undefined,
    trackingNumber: res.trackingNumber || undefined,
    trackingUrl: res.trackingUrl || undefined,
    labelId: res.labelId != null ? String(res.labelId) : undefined,
    labelUrl: link?.url || undefined,
    status: 'label_created',
    ...(res.test ? { test: true } : {}),
  };
}

/** Fresh signed links on every labelled parcel. */
function withFreshLinks(parcels, { env, now }) {
  let expiresAt = null;
  const out = parcels.map((p) => {
    if (!p?.labelId) return p;
    const link = signLabelLink(p.labelId, { env, now });
    if (!link) return p;
    expiresAt = link.expiresAt;
    return { ...p, labelUrl: link.url };
  });
  return { parcels: out, expiresAt };
}

/**
 * The whole job for one order. Exported for the tests, which hand it fakes.
 *
 * @param {string} id
 * @param {{ sanity, shipping: (path, body) => Promise<object>, getResend, env?, now?, log? }} deps
 */
export async function dispatchShipment(id, deps) {
  const { sanity, shipping, getResend, env = process.env, now = () => Date.now(), log = console } = deps;

  /* Claim first: Sanity delivers at least once, and Alan can flip the switch
     twice. Only the caller whose conditional write lands goes on. */
  let ignored = null;
  const claim = await readDecideWrite(sanity, id, (doc) => {
    if (!doc || doc._type !== 'order') { ignored = 'not an order'; return null; }
    if (doc.shipment?.status !== 'ready_to_ship') { ignored = `shipment is ${doc.shipment?.status || 'not ready'}`; return null; }
    const claimedAt = Date.parse(doc.shipmentResult?.dispatchClaimedAt || '');
    if (Number.isFinite(claimedAt) && now() - claimedAt < CLAIM_TTL_MS) { ignored = 'already being dispatched'; return null; }
    return { set: { 'shipmentResult.dispatchClaimedAt': new Date(now()).toISOString() } };
  });
  if (!claim.written) return { outcome: 'ignored', reason: ignored || 'the order kept changing; the next webhook will retry' };
  const doc = claim.doc;

  const resend = getResend();
  const ref = orderRefFor(doc) || doc._id;
  const address = doc.shippingAddress || {};
  const name = address.name || doc.customerName || '';
  const who = { ref, id: doc._id, name, email: doc.customerEmail || '', address };

  const fail = async (reason, extra = {}) => {
    await serverPatch(sanity, id, {
      set: { 'shipmentResult.state': 'exception', 'shipmentResult.error': reason, 'shipmentResult.exceptionAt': new Date(now()).toISOString(), ...extra },
      unset: ['shipmentResult.dispatchClaimedAt'],
    });
    log.error(`shipping-dispatch: ${ref} -> exception: ${reason.split('\n')[0]}`);
    const sent = await sendEmail(resend, shipmentProblemEmail(who, reason));
    if (!sent.ok) log.error(`shipping-dispatch: ${ref} problem email not sent: ${sent.error}`);
    return { outcome: 'exception', reason };
  };

  const items = doc.items || [];
  if (!items.some(isWallArtLine)) return fail('This order has no wall art: there is nothing for us to post (Printful ships the other items).');

  /* The plan: Alan's, as edited in the Studio, or the default, which is
     written back so he can edit it. */
  let plan = Array.isArray(doc.parcelPlan) && doc.parcelPlan.length ? doc.parcelPlan : null;
  const defaulted = !plan;
  const proposal = defaulted
    ? proposeParcelPlan(items, { country: countryOf(doc) || 'GB', posterExtraWeightG: intSetting('POSTER_EXTRA_WEIGHT_G', 0, env) })
    : null;
  if (proposal) plan = proposal.plan;
  const planSet = defaulted && plan.length ? { parcelPlan: plan } : {};

  const country = countryOf(doc);
  if (country !== 'GB') {
    return fail(`The delivery address is in ${country || 'an unknown country'}. ${INTERNATIONAL_NOTE}`,
      { ...planSet, 'shipmentResult.international': true });
  }
  const problems = [...new Set([...(proposal?.problems || []), ...validateParcelPlan(plan, items)])];
  if (problems.length) {
    return fail(`The parcel plan needs fixing before a label can be bought:\n- ${problems.join('\n- ')}`, planSet);
  }

  const already = new Map((doc.shipmentResult?.parcels || []).filter((p) => p?.labelId).map((p) => [String(p.parcelRef), p]));
  const inPlan = new Set(plan.map((p) => String(p.parcelRef)));

  /* Every planned parcel already has a label: this is a request for new
     print links (On hold -> Ready to ship). */
  if (plan.every((p) => already.has(String(p.parcelRef)))) {
    const all = doc.shipmentResult?.parcels || [];
    if (!labelLinkStale(doc.shipmentResult?.labelLinksExpireAt, now())) {
      await serverPatch(sanity, id, { unset: ['shipmentResult.dispatchClaimedAt'] });
      return { outcome: 'ignored', reason: 'every planned parcel already has a label and its print link is still valid' };
    }
    const fresh = withFreshLinks(all, { env, now: now() });
    if (!fresh.expiresAt) return fail('The print links could not be signed: SHIPPING_SECRET is not set.');
    await serverPatch(sanity, id, {
      set: { 'shipmentResult.parcels': fresh.parcels, 'shipmentResult.labelLinksExpireAt': fresh.expiresAt },
      unset: ['shipmentResult.dispatchClaimedAt'],
    });
    const sent = await sendEmail(resend, labelReadyEmail(who, fresh.parcels.filter((p) => inPlan.has(String(p.parcelRef))), { renewed: true, expiresAt: fresh.expiresAt }));
    if (!sent.ok) log.error(`shipping-dispatch: ${ref} renewed-links email not sent: ${sent.error}`);
    log.log(`shipping-dispatch: ${ref} -> print links re-issued`);
    return { outcome: 'links_renewed', parcels: fresh.parcels };
  }

  const made = [];
  let error = null;
  for (const planned of plan) {
    const pref = String(planned.parcelRef);
    if (already.has(pref)) { made.push(already.get(pref)); continue; }
    try {
      const extra = Math.max(0, Math.floor(Number(planned.extraWeightG) || 0));
      const res = await shipping('create-parcel', {
        orderRef: bareOrderRef(doc),
        parcelRef: pref,
        band: planned.band,
        recipient: recipientFor(name, address),
        items: parcelItems(planned, items, { skuPrefix: setting('SHIPPING_BRAND', env) }),
        // Posters after the first in a tube: the service adds it to the
        // band's weight (README, "Extra weight").
        ...(extra ? { extraWeightG: extra } : {}),
      });
      made.push(parcelRecord(planned, res, res.labelId != null ? signLabelLink(res.labelId, { env, now: now() }) : null));
    } catch (err) {
      const details = err?.details ? `\n${JSON.stringify(err.details).slice(0, 800)}` : '';
      error = `Parcel ${pref} (${planned.band}): ${err?.code || 'error'} — ${err?.message || err}${details}`;
      break;
    }
  }
  // Labels bought earlier but no longer in the plan stay on record: they exist.
  const kept = [...already.values()].filter((p) => !inPlan.has(String(p.parcelRef)));
  const fresh = withFreshLinks([...made, ...kept], { env, now: now() });
  const parcels = fresh.parcels;

  if (error) {
    const bought = made.filter((p) => p.labelId).length;
    return fail(bought ? `${error}\n\n${bought} label(s) were bought before this and are kept.` : error,
      { ...planSet, 'shipmentResult.parcels': parcels, ...(fresh.expiresAt ? { 'shipmentResult.labelLinksExpireAt': fresh.expiresAt } : {}) });
  }

  const set = {
    ...planSet,
    'shipmentResult.state': 'label_created',
    'shipmentResult.parcels': parcels,
    'shipmentResult.labelCreatedAt': new Date(now()).toISOString(),
    ...(fresh.expiresAt ? { 'shipmentResult.labelLinksExpireAt': fresh.expiresAt } : {}),
  };
  await serverPatch(sanity, id, { set, unset: ['shipmentResult.dispatchClaimedAt', 'shipmentResult.error', 'shipmentResult.planProblem'] });
  log.log(`shipping-dispatch: ${ref} -> label_created (${parcels.length} parcel(s))`);

  const sent = await sendEmail(resend, labelReadyEmail(who, parcels.filter((p) => inPlan.has(String(p.parcelRef))), { expiresAt: fresh.expiresAt }));
  if (!sent.ok) log.error(`shipping-dispatch: ${ref} "label ready" email not sent: ${sent.error}`);
  return { outcome: 'label_created', parcels };
}
