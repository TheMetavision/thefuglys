/**
 * netlify/functions/stripe-webhook.cjs  (The Fuglys — email + Sanity order log)
 *
 * On checkout.session.completed:
 *   1. Verify the Stripe signature (STRIPE_WEBHOOK_SECRET).
 *   2. BRAND GUARD — skip (200) unless session.metadata.brand === BRAND_KEY.
 *      All four IP brands share one Stripe account and Stripe broadcasts every
 *      event to every endpoint; without this, each brand processes the others'
 *      orders. Requires the checkout to stamp metadata.brand — deploy together.
 *   3. Email the customer a branded order confirmation (RESEND_API_KEY).
 *      Skipped on a retry for an order already in the Sanity log, as is the
 *      merchant alert, so Stripe retries don't resend either.
 *   4. Create the Printful order (PRINTFUL_API_KEY), idempotent via external_id.
 *   5. Write an `order` document to Sanity (SANITY_API_TOKEN, else SANITY_TOKEN) with status of
 *      fulfilled / inhouse / fulfilment-failed / paid. A Stripe retry updates
 *      the payment fields only (see saveOrder).
 *   6. Send a GA4 Measurement Protocol purchase (src/lib/ga4-purchase.cjs) if
 *      the shopper accepted analytics. Skipped on Stripe retries: an order
 *      already in the Sanity log before this attempt means it was sent.
 *
 * Steps 3–6 are each non-fatal: a failure in one never blocks the others or
 * the 200 back to Stripe.
 *
 * Env vars:
 *   STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, PRINTFUL_API_KEY
 *   RESEND_API_KEY        — Resend key (FROM domain must be verified in it)
 *   ORDER_EMAIL_FROM      — optional; default "The Fuglys <orders@thefuglys.com>"
 *   LOGO_URL, EMAIL_HEADER_BG — optional branding for the email header
 *   BRAND_ACCENT          — optional accent colour (EMAIL_ACCENT is the fallback name;
 *                           default #99132F, the site's --color-accent);
 *                           printful-webhook's shipped email reads the same pair
 *   NOTIFICATION_FROM, ORDER_NOTIFICATION_TO / NOTIFICATION_TO — merchant alert
 *   SANITY_API_TOKEN      — Sanity *write* (Editor) token for the order log
 *                           (the name the site and Netlify use; SANITY_TOKEN still works as a fallback)
 *   SANITY_PROJECT_ID     — optional; default ngx60q2x
 *   SANITY_DATASET        — optional; default production
 *   GA4_MEASUREMENT_ID, GA4_API_SECRET — optional; server-side purchase event
 *
 * Must be named stripe-webhook.cjs (CommonJS in a "type": "module" repo); delete any stale duplicate.
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/* Brand guard: all four IP brands share one Stripe account, and Stripe sends
   every event to every registered webhook endpoint. Only process sessions the
   checkout stamped with our brand key (src/lib/brand-guard.cjs, shared with
   create-checkout so the two cannot drift). */
const { BRAND_KEY, isOurSession } = require('../../src/lib/brand-guard.cjs');
const { sendPurchase } = require('../../src/lib/ga4-purchase.cjs');

const PRINTFUL_ORDERS_URL = 'https://api.printful.com/orders';
const RESEND_URL = 'https://api.resend.com/emails';
const FROM = process.env.ORDER_EMAIL_FROM || 'The Fuglys <orders@thefuglys.com>';
const LOGO_URL = process.env.LOGO_URL || '';
const HEADER_BG = process.env.EMAIL_HEADER_BG || '#263F44';
// Same source as the shipped email in printful-webhook.mjs.
const ACCENT = process.env.BRAND_ACCENT || process.env.EMAIL_ACCENT || '#99132F';
const MERCHANT_TO = process.env.ORDER_NOTIFICATION_TO || process.env.NOTIFICATION_TO || '';
const MERCHANT_FROM = process.env.NOTIFICATION_FROM || 'The Fuglys <orders@thefuglys.com>';
const SANITY_PROJECT_ID = process.env.SANITY_PROJECT_ID || 'ngx60q2x';
const SANITY_DATASET = process.env.SANITY_DATASET || 'production';
const SANITY_API_VER = '2024-01-01';
// Read per call: SANITY_API_TOKEN is the name Netlify and the site use; SANITY_TOKEN is the older one.
const sanityWriteToken = () => process.env.SANITY_API_TOKEN || process.env.SANITY_TOKEN || '';

// Shared wall-art helper (same module the checkout uses; single source of truth).
// Path assumes netlify/functions/ -> src/lib/. Adjust if your lib lives elsewhere.
const { artworkVariantLabel } = require('../../src/lib/artwork-pricing.mjs');

function readVariantId(lineItem) {
  const product = lineItem.price && lineItem.price.product;
  const fromProduct =
    product && typeof product === 'object' && product.metadata
      ? product.metadata.printful_variant_id
      : undefined;
  const fromPrice =
    lineItem.price && lineItem.price.metadata
      ? lineItem.price.metadata.printful_variant_id
      : undefined;
  return fromProduct || fromPrice || null;
}
function meta(lineItem, key) {
  const p = lineItem.price && lineItem.price.product;
  return p && typeof p === 'object' && p.metadata ? p.metadata[key] : undefined;
}

/* A wall-art line is one the checkout stamped with fulfilment:'inhouse'. These
   are made & dispatched BY US — never sent to Printful. */
function isInhouse(lineItem) {
  return meta(lineItem, 'fulfilment') === 'inhouse';
}
/* Pretty "Canvas — Gallery Frame · Large (24 x 16")" label for the owner email
   and order log, falling back to the Stripe line description. */
function inhouseLineLabel(lineItem) {
  const fmt = meta(lineItem, 'wallart_format');
  const size = meta(lineItem, 'wallart_size');
  if (fmt && size) {
    try { return artworkVariantLabel(fmt, size); } catch (_) { /* fall through */ }
  }
  return lineItem.description || 'Wall art';
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const gbp = (pence) => `£${((pence || 0) / 100).toFixed(2)}`;

function getShip(session) {
  return session.shipping_details
    || (session.collected_information && session.collected_information.shipping_details)
    || null;
}

function buildOrderEmailHtml(session, lineItems) {
  const ref = String(session.id).slice(-8).toUpperCase();
  const ship = getShip(session);
  const a = ship && ship.address ? ship.address : null;
  const addrLines = a
    ? [ship.name, a.line1, a.line2, a.city, [a.state, a.postal_code].filter(Boolean).join(' '), a.country]
        .filter(Boolean).map(esc).join('<br>')
    : 'On file with your payment';

  const rows = (lineItems.data || []).map((li) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #2e4a51;color:#ffffff;font-size:14px;">${esc(li.description)}</td>
      <td style="padding:12px 0;border-bottom:1px solid #2e4a51;color:#9aa8aa;font-size:14px;text-align:center;">${li.quantity || 1}</td>
      <td style="padding:12px 0;border-bottom:1px solid #2e4a51;color:${ACCENT};font-size:14px;text-align:right;font-weight:700;">${gbp(li.amount_total)}</td>
    </tr>`).join('');

  const shipCost = session.shipping_cost ? gbp(session.shipping_cost.amount_total) : null;

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#16262b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#16262b;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#1e3238;border:1px solid ${ACCENT};">
        <tr><td style="background:${HEADER_BG};padding:22px 28px;text-align:center;">
          ${LOGO_URL
            ? `<img src="${LOGO_URL}" alt="The Fuglys" width="240" style="max-width:240px;width:240px;height:auto;display:inline-block;border:0;" />`
            : `<span style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;letter-spacing:3px;color:${ACCENT};text-transform:uppercase;">The Fuglys</span>`}
        </td></tr>
        <tr><td style="padding:32px 28px 8px;">
          <h1 style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:24px;letter-spacing:1px;color:#ffffff;text-transform:uppercase;">Order locked in</h1>
          <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#9aa8aa;">Order ref <strong style="color:${ACCENT};">#${ref}</strong></p>
          <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#c4d0d1;">
            Thanks for the haul. Your gear's heading into production — we'll send tracking the moment it ships out of the wasteland.
          </p>
        </td></tr>
        <tr><td style="padding:0 28px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <th align="left" style="padding:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#9aa8aa;text-transform:uppercase;">Item</th>
              <th align="center" style="padding:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#9aa8aa;text-transform:uppercase;">Qty</th>
              <th align="right" style="padding:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#9aa8aa;text-transform:uppercase;">Price</th>
            </tr>
            ${rows}
          </table>
        </td></tr>
        <tr><td style="padding:16px 28px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            ${shipCost ? `<tr><td style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#9aa8aa;padding:4px 0;">Shipping</td><td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#ffffff;padding:4px 0;">${shipCost}</td></tr>` : ''}
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:800;color:#ffffff;text-transform:uppercase;letter-spacing:1px;padding:10px 0 0;">Total</td>
              <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;color:${ACCENT};padding:10px 0 0;">${gbp(session.amount_total)}</td>
            </tr>
          </table>
        </td></tr>
        <tr><td style="padding:24px 28px 0;">
          <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:1px;color:#9aa8aa;text-transform:uppercase;">Shipping to</p>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#ffffff;">${addrLines}</p>
        </td></tr>
        <tr><td style="padding:28px;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#7e9093;border-top:1px solid #2e4a51;padding-top:16px;">
            The Fuglys — printed &amp; shipped on demand. Questions? Just reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendCustomerEmail(session, lineItems) {
  if (!process.env.RESEND_API_KEY) {
    console.warn(`[EMAIL-SKIP] session ${session.id}: RESEND_API_KEY not set.`);
    return;
  }
  const to = session.customer_details && session.customer_details.email;
  if (!to) {
    console.warn(`[EMAIL-SKIP] session ${session.id}: no customer email on session.`);
    return;
  }
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.RESEND_API_KEY },
      body: JSON.stringify({
        from: FROM,
        to,
        subject: 'Your Fuglys order is locked in',
        html: buildOrderEmailHtml(session, lineItems),
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error(`[EMAIL-FAIL] session ${session.id}: Resend ${res.status} — ${t}`);
    } else {
      console.log(`[EMAIL-OK] session ${session.id}: confirmation sent to ${to}.`);
    }
  } catch (err) {
    console.error(`[EMAIL-FAIL] session ${session.id}:`, err && err.message ? err.message : err);
  }
}

/* Internal heads-up to the shop owner. Fulfilment-aware: shouts loudly when an
   order did NOT reach Printful so it can be placed manually. Never fatal. */
async function sendMerchantEmail(session, lineItems, status, printfulOrderId) {
  if (!process.env.RESEND_API_KEY) return; // already warned via the customer email
  if (!MERCHANT_TO) {
    console.warn(`[MERCHANT-SKIP] session ${session.id}: no ORDER_NOTIFICATION_TO / NOTIFICATION_TO set.`);
    return;
  }
  const ref = String(session.id).slice(-8).toUpperCase();
  const ship = getShip(session);
  const a = ship && ship.address ? ship.address : null;
  const addrLines = a
    ? [ship.name, a.line1, a.line2, a.city, [a.state, a.postal_code].filter(Boolean).join(' '), a.country]
        .filter(Boolean).map(esc).join('<br>')
    : 'On file with payment';
  const cust = session.customer_details || {};
  const rows = (lineItems.data || []).map((li) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;font-size:14px;">${esc(li.description)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;font-size:14px;text-align:center;">${li.quantity || 1}</td>
      <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;font-size:14px;text-align:right;">${gbp(li.amount_total)}</td>
    </tr>`).join('');
  const failed = status === 'fulfilment-failed';
  const inhouseLis = (lineItems.data || []).filter(isInhouse);
  const hasInhouse = inhouseLis.length > 0;
  const inhouseOnly = status === 'inhouse';
  const banner = failed
    ? `<p style="background:#b00020;color:#fff;padding:12px 16px;border-radius:6px;font-weight:700;font-size:14px;margin:0 0 16px;">&#9888; FULFILMENT FAILED &mdash; this order did NOT reach Printful. Place it manually.</p>`
    : inhouseOnly
      ? `<p style="background:#1d4ed8;color:#fff;padding:12px 16px;border-radius:6px;font-weight:700;font-size:14px;margin:0 0 16px;">&#128230; IN-HOUSE ORDER &mdash; make &amp; dispatch the wall art below. No Printful order; nothing auto-ships.</p>`
      : `<p style="background:#0a7d28;color:#fff;padding:12px 16px;border-radius:6px;font-weight:700;font-size:14px;margin:0 0 16px;">&#10003; Sent to Printful${printfulOrderId ? ' (#' + esc(printfulOrderId) + ')' : ''}</p>`;
  // In-house "make & dispatch" block (shown for in-house-only AND mixed carts).
  const inhouseRows = inhouseLis.map((li) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;font-size:14px;">${esc(li.description || 'Wall art')}<br><span style="color:#555;font-size:12px;">${esc(inhouseLineLabel(li))}</span></td>
      <td style="padding:8px 0;border-bottom:1px solid #e5e5e5;font-size:14px;text-align:center;">${li.quantity || 1}</td>
    </tr>`).join('');
  const inhouseSection = hasInhouse ? `
          <div style="margin:0 0 16px;border:2px solid #1d4ed8;border-radius:8px;padding:14px 16px;">
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#1d4ed8;text-transform:uppercase;letter-spacing:.04em;">&#128230; Make &amp; dispatch in-house</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr><th align="left" style="font-size:11px;color:#888;text-transform:uppercase;padding-bottom:4px;">Piece / spec</th><th style="font-size:11px;color:#888;text-transform:uppercase;padding-bottom:4px;">Qty</th></tr>
              ${inhouseRows}
            </table>
            <p style="margin:8px 0 0;font-size:12px;color:#555;">Print, frame and post to the address below. These are NOT in Printful.</p>
          </div>` : '';
  const subject = `${failed ? '\u26A0 ACTION NEEDED \u2014 ' : (hasInhouse ? '\uD83D\uDCE6 MAKE \u2014 ' : '')}New Fuglys order #${ref} \u2014 ${gbp(session.amount_total)}`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border-radius:8px;padding:28px;">
        <tr><td>
          <h1 style="margin:0 0 4px;font-size:20px;">New order #${ref}</h1>
          <p style="margin:0 0 16px;color:#666;font-size:13px;">The Fuglys &middot; ${esc(new Date().toLocaleString('en-GB'))}</p>
          ${banner}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;">
            <tr>
              <th align="left" style="font-size:11px;color:#888;text-transform:uppercase;padding-bottom:4px;">Item</th>
              <th style="font-size:11px;color:#888;text-transform:uppercase;padding-bottom:4px;">Qty</th>
              <th align="right" style="font-size:11px;color:#888;text-transform:uppercase;padding-bottom:4px;">Price</th>
            </tr>
            ${rows}
            ${session.shipping_cost ? `<tr><td style="padding:8px 0;font-size:14px;color:#666;">Shipping</td><td></td><td style="padding:8px 0;font-size:14px;text-align:right;color:#666;">${gbp(session.shipping_cost.amount_total)}</td></tr>` : ''}
            <tr><td style="padding:10px 0 0;font-size:15px;font-weight:700;">Total</td><td></td><td style="padding:10px 0 0;font-size:15px;font-weight:700;text-align:right;">${gbp(session.amount_total)}</td></tr>
          </table>
          ${inhouseSection}
          <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;">Customer</p>
          <p style="margin:0 0 16px;font-size:14px;">${esc(cust.name || '\u2014')}<br><a href="mailto:${esc(cust.email || '')}">${esc(cust.email || '\u2014')}</a></p>
          <p style="margin:0 0 4px;font-size:11px;color:#888;text-transform:uppercase;">Ship to</p>
          <p style="margin:0;font-size:14px;line-height:1.6;">${addrLines}</p>
        </td></tr>
      </table>
    </td></tr></table>
  </body></html>`;
  try {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.RESEND_API_KEY },
      body: JSON.stringify({ from: MERCHANT_FROM, to: MERCHANT_TO, subject, html }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error(`[MERCHANT-FAIL] session ${session.id}: Resend ${res.status} — ${t}`);
    } else {
      console.log(`[MERCHANT-OK] session ${session.id}: merchant alert sent to ${MERCHANT_TO}.`);
    }
  } catch (err) {
    console.error(`[MERCHANT-FAIL] session ${session.id}:`, err && err.message ? err.message : err);
  }
}

/* Persist the order, alert the merchant, then report the purchase to GA4.
   alreadyRecorded: "this order was already in the log before this attempt"
   (a Stripe retry) — no second merchant alert and no second GA4 purchase. */
async function finalize(session, lineItems, status, printfulOrderId, alreadyRecorded) {
  await saveOrder(session, lineItems, status, printfulOrderId);
  if (alreadyRecorded) {
    console.log(`[MERCHANT-SKIP] session ${session.id}: order already in the Sanity log (Stripe retry) — alert not resent.`);
  } else {
    await sendMerchantEmail(session, lineItems, status, printfulOrderId);
  }
  const ga = await sendPurchase({ session, lineItems, stripe, alreadySent: alreadyRecorded });
  if (ga.sent) console.log(`[GA4] session ${session.id}: purchase sent.`);
  else if (ga.reason !== 'not-configured' && ga.reason !== 'no-client-id' && ga.reason !== 'not-livemode') {
    console.warn(`[GA4] session ${session.id}: purchase not sent (${ga.reason}).`);
  }
}

/* True if this session's order is already in the Sanity log, i.e. this is a
   Stripe retry of an order a previous delivery handled. Checked before the
   order is (re)written. False when the log can't be read, so the emails
   still go (twice beats never). */
async function orderAlreadyRecorded(session) {
  if (!sanityWriteToken()) return false;
  const sessionKey = String(session.id).slice(-32);
  const [dotted, dashed] = await Promise.all([orderExists(`order.${sessionKey}`), orderExists(`order-${sessionKey}`)]);
  return dotted || dashed;
}

/* True if a document with this _id exists. Authenticated: order docs are
   only readable with the token. A failed lookup counts as "no". */
async function orderExists(id) {
  try {
    const q = encodeURIComponent('count(*[_id == $id])');
    const res = await fetch(
      `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VER}/data/query/${SANITY_DATASET}?query=${q}&$id=${encodeURIComponent(JSON.stringify(id))}`,
      { headers: { Authorization: 'Bearer ' + sanityWriteToken() } }
    );
    return res.ok && (await res.json()).result > 0;
  } catch {
    return false;
  }
}

/* Write the order doc in Sanity. Deterministic _id keyed on the session id
   makes webhook retries idempotent. One atomic transaction:
     createIfNotExists  — an empty order shell, only on the first delivery;
     patch.set          — the payment fields from the Stripe session;
     patch.setIfMissing — status, printfulOrderId, inhouseStatus: written once.
   So a Stripe retry refreshes the payment details but never undoes what
   happened since — a "shipped" status, the owner's in-house progress — and
   never touches the fields printful-webhook owns (carrier, trackingNumber,
   trackingUrl, shippedAt, failureReason). Non-fatal. */
async function saveOrder(session, lineItems, status, printfulOrderId) {
  if (!sanityWriteToken()) {
    console.warn(`[ORDER-SKIP] session ${session.id}: neither SANITY_API_TOKEN nor SANITY_TOKEN is set.`);
    return;
  }
  const ship = getShip(session);
  const a = ship && ship.address ? ship.address : null;

  const items = (lineItems.data || []).map((li, i) => {
    const inhouse = isInhouse(li);
    return {
      _key: li.id || String(i),
      _type: 'lineItem',
      title: li.description || '',
      // For wall art, reuse colour/size to carry format/size so the existing
      // order view stays readable without a schema change.
      colour: inhouse ? (meta(li, 'wallart_format') || '') : (meta(li, 'fuglys_colour') || ''),
      size: inhouse ? (meta(li, 'wallart_size') || '') : (meta(li, 'fuglys_size') || ''),
      quantity: li.quantity || 1,
      price: (li.amount_total || 0) / 100,
      fulfilment: inhouse ? 'inhouse' : 'printful',
    };
  });
  const inhouseCount = items.filter((it) => it.fulfilment === 'inhouse').length;

  // The dot keeps the order (name, email, address) out of anonymous API reads.
  // A retry for a session whose order predates that change updates the old
  // doc in place (until tools/migrate-private-ids.mjs moves it) rather than
  // creating a second one.
  const sessionKey = String(session.id).slice(-32);
  const orderId = (await orderExists(`order-${sessionKey}`)) ? `order-${sessionKey}` : `order.${sessionKey}`;

  const payment = {
    orderRef: String(session.id).slice(-8).toUpperCase(),
    placedAt: new Date(session.created ? session.created * 1000 : Date.now()).toISOString(),
    customerName: (ship && ship.name) || (session.customer_details && session.customer_details.name) || '',
    customerEmail: (session.customer_details && session.customer_details.email) || '',
    items,
    hasInhouse: inhouseCount > 0,
    shippingCost: session.shipping_cost ? (session.shipping_cost.amount_total || 0) / 100 : 0,
    total: (session.amount_total || 0) / 100,
    currency: (session.currency || 'gbp').toUpperCase(),
    stripeSessionId: session.id,
  };
  if (a) {
    payment.shippingAddress = {
      name: (ship && ship.name) || '',
      line1: a.line1 || '', line2: a.line2 || '',
      city: a.city || '', state: a.state || '',
      postalCode: a.postal_code || '', country: a.country || '',
    };
  }

  const once = { status };
  if (printfulOrderId) once.printfulOrderId = String(printfulOrderId);
  if (inhouseCount > 0) once.inhouseStatus = 'to-make';

  try {
    const res = await fetch(
      `https://${SANITY_PROJECT_ID}.api.sanity.io/v${SANITY_API_VER}/data/mutate/${SANITY_DATASET}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sanityWriteToken() },
        body: JSON.stringify({ mutations: [
          { createIfNotExists: { _id: orderId, _type: 'order' } },
          { patch: { id: orderId, set: payment, setIfMissing: once } },
        ] }),
      }
    );
    if (!res.ok) {
      const t = await res.text();
      console.error(`[ORDER-SAVE-FAIL] session ${session.id}: Sanity ${res.status} — ${t}`);
    } else {
      console.log(`[ORDER-SAVED] session ${session.id}: ${payment.orderRef} (${status}).`);
    }
  } catch (err) {
    console.error(`[ORDER-SAVE-FAIL] session ${session.id}:`, err && err.message ? err.message : err);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('[CONFIG] STRIPE_WEBHOOK_SECRET is not set — cannot verify webhook.');
    return { statusCode: 500, body: 'Webhook secret not configured' };
  }

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      event.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[SIGNATURE] Webhook signature verification failed:', err.message);
    return { statusCode: 400, body: 'Webhook signature failed: ' + err.message };
  }

  if (stripeEvent.type !== 'checkout.session.completed') {
    return { statusCode: 200, body: JSON.stringify({ received: true, ignored: stripeEvent.type }) };
  }

  const session = stripeEvent.data.object;

  /* Brand guard — ignore other brands' sessions on the shared Stripe account.
     Unstamped (legacy) sessions are also skipped: checkout + webhook deploy
     together, so anything without a brand tag is not ours to process.
     MUST return 200 — a non-2xx makes Stripe retry and eventually disable
     this endpoint. */
  if (!isOurSession(session)) {
    const sessionBrand = (session.metadata && session.metadata.brand) || null;
    console.log(`[BRAND-GUARD] session ${session.id}: brand="${sessionBrand || 'none'}" — not ${BRAND_KEY}, skipping.`);
    return { statusCode: 200, body: JSON.stringify({ received: true, skipped: 'other-brand' }) };
  }

  console.log(`[ORDER] checkout.session.completed — session ${session.id}`);

  /* Stripe retry check: was this order already in the Sanity log BEFORE this
     delivery saves it? A retry gets no customer confirmation, merchant alert
     or GA4 purchase again. Started now, alongside the line-item fetch, and
     awaited before the confirmation; never rejects. */
  const alreadyRecordedCheck = orderAlreadyRecorded(session).catch(() => false);

  let lineItems;
  try {
    lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
      expand: ['data.price.product'],
    });
  } catch (err) {
    console.error(`[ORDER] session ${session.id}: could not list line items —`, err && err.message ? err.message : err);
    lineItems = { data: [] };
  }

  const alreadyRecorded = await alreadyRecordedCheck;

  /* Customer confirmation email — independent of Printful, never fatal. */
  if (alreadyRecorded) {
    console.log(`[EMAIL-SKIP] session ${session.id}: order already in the Sanity log (Stripe retry) — confirmation not resent.`);
  } else {
    await sendCustomerEmail(session, lineItems);
  }

  try {
    if (!process.env.PRINTFUL_API_KEY) {
      console.error(`[FULFILMENT-FAIL] session ${session.id}: PRINTFUL_API_KEY not set.`);
      await finalize(session, lineItems, 'paid', null, alreadyRecorded);
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    const printfulItems = [];
    const inhouseLines = [];
    const missing = [];
    for (const li of lineItems.data) {
      const id = readVariantId(li);
      if (id) {
        printfulItems.push({ sync_variant_id: Number(id) || id, quantity: li.quantity || 1 });
      } else if (isInhouse(li)) {
        inhouseLines.push(li);
      } else {
        missing.push(li.description || '(unnamed item)');
      }
    }

    if (missing.length > 0) {
      console.error(
        `[FULFILMENT-WARN] session ${session.id}: ${missing.length} item(s) had neither a Printful variant nor an in-house flag:`,
        missing
      );
    }

    // No POD lines → in-house-only order. Valid: the owner email lists the
    // pieces to make & dispatch. This is NOT a fulfilment failure.
    if (printfulItems.length === 0) {
      if (inhouseLines.length > 0 && missing.length === 0) {
        console.log(`[INHOUSE] session ${session.id}: ${inhouseLines.length} in-house item(s), no POD — owner will make & dispatch.`);
        await finalize(session, lineItems, 'inhouse', null, alreadyRecorded);
        return { statusCode: 200, body: JSON.stringify({ received: true, inhouse: inhouseLines.length }) };
      }
      console.error(`[FULFILMENT-FAIL] session ${session.id}: nothing to send to Printful and no in-house items — place it manually.`);
      await finalize(session, lineItems, 'fulfilment-failed', null, alreadyRecorded);
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    const ship = getShip(session);
    if (!ship || !ship.address) {
      console.error(`[FULFILMENT-FAIL] session ${session.id}: no shipping address on session — order NOT fulfilled. Place it manually.`);
      await finalize(session, lineItems, 'fulfilment-failed', null, alreadyRecorded);
      return { statusCode: 200, body: JSON.stringify({ received: true }) };
    }

    const printfulOrder = {
      external_id: String(session.id).slice(-32),
      recipient: {
        name: ship.name || (session.customer_details && session.customer_details.name) || '',
        address1: ship.address.line1 || '',
        address2: ship.address.line2 || '',
        city: ship.address.city || '',
        state_code: ship.address.state || '',
        country_code: ship.address.country || '',
        zip: ship.address.postal_code || '',
        email: session.customer_details && session.customer_details.email,
      },
      items: printfulItems,
    };

    const res = await fetch(PRINTFUL_ORDERS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + process.env.PRINTFUL_API_KEY,
      },
      body: JSON.stringify(printfulOrder),
    });

    const bodyText = await res.text();

    if (!res.ok) {
      console.error(
        `[FULFILMENT-FAIL] session ${session.id}: Printful API ${res.status} — order NOT created. Response: ${bodyText}`
      );
      await finalize(session, lineItems, 'fulfilment-failed', null, alreadyRecorded);
      return { statusCode: 200, body: JSON.stringify({ received: true, printful: 'failed' }) };
    }

    let printfulId;
    try { printfulId = JSON.parse(bodyText).result?.id; } catch (_) { /* ignore */ }
    console.log(`[FULFILMENT-OK] session ${session.id}: Printful order created${printfulId ? ' #' + printfulId : ''} (${printfulItems.length} item(s)).`);

    await finalize(session, lineItems, 'fulfilled', printfulId, alreadyRecorded);
    return { statusCode: 200, body: JSON.stringify({ received: true, printful: 'created' }) };
  } catch (err) {
    console.error(`[FULFILMENT-FAIL] session ${session.id}: unexpected error —`, err && err.message ? err.message : err);
    await finalize(session, lineItems, 'fulfilment-failed', null, alreadyRecorded);
    return { statusCode: 200, body: JSON.stringify({ received: true, printful: 'error' }) };
  }
};

// For tests: the Sanity order-log write.
exports.saveOrder = saveOrder;
