/**
 * The customer's "your wall art is on its way" email -- the ONLY place it is
 * sent from.
 *
 * Merchandise is not here: Printful posts it and printful-webhook.mjs sends
 * its own "It's shipped" email per package. This email lists the wall-art
 * lines only and, on a mixed order, says the other items travel separately
 * with their own tracking email, so the two never contradict each other.
 * (printful-webhook's email says the same the other way round.)
 *
 * Who decides the wall art has shipped:
 *   - sanity-orders-webhook, when Alan dispatches by hand: In-house Status set
 *     to Dispatched with a wall-art tracking number. This works whether or not
 *     SHIPPING_ENABLED is set (wall art had no dispatch email at all before);
 *   - shipping-event, at a Sendcloud parcel's first carrier scan.
 *
 * ONCE ONLY. Before sending, the order is claimed: dispatchEmailClaimedAt is
 * written with ifRevisionId set to the revision just read, so of two callers
 * racing exactly one write lands and the other re-reads and sees the claim.
 * The claim is given back if the send fails (a later event retries), and a
 * claim older than CLAIM_TTL_MS is treated as abandoned. dispatchEmailSentAt
 * marks it sent. Both are server fields, written to the draft too
 * (server-patch.mjs).
 *
 * The wall-art carrier and tracking number are their own fields
 * (wallArtCarrier, wallArtTrackingNumber): the order's carrier and
 * trackingNumber are Printful's.
 *
 * AFTER THE EMAIL. afterDispatchEmail() runs once, after the send is marked,
 * on both paths above: it starts the post-delivery sequence
 * (post-delivery.mjs), which runs once per order whichever of this email and
 * Printful's "It's shipped" comes first. It never throws and never touches
 * the email already sent.
 */
import { readDecideWrite, serverPatch } from './server-patch.mjs';
import { carrierName, trackingUrlFor, isWallArtLine, isClothingLine } from './parcel-plan.mjs';
import { orderRefFor } from './order-ref.mjs';
import { setting } from './site-config.mjs';
import { startPostDelivery } from './post-delivery.mjs';
import { readableOn } from './readable-colour.mjs';

export const CLAIM_TTL_MS = 10 * 60 * 1000;

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Only http(s) links go in a button or an <img>; anything else is dropped. */
export const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');

/** Parcels the shipping service made that have something to track. */
export const trackedParcels = (doc) =>
  (doc?.shipmentResult?.parcels || []).filter((p) => p && (p.trackingNumber || p.trackingUrl));

export const MIXED_ORDER_NOTE = 'Your other items are made by our production partner and ship separately, with their own tracking email.';

/* ------------------------------------------------------------------ template */

/** The brand's email palette and names (site-config.mjs). */
export function brandLook(env = process.env) {
  const s = (k) => setting(k, env);
  return {
    name: s('BRAND_NAME'), short: s('BRAND_SHORT'), host: s('SITE_HOST'), site: s('SITE_URL'),
    logo: safeUrl(s('LOGO_URL')), accent: s('BRAND_ACCENT'), headerBg: s('EMAIL_HEADER_BG'),
    pageBg: s('EMAIL_PAGE_BG'), cardBg: s('EMAIL_CARD_BG'), heading: s('EMAIL_HEADING'),
    text: s('EMAIL_TEXT'), muted: s('EMAIL_MUTED'), rule: s('EMAIL_RULE'), buttonText: s('EMAIL_BUTTON_TEXT'),
  };
}

/**
 * The colours text is actually drawn in, from a brandLook(): each brand colour
 * moved to the nearest shade of its own hue that reads on what it sits on
 * (WCAG AA, readable-colour.mjs). The palette can be overridden from the
 * environment, so this is worked out at render time, never assumed.
 *   accent        the accent as text on the card (order refs, links)
 *   headerAccent  the accent as text on the header colour (the no-logo wordmark)
 *   button        a button's background, so its EMAIL_BUTTON_TEXT label reads
 *   text, heading, muted  body copy, headings and small print on the card
 * Borders and rules keep the brand colour as it is.
 */
export function emailInk(b = brandLook()) {
  const card = b.cardBg || '#ffffff';
  return {
    accent: readableOn(b.accent, card),
    headerAccent: readableOn(b.accent, b.headerBg || card),
    button: readableOn(b.accent, b.buttonText || '#ffffff'),
    text: readableOn(b.text, card),
    heading: readableOn(b.heading, card),
    muted: readableOn(b.muted, card),
  };
}

/**
 * The brand's customer email card -- the same frame as printful-webhook's
 * "It's shipped" email: logo header, bordered card, heading, footer line.
 */
export function brandCard(title, inner, b = brandLook()) {
  const ink = emailInk(b);
  const header = b.logo
    ? `<img src="${esc(b.logo)}" alt="${esc(b.name)}" width="240" style="max-width:240px;width:240px;height:auto;display:inline-block;border:0;" />`
    : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:3px;color:${esc(ink.headerAccent)};text-transform:uppercase;">${esc(b.name)}</span>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:${esc(b.pageBg)};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${esc(b.pageBg)};padding:32px 16px;"><tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${esc(b.cardBg)};border:1px solid ${esc(b.accent)};">
        <tr><td style="background:${esc(b.headerBg)};padding:22px 28px;text-align:center;">${header}</td></tr>
        <tr><td style="padding:32px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:${esc(ink.text)};">
          <h1 style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:24px;letter-spacing:1px;color:${esc(ink.heading)};text-transform:uppercase;">${title}</h1>
          ${inner}
          <p style="margin:24px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:${esc(ink.muted)};border-top:1px solid ${esc(b.rule)};padding-top:16px;">
            ${esc(b.name)} · <a href="${esc(b.site)}" style="color:${esc(ink.accent)};text-decoration:none;">${esc(b.host)}</a>. Questions? Just reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
}

/** A button in the brand's accent (a shade its label reads on: emailInk().button). */
export const brandButton = (href, label, b = brandLook()) => `<a href="${esc(href)}" style="display:inline-block;margin-top:8px;padding:12px 26px;background:${esc(emailInk(b).button)};color:${esc(b.buttonText)};font-family:Arial,Helvetica,sans-serif;font-weight:700;text-transform:uppercase;letter-spacing:1px;text-decoration:none;border-radius:3px;font-size:14px;">${esc(label)}</a>`;

/** The parcels to show: Sendcloud's, or the one entered by hand. */
function parcelsToShow(order) {
  const tracked = trackedParcels(order);
  if (tracked.length) {
    return tracked.map((p) => ({ carrierName: carrierName(p.carrier), trackingNumber: p.trackingNumber || '', trackingUrl: safeUrl(p.trackingUrl) || null }));
  }
  const number = String(order.wallArtTrackingNumber || '').trim();
  return [{
    carrierName: carrierName(order.wallArtCarrier, order.wallArtCarrierOther),
    trackingNumber: number,
    trackingUrl: trackingUrlFor(order.wallArtCarrier, number),
  }];
}

/**
 * One tracking block per parcel and the wall-art lines, in the brand's
 * "It's shipped" look.
 * @returns {{ subject: string, html: string }}
 */
export function buildDispatchEmail(order, b = brandLook()) {
  const ref = orderRefFor(order) || order._id;
  const parcels = parcelsToShow(order);
  const art = (order.items || []).filter(isWallArtLine);
  const mixed = (order.items || []).some(isClothingLine);
  const first = esc(String(order.customerName || '').split(' ')[0] || 'there');
  const ink = emailInk(b);
  const label = (t) => `<p style="margin:0 0 4px;font-size:11px;letter-spacing:1px;color:${esc(ink.muted)};text-transform:uppercase;">${t}</p>`;

  const blocks = parcels.map((p, i) => `
    <div style="margin:16px 0;padding:14px 16px;border-left:3px solid ${esc(b.accent)};">
      ${parcels.length > 1 ? label(`Parcel ${i + 1} of ${parcels.length}`) : ''}
      <p style="margin:0 0 6px;font-size:14px;">Carrier: <strong>${esc(p.carrierName)}</strong></p>
      ${p.trackingNumber ? `${label('Tracking number')}<p style="margin:0;font-size:16px;font-weight:700;">${esc(p.trackingNumber)}</p>` : ''}
      ${p.trackingUrl ? `<p style="margin:12px 0 0;">${brandButton(p.trackingUrl, `Track your wall art${parcels.length > 1 ? ` (${i + 1})` : ''}`, b)}</p>` : ''}
    </div>`).join('');

  const items = art.map((l) => `<li style="margin:4px 0;">${esc(l.title)}${Number(l.quantity) > 1 ? ` × ${esc(l.quantity)}` : ''}</li>`).join('');

  const inner = `
    <p style="margin:0 0 16px;font-size:14px;color:${esc(ink.muted)};">Order ref <strong style="color:${esc(ink.accent)};">${esc(ref)}</strong></p>
    <p style="margin:0 0 16px;">Hi ${first}. ${esc(setting('DISPATCH_LINE'))}${parcels.length > 1 ? ` in ${parcels.length} parcels` : ''}. Tracking's below; it can take a few hours to wake up.</p>
    ${items ? `${label('Wall art in this delivery')}<ul style="margin:0 0 8px;padding-left:18px;font-size:14px;">${items}</ul>` : ''}
    ${blocks}
    ${mixed ? `<p style="margin:16px 0 0;padding:12px 14px;border:1px solid ${esc(b.rule)};font-size:14px;">${esc(MIXED_ORDER_NOTE)}</p>` : ''}`;

  return {
    subject: `${order.test ? '[TEST] ' : ''}Your ${b.short} wall art is on its way — order ${ref}`,
    html: brandCard('Your wall art is on its way', inner, b),
  };
}

/* ------------------------------------------------------------------ when due */

/** Why an order's wall-art email is not due, or null when it is. Pure. */
export function orderNotDue(order) {
  if (!order || order._type !== 'order') return 'not an order';
  if (!order.hasInhouse && !(order.items || []).some(isWallArtLine)) return 'no wall art on this order';
  if (order.dispatchEmailSentAt) return 'already sent';
  if (!order.customerEmail) return 'no customer email';
  const byHand = order.inhouseStatus === 'dispatched' && String(order.wallArtTrackingNumber || '').trim();
  const scanned = Boolean(order.shipmentResult?.dispatchedAt) && trackedParcels(order).length > 0;
  if (!byHand && !scanned) {
    return order.inhouseStatus === 'dispatched' ? 'dispatched but no wall-art tracking number yet' : `wall art ${order.inhouseStatus || 'not dispatched'}`;
  }
  return null;
}

/* ------------------------------------------------------------------ sending */

/**
 * Hook for anything that must follow the dispatch email. Runs once per order,
 * after the send is marked, on every dispatch path. Never throws.
 * Starts the post-delivery sequence (wall art shipped first, unless Printful's
 * email already started it).
 */
export async function afterDispatchEmail(order, { log = console, sanity, start = startPostDelivery } = {}) {
  try {
    await start({ sanity, id: order?._id, trigger: 'wallart', log });
  } catch (err) {
    log.error(`dispatch-email: post-delivery start failed:`, err?.message || err);
  }
}

/**
 * Send the wall-art dispatch email for one order if, and only if, it is due
 * and nobody else is sending it.
 *
 * @returns {Promise<{ sent: boolean, status: number, reason: string }>}
 *   status is what a webhook handler should answer with (5xx = retry me).
 */
export async function sendDispatchEmail({ id, sanity, getResend, now = () => Date.now(), log = console, after = afterDispatchEmail }) {
  let skip = null;
  const claim = await readDecideWrite(sanity, id, (doc) => {
    const why = orderNotDue(doc);
    if (why) { skip = why; return null; }
    const claimedAt = Date.parse(doc.dispatchEmailClaimedAt || '');
    if (Number.isFinite(claimedAt) && now() - claimedAt < CLAIM_TTL_MS) { skip = 'being sent by another call'; return null; }
    return { set: { dispatchEmailClaimedAt: new Date(now()).toISOString() } };
  });
  if (!claim.written) return { sent: false, status: 200, reason: skip || 'nothing to do' };

  const doc = claim.doc;
  const name = orderRefFor(doc) || doc._id;
  const release = () => serverPatch(sanity, id, { unset: ['dispatchEmailClaimedAt'] }).catch((e) =>
    log.error(`dispatch-email: ${name}: could not release the claim:`, e?.message || e));

  const resend = getResend();
  if (!resend) {
    log.error(`dispatch-email: RESEND_API_KEY is not set — cannot email ${name}.`);
    await release();
    return { sent: false, status: 503, reason: 'RESEND_API_KEY is not set' };
  }

  const { subject, html } = buildDispatchEmail(doc);
  try {
    // Resend reports a refusal by RETURNING an error, not by throwing.
    const { error } = await resend.emails.send({
      from: setting('EMAIL_FROM'), reply_to: setting('EMAIL_REPLY_TO'), to: [doc.customerEmail], subject, html,
    });
    if (error) throw new Error(`${error.name || 'Error'}: ${error.message || 'Resend rejected the send'}`);
  } catch (err) {
    log.error(`dispatch-email: ${name}: send failed:`, err?.message || err);
    await release();
    return { sent: false, status: 500, reason: 'Email send failed (will retry)' };
  }

  const set = { dispatchEmailSentAt: new Date(now()).toISOString() };
  try {
    await serverPatch(sanity, id, { set, unset: ['dispatchEmailClaimedAt'] });
  } catch (err) {
    // The email has gone: try the marker once more, plainly, and answer 200
    // rather than invite a duplicate. The claim still blocks for CLAIM_TTL_MS.
    log.error(`dispatch-email: ${name}: sent but could not be marked:`, err?.message || err);
    await sanity.patch(id).set(set).commit().catch(() => {});
  }
  log.log(`dispatch-email: ${name} emailed`);
  try { await after({ ...doc, ...set }, { log, sanity }); } catch (err) { log.error(`dispatch-email: ${name}: after-send step failed:`, err?.message || err); }
  return { sent: true, status: 200, reason: 'OK' };
}
