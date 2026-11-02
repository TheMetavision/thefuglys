/**
 * Acting on Alan's decision on a return request.
 *
 *   Approved -> the service's create-return buys the label, choosing the route
 *               itself (InPost locker drop-off for small parcels, Evri for
 *               larger ones, then UPS). The customer is emailed the label PDF
 *               and the service's customerInstructions, plus -- unless it is a
 *               free label for a faulty or wrong item -- "£X.XX return postage
 *               will be deducted from your refund", from create-return's
 *               quotedPrice, recorded as postageDeduction for Alan to take off
 *               the refund in Stripe. Status -> Label sent.
 *   Rejected -> a polite decline with the reason Alan wrote.
 *
 * A Printful claim (type printfulClaim: a faulty, misprinted or damaged
 * merchandise item, reported on /returns) has no label. Approved -> the
 * customer is emailed "your replacement is on its way" (Alan has reported it
 * in Printful), or, when Alan chose "Refund instead", that they are being
 * refunded refundAmount (by hand in Stripe). Status -> Replacement sent /
 * Refund due. Rejected -> the decline, worded for a claim.
 *
 * Each email goes once: the request is claimed (a conditional write) before
 * anything is done, and labelSentAt / rejectionEmailSentAt mark it done. A
 * failure records the reason in `error` and emails the team; Alan retries by
 * setting the status to Requested and back to Approved. A label that already
 * exists is reused, never bought twice.
 *
 * The collection point a return is addressed to is never shown to the
 * customer: the label says it, and nothing else we send does.
 */
import { readDecideWrite, serverPatch } from './server-patch.mjs';
import { quotedPounds } from './shipping-client.mjs';
import { ALL_BANDS, recipientFor } from './parcel-plan.mjs';
import { sendEmail, returnLabelEmail, returnDeclinedEmail, returnProblemEmail, claimReplacementEmail, claimRefundEmail } from './shipping-emails.mjs';
import { normaliseOrderRef } from './order-ref.mjs';

export const CLAIM_TTL_MS = 10 * 60 * 1000;

export async function processReturn(retId, { sanity, shipping, fetchLabel, getResend, now = () => Date.now(), log = console }) {
  let ignored = null;
  const claim = await readDecideWrite(sanity, retId, (ret) => {
    if (!ret || ret._type !== 'returnRequest') { ignored = 'not a return request'; return null; }
    if (ret.status === 'approved' && ret.labelSentAt) { ignored = 'label already sent'; return null; }
    if (ret.status === 'approved' && ret.claimEmailSentAt) { ignored = 'claim email already sent'; return null; }
    if (ret.status === 'rejected' && ret.rejectionEmailSentAt) { ignored = 'decline already sent'; return null; }
    if (ret.status !== 'approved' && ret.status !== 'rejected') { ignored = `status is ${ret.status}`; return null; }
    const claimedAt = Date.parse(ret.claimedAt || '');
    if (Number.isFinite(claimedAt) && now() - claimedAt < CLAIM_TTL_MS) { ignored = 'already in hand'; return null; }
    return { set: { claimedAt: new Date(now()).toISOString() } };
  });
  if (!claim.written) return { outcome: 'ignored', reason: ignored || 'the request kept changing; the next webhook will retry' };
  let ret = claim.doc;

  const resend = getResend();
  const name = ret.returnNumber || ret._id;
  const fail = async (reason, extra = {}) => {
    await serverPatch(sanity, retId, { set: { error: reason, errorAt: new Date(now()).toISOString(), ...extra }, unset: ['claimedAt'] });
    log.error(`shipping-return: ${name}: ${reason}`);
    const sent = await sendEmail(resend, returnProblemEmail(ret, reason));
    if (!sent.ok) log.error(`shipping-return: ${name} problem email not sent: ${sent.error}`);
    return { outcome: 'error', reason };
  };

  /* ── rejected ─────────────────────────────────────────────────────────── */
  if (ret.status === 'rejected') {
    if (!String(ret.rejectionReason || '').trim()) {
      return fail('Rejected with no reason: write the reason in "Reason for rejecting" (the customer is sent it), then set the status to Requested and back to Rejected.');
    }
    const sent = await sendEmail(resend, returnDeclinedEmail(ret));
    if (!sent.ok) return fail(`The decline email was not sent: ${sent.error}`);
    await serverPatch(sanity, retId, { set: { rejectionEmailSentAt: new Date(now()).toISOString() }, unset: ['claimedAt', 'error'] });
    log.log(`shipping-return: ${name} declined, customer emailed`);
    return { outcome: 'rejected' };
  }

  /* ── approved: a Printful claim (no label) ────────────────────────────── */
  if (ret.type === 'printfulClaim') {
    if (!Array.isArray(ret.lines) || !ret.lines.length) return fail('The claim has no items on it.');
    const refund = ret.claimResolution === 'refund';
    if (refund && !(Number(ret.refundAmount) > 0)) {
      return fail('Refund instead is chosen but "Refund (£)" is empty: fill it in, then set the status to Requested and back to Approved.');
    }
    const sent = await sendEmail(resend, refund ? claimRefundEmail(ret) : claimReplacementEmail(ret));
    if (!sent.ok) return fail(`The ${refund ? 'refund' : 'replacement'} email was not sent: ${sent.error}`);
    await serverPatch(sanity, retId, {
      set: { status: refund ? 'refund_due' : 'replacement_sent', claimEmailSentAt: new Date(now()).toISOString() },
      unset: ['claimedAt', 'error'],
    });
    log.log(`shipping-return: ${name} claim approved, customer told ${refund ? `refund £${Number(ret.refundAmount).toFixed(2)}` : 'replacement on its way'}`);
    return { outcome: refund ? 'refund_due' : 'replacement_sent' };
  }

  /* ── approved: a return label ─────────────────────────────────────────── */
  if (!ret.band || !ALL_BANDS.includes(ret.band)) {
    return fail(`Choose the return parcel's band ("Parcel band") — ${ret.band ? `"${ret.band}" is not a known band` : 'none is set'}. A mix of items needs it chosen by hand.`);
  }
  if (!Array.isArray(ret.lines) || !ret.lines.length) return fail('The request has no items on it.');
  const order = ret.orderId ? await sanity.getDocument(ret.orderId) : null;
  if (!order) return fail(`The order ${ret.orderNumber || ''} could not be found.`);
  if (String(order.shippingAddress?.country || '').toUpperCase() !== 'GB') {
    return fail('The order address is outside the UK. Sendcloud returns are UK-only: arrange this one by hand.');
  }

  if (!ret.labelId) {
    let res;
    try {
      res = await shipping('create-return', {
        // The bare 8 characters, as for the outbound label (orderNumber is "#…").
        orderRef: normaliseOrderRef(ret.orderNumber) || ret.orderNumber,
        returnRef: ret.returnRef,
        band: ret.band,
        // Name, address and email: a collection from the customer's door is
        // booked against them.
        customer: { ...recipientFor(order.shippingAddress?.name || order.customerName, order.shippingAddress), email: ret.customerEmail || order.customerEmail || '' },
        items: ret.lines.map((l) => ({
          description: String(l.title || 'Item').slice(0, 120),
          qty: Math.max(1, Math.floor(Number(l.quantity) || 1)),
          valueGBP: Math.round((Number(l.unitPrice) || 0) * (Number(l.quantity) || 1) * 100) / 100,
        })),
      });
    } catch (err) {
      const details = err?.details ? `\n${JSON.stringify(err.details).slice(0, 800)}` : '';
      return fail(`create-return failed: ${err?.code || 'error'} — ${err?.message || err}${details}`);
    }
    const label = {
      carrier: res.carrier || undefined,
      option: res.method || undefined,
      trackingNumber: res.trackingNumber || undefined,
      trackingUrl: res.trackingUrl || undefined,
      labelId: res.labelId != null ? String(res.labelId) : undefined,
      parcelId: res.parcelId != null ? String(res.parcelId) : undefined,
      quotedPrice: quotedPounds(res) ?? undefined,
      customerInstructions: res.customerInstructions || undefined,
      ...(res.test ? { test: true } : {}),
    };
    const clean = Object.fromEntries(Object.entries(label).filter(([, v]) => v !== undefined));
    // Recorded at once, so a retry after a later failure reuses this label.
    await serverPatch(sanity, retId, { set: clean });
    ret = { ...ret, ...clean };
  }

  const postage = ret.freeLabel ? 0 : (ret.quotedPrice ?? null);
  let pdf;
  try {
    pdf = await fetchLabel(ret.labelId);
  } catch (err) {
    return fail(`The label PDF could not be fetched: ${err?.code || ''} ${err?.message || err}`);
  }
  const sent = await sendEmail(resend, returnLabelEmail(ret, { pdf, instructions: ret.customerInstructions, postage }));
  if (!sent.ok) return fail(`The label email was not sent: ${sent.error}`);

  const doneAt = new Date(now()).toISOString();
  // status is Alan's field, but "Label sent" is the server reporting what it
  // did; serverPatch writes the draft too, so publishing cannot undo it.
  if (postage === null) {
    await serverPatch(sanity, retId, {
      set: { status: 'label_sent', labelSentAt: doneAt, error: `The shipping service gave no price for label ${ret.labelId}, so the email said postage is deducted without a figure. Take the label cost from Sendcloud off the refund.` },
      unset: ['claimedAt', 'postageDeduction'],
    });
    log.error(`shipping-return: ${name} label sent with no quoted price`);
    return { outcome: 'label_sent', postage };
  }
  await serverPatch(sanity, retId, { set: { status: 'label_sent', labelSentAt: doneAt, postageDeduction: postage }, unset: ['claimedAt', 'error'] });
  log.log(`shipping-return: ${name} label sent (${ret.carrier || '?'}, deduction £${postage.toFixed(2)})`);
  return { outcome: 'label_sent', postage };
}
