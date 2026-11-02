/**
 * The Sendcloud flow's emails: the team's notices (label ready, problems,
 * returns, Printful claims), what a customer gets about a return (the label,
 * or a polite no) and about a Printful claim (send us a photo; then the
 * replacement is on its way, or a refund instead).
 *
 * The customer's "on its way" email is NOT here -- it is dispatch-email.mjs,
 * sent once whichever path ships.
 *
 * Team emails go to TEAM_EMAIL and come from TEAM_EMAIL_FROM. Customer emails
 * come from, and take replies at, the brand's own address (EMAIL_FROM,
 * EMAIL_REPLY_TO). All four are site-config. The point a return is collected
 * from is only ever named to the team. "Print label" links are the signed,
 * expiring links stored on the order (shipmentResult.parcels[].labelUrl).
 * Customer emails use the brand's card (dispatch-email.mjs brandCard), the
 * same frame as Printful's "It's shipped" email.
 */
import { carrierName } from './parcel-plan.mjs';
import { setting } from './site-config.mjs';
import { esc, brandCard, brandLook } from './dispatch-email.mjs';
import { RETURN_WINDOW_DAYS, MERCH_WINDOW_DAYS, PRINTFUL_CLAIM_DAYS, longDate as longDateOf } from './returns-eligibility.mjs';

export { esc };

export const studioLink = (id, type) => `${setting('STUDIO_URL')}/intent/edit/id=${encodeURIComponent(id)};type=${type}`;
export const teamAddress = () => setting('TEAM_EMAIL');
/** A team email's recipient and sender: the team keeps its own sender, so only customer emails use EMAIL_FROM. */
export const toTeam = () => ({ to: [teamAddress()], from: setting('TEAM_EMAIL_FROM'), reply_to: setting('TEAM_EMAIL_REPLY_TO') });
const money = (n) => `£${(Number(n) || 0).toFixed(2)}`;
const testTag = () => (['true', '1', 'yes'].includes(String(process.env.SHIPPING_TEST_MODE || '').toLowerCase()) ? '[TEST] ' : '');
const brand = () => setting('BRAND_SHORT');
const dateOnly = (iso) => (iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' }) : '');

/**
 * Resend reports a refusal by returning an error, so both shapes become { ok, error }.
 * The brand's sender unless the message names its own (team emails, toTeam).
 */
export async function sendEmail(resend, message) {
  if (!resend) return { ok: false, error: 'RESEND_API_KEY is not set' };
  try {
    const { error } = await resend.emails.send({ from: setting('EMAIL_FROM'), reply_to: setting('EMAIL_REPLY_TO'), ...message });
    if (error) return { ok: false, error: `${error.name || 'Error'}: ${error.message || 'Resend rejected the send'}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

const plainWrap = (inner) => `<div style="font-family: Arial, sans-serif; font-size: 14px; line-height: 1.6; color: #222; max-width: 680px;">${inner}</div>`;
const table = (rows) => `<table cellpadding="6" cellspacing="0" border="1" style="border-collapse: collapse; border-color: #ddd; font-size: 13px; margin: 12px 0;">${rows}</table>`;

/* ------------------------------------------------------------------ team: outbound */

/**
 * @param {{ ref: string, id: string, name: string, address: object }} who
 * @param {object[]} parcels  shipmentParcel records, each with labelUrl
 * @param {{ renewed?: boolean, expiresAt?: string }} [opts]
 */
export function labelReadyEmail(who, parcels, { renewed = false, expiresAt } = {}) {
  const rows = `<tr style="background:#f3f3f3"><th>Parcel</th><th>Band</th><th>Carrier / option</th><th>Quoted</th><th>Tracking</th><th>Label</th></tr>`
    + parcels.map((p) => `<tr>
      <td>${esc(p.parcelRef)}</td><td>${esc(p.band)}${p.extraWeightG ? `<br><span style="color:#777">+${esc(p.extraWeightG)} g</span>` : ''}</td>
      <td>${esc(carrierName(p.carrier))}<br><span style="color:#777">${esc(p.option || '')}</span></td>
      <td>${p.quotedPrice != null ? money(p.quotedPrice) : '—'}</td>
      <td>${esc(p.trackingNumber || '—')}</td>
      <td>${p.labelUrl ? `<a href="${esc(p.labelUrl)}"><strong>Print label</strong></a>` : '<span style="color:#c00">no link (SHIPPING_SECRET unset?)</span>'}</td></tr>`).join('');
  const n = parcels.length;
  return {
    ...toTeam(),
    subject: `${testTag()}🏷️ ${brand()} ${renewed ? 'new label links' : 'label ready'} — ${who.ref} (${n} parcel${n === 1 ? '' : 's'})`,
    html: plainWrap(`
      <h2 style="margin:0 0 8px">${renewed ? 'New print links for' : `Wall-art label${n === 1 ? '' : 's'} ready for`} ${esc(brand())} order ${esc(who.ref)}</h2>
      <p>${esc(who.name || '')} — ${esc([who.address?.city, who.address?.postalCode].filter(Boolean).join(', '))}</p>
      ${table(rows)}
      ${renewed ? '' : '<p>The customer has <strong>not</strong> been emailed. They get the wall-art dispatch email with tracking at the first carrier scan.</p>'}
      <p>The print links work for 30 days${expiresAt ? ` (until ${esc(dateOnly(expiresAt))})` : ''}. To get new ones, set Shipment to <strong>On hold</strong>, publish, then <strong>Ready to ship</strong> again. Don't forward them: anyone with a link can open that label.</p>
      <p><a href="${esc(studioLink(who.id, 'order'))}">Open the order in the Studio</a></p>`),
  };
}

export function shipmentProblemEmail(who, reason) {
  return {
    ...toTeam(),
    subject: `${testTag()}⚠ ${brand()} shipping problem — ${who.ref}`,
    html: plainWrap(`
      <h2 style="margin:0 0 8px">No label for ${esc(brand())} order ${esc(who.ref)}</h2>
      <p>The shipment is marked <strong>Exception</strong> and nothing more will happen until you change it.</p>
      <p style="background:#fff3f3;border-left:4px solid #c00;padding:10px 12px;white-space:pre-wrap">${esc(reason)}</p>
      <p>Fix the parcel plan (or the band set-up on the shipping service), then set Shipment to
      <strong>On hold</strong> and back to <strong>Ready to ship</strong> to try again. Parcels that already have a label are not bought twice.
      Or dispatch it by hand: In-house Status → Dispatched with the wall-art carrier and tracking number sends the customer email.</p>
      <p><a href="${esc(studioLink(who.id, 'order'))}">Open the order in the Studio</a></p>`),
  };
}

export function parcelAlertEmail(who, parcel, event, kind) {
  const what = kind === 'returned_to_sender' ? 'is being returned to sender' : 'has a delivery problem';
  return {
    ...toTeam(),
    subject: `${testTag()}⚠ ${brand()} ${who.ref}: wall-art parcel ${parcel?.parcelRef || ''} ${what}`,
    html: plainWrap(`
      <h2 style="margin:0 0 8px">${esc(who.ref)}: parcel ${esc(parcel?.parcelRef || '?')} ${what}</h2>
      ${table(`
        <tr><th align="left">Status</th><td>${esc(event.status || '')} (${esc(event.statusCode ?? '')})</td></tr>
        <tr><th align="left">Carrier says</th><td>${esc(event.carrierStatus || '—')}</td></tr>
        <tr><th align="left">Tracking</th><td>${event.trackingUrl ? `<a href="${esc(event.trackingUrl)}">${esc(event.trackingNumber || 'link')}</a>` : esc(event.trackingNumber || '—')}</td></tr>
        <tr><th align="left">Customer</th><td>${esc(who.name || '')} &lt;${esc(who.email || '')}&gt;</td></tr>
        <tr><th align="left">At</th><td>${esc(event.at || '')}</td></tr>`)}
      <p>Nothing has been sent to the customer about this.</p>
      <p><a href="${esc(studioLink(who.id, 'order'))}">Open the order in the Studio</a></p>`),
  };
}

/* ------------------------------------------------------------------ team: returns */

const returnLinesTable = (ret) => table(
  `<tr style="background:#f3f3f3"><th>Item</th><th>Format / size</th><th>Qty</th><th>Price</th></tr>`
  + (ret.lines || []).map((l) => `<tr><td>${esc(l.title)}${l.fulfilment === 'printful' ? ' <span style="color:#777">(merchandise)</span>' : ''}</td><td>${esc([l.format, l.size].filter(Boolean).join(' / '))}</td>
    <td>${esc(l.quantity)}</td><td>${money((l.unitPrice || 0) * (l.quantity || 1))}</td></tr>`).join(''));

export function newReturnEmail(ret) {
  const flags = [
    ret.deliveryDateUnknown ? `<p style="background:#fff8e1;border-left:4px solid #f0a500;padding:10px 12px"><strong>Delivery date unknown.</strong> This order has no recorded delivery, so the ${RETURN_WINDOW_DAYS}-day window could not be checked. Judge it yourself before approving.</p>` : '',
    ret.underwear ? '<p style="background:#fff8e1;border-left:4px solid #f0a500;padding:10px 12px"><strong>Underwear.</strong> Check hygiene before accepting it back.</p>' : '',
  ].join('');
  return {
    ...toTeam(),
    subject: `${testTag()}↩️ ${brand()} return request ${ret.returnNumber} — ${ret.customerName || ''}${ret.deliveryDateUnknown ? ' — ⚠ delivery date unknown' : ''}`,
    html: plainWrap(`
      <h2 style="margin:0 0 8px">${esc(brand())} return request ${esc(ret.returnNumber)}</h2>
      <p>Order <strong>${esc(ret.orderNumber)}</strong> — ${esc(ret.customerName || '')} &lt;${esc(ret.customerEmail || '')}&gt;</p>
      ${returnLinesTable(ret)}
      <p><strong>Reason:</strong> ${esc(ret.reasonLabel || ret.reason || '')}</p>
      ${ret.customerNotes ? `<p><strong>Notes:</strong></p><p style="white-space:pre-wrap;background:#f7f7f7;padding:8px 10px">${esc(ret.customerNotes)}</p>` : ''}
      ${ret.quotedPostage != null ? `<p>The customer was shown <strong>${money(ret.quotedPostage)}</strong> return postage before submitting.</p>` : ''}
      ${ret.deliveredAt ? `<p>Delivered ${esc(dateOnly(ret.deliveredAt))}; the ${RETURN_WINDOW_DAYS} days to ask run to ${esc(ret.windowEndsOn || '')}.</p>` : ''}
      ${ret.shippedAt ? `<p>Merchandise: Printful shipped it ${esc(dateOnly(ret.shippedAt))}; the ${MERCH_WINDOW_DAYS} days to ask run to ${esc(ret.windowEndsOn || '')}.</p>` : ''}
      ${ret.shipDateUnknown ? `<p style="background:#fff8e1;border-left:4px solid #f0a500;padding:10px 12px"><strong>Printful ship date unknown.</strong> The window was counted from the order date. Check the date in Printful before approving.</p>` : ''}
      ${ret.packingNote ? `<p style="background:#fff8e1;border-left:4px solid #f0a500;padding:10px 12px"><strong>Parcel:</strong> ${esc(ret.packingNote)}</p>` : ''}
      ${flags}
      ${ret.band ? '' : '<p><strong>Choose the parcel band</strong> before approving (more than one item, or a mix).</p>'}
      <p>Approve or reject it in the Studio. Approving buys the return label and emails it to the customer; the return postage is deducted from their refund (refunds stay manual in Stripe).</p>
      <p><a href="${esc(studioLink(ret._id, 'returnRequest'))}">Open the return in the Studio</a></p>`),
  };
}

export function returnProblemEmail(ret, reason) {
  return {
    ...toTeam(),
    subject: `${testTag()}⚠ ${brand()} ${ret.type === 'printfulClaim' ? 'Printful claim' : 'return'} ${ret.returnNumber || ret._id}: ${ret.type === 'printfulClaim' ? 'customer not emailed' : 'no label sent'}`,
    html: plainWrap(`
      <h2 style="margin:0 0 8px">${ret.type === 'printfulClaim' ? 'Claim not actioned' : 'No return label'} for ${esc(ret.returnNumber || ret._id)}</h2>
      <p style="background:#fff3f3;border-left:4px solid #c00;padding:10px 12px;white-space:pre-wrap">${esc(reason)}</p>
      <p>The customer has not been emailed. Fix it in the Studio (a band, usually), then set the status to Requested and back to Approved to try again.</p>
      <p><a href="${esc(studioLink(ret._id, 'returnRequest'))}">Open the return in the Studio</a></p>`),
  };
}

export function returnAlertEmail(ret, event, kind) {
  const what = kind === 'returned_to_sender' ? 'is going back to the customer' : 'has a carrier problem';
  return {
    ...toTeam(),
    subject: `${testTag()}⚠ ${brand()} return ${ret.returnNumber || ret._id} ${what}`,
    html: plainWrap(`
      <h2 style="margin:0 0 8px">Return ${esc(ret.returnNumber || ret._id)} ${what}</h2>
      ${table(`
        <tr><th align="left">Status</th><td>${esc(event?.status || '')} (${esc(event?.statusCode ?? '')})</td></tr>
        <tr><th align="left">Carrier says</th><td>${esc(event?.carrierStatus || '—')}</td></tr>
        <tr><th align="left">Tracking</th><td>${event?.trackingUrl ? `<a href="${esc(event.trackingUrl)}">${esc(ret.trackingNumber || 'link')}</a>` : esc(ret.trackingNumber || '—')}</td></tr>
        <tr><th align="left">Customer</th><td>${esc(ret.customerName || '')} &lt;${esc(ret.customerEmail || '')}&gt;</td></tr>`)}
      <p>Nothing has been sent to the customer about this.</p>
      <p><a href="${esc(studioLink(ret._id, 'returnRequest'))}">Open the return in the Studio</a></p>`),
  };
}

/** Which point a return went to. Team email only -- never shown to a customer. */
export function collectionPoint(carrier) {
  const s = String(carrier || '').toLowerCase();
  if (s.startsWith('inpost')) return setting('RETURN_POINT_INPOST');
  if (s.startsWith('hermes') || s.startsWith('evri')) return setting('RETURN_POINT_EVRI');
  if (s.startsWith('ups')) return setting('RETURN_POINT_UPS');
  return `the ${carrierName(carrier)} return point set on the shipping service`;
}

export function returnReadyEmail(ret, event) {
  return {
    ...toTeam(),
    subject: `${testTag()}📬 ${brand()} return ${ret.returnNumber} is ready to collect — ${carrierName(ret.carrier)}`,
    html: plainWrap(`
      <h2 style="margin:0 0 8px">Return ${esc(ret.returnNumber)} is waiting to be collected</h2>
      <p><strong>Collect from:</strong> ${esc(collectionPoint(ret.carrier))}</p>
      ${table(`
        <tr><th align="left">Carrier</th><td>${esc(carrierName(ret.carrier))}</td></tr>
        <tr><th align="left">Tracking</th><td>${event?.trackingUrl ? `<a href="${esc(event.trackingUrl)}">${esc(ret.trackingNumber || 'link')}</a>` : esc(ret.trackingNumber || '—')}</td></tr>
        <tr><th align="left">Status</th><td>${esc(event?.status || '')}</td></tr>`)}
      ${returnLinesTable(ret)}
      <p>Mark it Received in the Studio once you have it, and refund in Stripe${ret.freeLabel ? '' : ` less the ${ret.postageDeduction != null ? money(ret.postageDeduction) : 'label cost (see Sendcloud: the service gave no price)'} return postage`}.</p>
      <p><a href="${esc(studioLink(ret._id, 'returnRequest'))}">Open the return in the Studio</a></p>`),
  };
}

/* ------------------------------------------------------------------ customer: returns */

export function returnLabelEmail(ret, { pdf, instructions, postage }, b = brandLook()) {
  const p = (s) => `<p style="margin: 0 0 14px;">${s}</p>`;
  const box = (s) => `<div style="white-space: pre-wrap; border-left: 3px solid ${esc(b.accent)}; padding: 12px 14px; margin: 0 0 14px;">${s}</div>`;
  const deduction = ret.freeLabel ? '' : box(`<strong>${
    postage != null ? `${money(postage)} return postage will be deducted from your refund.` : 'The cost of this return label will be deducted from your refund.'}</strong>`);
  const items = (ret.lines || []).map((l) => `<li>${esc(l.title)} × ${esc(l.quantity)}</li>`).join('');
  return {
    to: [ret.customerEmail],
    subject: `${testTag()}Your ${brand()} return label — ${ret.returnNumber}`,
    attachments: [{ filename: `return-label-${String(ret.returnNumber || 'label').replace(/[^\w-]/g, '')}.pdf`, content: pdf.toString('base64') }],
    html: brandCard('Your return label is attached', `
      ${p(`Hi ${esc(String(ret.customerName || '').split(' ')[0] || 'there')}, we've approved your return for order <strong>${esc(ret.orderNumber)}</strong>. Your label is attached to this email as a PDF.`)}
      <ul style="margin: 0 0 14px; padding-left: 20px;">${items}</ul>
      <p style="margin:22px 0 8px;font-size:11px;letter-spacing:1px;color:${esc(b.muted)};text-transform:uppercase;">How to send it</p>
      ${box(esc(instructions || ''))}
      ${ret.trackingNumber ? p(`Tracking number: <strong>${esc(ret.trackingNumber)}</strong>`) : ''}
      ${deduction}
      ${ret.freeLabel
        ? p("This label is free: you don't pay anything to send it back.")
        : p('Pack it securely in its original tube or box. We refund to your original payment method within 14 days of receiving it back.')}
      <p style="margin-top: 20px; font-size: 12px; color:${esc(b.muted)};">Return reference: <strong>${esc(ret.returnNumber)}</strong></p>`, b),
  };
}

export function returnDeclinedEmail(ret, b = brandLook()) {
  const p = (s) => `<p style="margin: 0 0 14px;">${s}</p>`;
  return {
    to: [ret.customerEmail],
    subject: `${testTag()}About your ${brand()} ${ret.type === 'printfulClaim' ? 'report' : 'return request'} ${ret.returnNumber}`,
    html: brandCard(ret.type === 'printfulClaim' ? 'About your report' : 'About your return request', `
      ${p(`Hi ${esc(String(ret.customerName || '').split(' ')[0] || 'there')}, thanks for getting in touch about order <strong>${esc(ret.orderNumber)}</strong>.`)}
      ${p(ret.type === 'printfulClaim' ? "We're sorry, but we can't replace this item:" : "We're sorry, but we can't accept this return:")}
      <div style="white-space: pre-wrap; border-left: 3px solid ${esc(b.accent)}; padding: 12px 14px; margin: 0 0 14px;">${esc(ret.rejectionReason || '')}</div>
      ${ret.type === 'printfulClaim'
        ? p('If you have more photos or details, reply to this email and we will look again.')
        : p("If your item arrived faulty, damaged or not as described, your rights are not affected — reply to this email with your order reference and some photos, and we'll put it right.")}
      <p style="margin-top: 20px; font-size: 12px; color:${esc(b.muted)};">Return reference: ${esc(ret.returnNumber)}</p>`, b),
  };
}

/* ------------------------------------------------------------------ Printful claims */

const firstName = (ret) => esc(String(ret.customerName || '').split(' ')[0] || 'there');
const itemList = (ret) => `<ul style="margin: 0 0 14px; padding-left: 20px;">${(ret.lines || []).map((l) => `<li>${esc(l.title)} × ${esc(l.quantity)}</li>`).join('')}</ul>`;

/** Team: a faulty / damaged Printful item was reported. Nothing is posted back. */
export function newClaimEmail(ret) {
  const deadline = ret.claimDeadline ? longDateOf(ret.claimDeadline) : '';
  const late = ret.claimOverdue
    ? `<p style="background:#fff3f3;border-left:4px solid #c00;padding:10px 12px"><strong>Past Printful's deadline.</strong> Printful's ${PRINTFUL_CLAIM_DAYS} days ended on ${esc(deadline)}. Try Printful anyway, or put it right yourself.</p>`
    : '';
  const unknown = ret.shipDateUnknown || !ret.claimDeadline
    ? `<p style="background:#fff8e1;border-left:4px solid #f0a500;padding:10px 12px"><strong>Ship date unknown.</strong> Check the date in Printful: their claim window is ${PRINTFUL_CLAIM_DAYS} days from shipping.</p>`
    : '';
  return {
    ...toTeam(),
    subject: `${testTag()}🧵 ${brand()} Printful claim ${ret.returnNumber} — ${ret.customerName || ''}${deadline ? ` — claim by ${deadline}` : ''}`,
    html: plainWrap(`
      <h2 style="margin:0 0 8px">${esc(brand())} Printful claim ${esc(ret.returnNumber)}</h2>
      <p>Order <strong>${esc(ret.orderNumber)}</strong> — ${esc(ret.customerName || '')} &lt;${esc(ret.customerEmail || '')}&gt;</p>
      ${table(`
        <tr><th align="left">Printful order</th><td>${ret.printfulOrderId ? `#${esc(ret.printfulOrderId)}` : '<strong>not recorded</strong> — find it in Printful by the customer'}</td></tr>
        <tr><th align="left">Shipped</th><td>${esc(dateOnly(ret.shippedAt) || 'unknown')}</td></tr>
        <tr><th align="left">Claim with Printful by</th><td><strong>${esc(deadline || 'check in Printful')}</strong></td></tr>`)}
      ${returnLinesTable(ret)}
      <p><strong>Reason:</strong> ${esc(ret.reasonLabel || '')}</p>
      ${ret.customerNotes ? `<p><strong>What they said:</strong></p><p style="white-space:pre-wrap;background:#f7f7f7;padding:8px 10px">${esc(ret.customerNotes)}</p>` : ''}
      ${late}${unknown}
      <p>No return label: nothing comes back. The customer has been asked to reply to their confirmation email with a photo; it will arrive in the brand inbox.</p>
      <ol>
        <li>When the photo is in, report it in Printful (Orders → the order → Report a problem) before the date above.</li>
        <li>In the Studio, approve the claim. The customer is emailed that a replacement is on its way. To refund instead, choose "Refund instead" before approving (the refund itself is made by hand in Stripe).</li>
      </ol>
      <p><a href="${esc(studioLink(ret._id, 'returnRequest'))}">Open the claim in the Studio</a></p>`),
  };
}

/** Customer, at once: we have it; reply with a photo; nothing to send back. */
export function claimReceivedEmail(ret, b = brandLook()) {
  const p = (s) => `<p style="margin: 0 0 14px;">${s}</p>`;
  return {
    to: [ret.customerEmail],
    subject: `${testTag()}Your ${brand()} report ${ret.returnNumber}: please reply with a photo`,
    html: brandCard("Sorry about that — we're on it", `
      ${p(`Hi ${firstName(ret)}, thanks for letting us know about a problem with order <strong>${esc(ret.orderNumber)}</strong>:`)}
      ${itemList(ret)}
      <div style="border-left: 3px solid ${esc(b.accent)}; padding: 12px 14px; margin: 0 0 14px;"><strong>Please reply to this email with a photo of the problem</strong> (and of the packaging, if it arrived damaged).</div>
      ${p("You don't need to send anything back. Once we've seen the photo we'll arrange a replacement and email you when it's on its way.")}
      <p style="margin-top: 20px; font-size: 12px; color:${esc(b.muted)};">Reference: <strong>${esc(ret.returnNumber)}</strong></p>`, b),
  };
}

/** Customer, on approval: the replacement is on its way (no refund). */
export function claimReplacementEmail(ret, b = brandLook()) {
  const p = (s) => `<p style="margin: 0 0 14px;">${s}</p>`;
  return {
    to: [ret.customerEmail],
    subject: `${testTag()}Your ${brand()} replacement is on its way — ${ret.returnNumber}`,
    html: brandCard('Your replacement is on its way', `
      ${p(`Hi ${firstName(ret)}, thanks for the photo. We're sorry the item from order <strong>${esc(ret.orderNumber)}</strong> wasn't right, and a replacement is on its way:`)}
      ${itemList(ret)}
      ${p("It's made to order, so allow a few days for it to be printed. There's nothing to send back and nothing to pay.")}
      <p style="margin-top: 20px; font-size: 12px; color:${esc(b.muted)};">Reference: <strong>${esc(ret.returnNumber)}</strong></p>`, b),
  };
}

/** Customer, on approval with "Refund instead": a refund rather than a replacement. */
export function claimRefundEmail(ret, b = brandLook()) {
  const p = (s) => `<p style="margin: 0 0 14px;">${s}</p>`;
  const amount = Number(ret.refundAmount);
  return {
    to: [ret.customerEmail],
    subject: `${testTag()}Your ${brand()} refund — ${ret.returnNumber}`,
    html: brandCard("We're refunding you", `
      ${p(`Hi ${firstName(ret)}, thanks for the photo. We're sorry the item from order <strong>${esc(ret.orderNumber)}</strong> wasn't right:`)}
      ${itemList(ret)}
      ${p(`Instead of a replacement, we're refunding ${Number.isFinite(amount) && amount > 0 ? `<strong>${money(amount)}</strong>` : 'you'} to your original payment method. You'll have it within 14 days. There's nothing to send back.`)}
      <p style="margin-top: 20px; font-size: 12px; color:${esc(b.muted)};">Reference: <strong>${esc(ret.returnNumber)}</strong></p>`, b),
  };
}
