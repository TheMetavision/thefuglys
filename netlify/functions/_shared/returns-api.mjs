/**
 * POST /api/returns -- the public /returns page's steps (returns.mts wires it).
 *
 *   {action: "lookup", orderRef, email, turnstile, ...bot fields}
 *     -> which lines of that order can be returned, and a short-lived signed
 *        session for the next steps. orderRef is the #XXXXXXXX reference from
 *        the order confirmation email (with or without the "#").
 *   {action: "quote", session, lines: [{lineKey, quantity, reason}]}
 *     -> {postage, parts, claim}: the return postage, in pounds, that would
 *        be deducted from the refund, from the service's quote-return: the
 *        sum over the parcels (wall art, merchandise). null when there is no
 *        exact figure (a band Alan chooses, or a quote failed): the page then
 *        shows the general wording. Faulty merchandise costs nothing and has
 *        no parcel (`claim` says one is in the pick).
 *   {action: "submit", session, lines, notes, ...bot fields}
 *     -> one returnRequest per route (returns-eligibility.mjs returnRoutes):
 *        a Printful claim for faulty merchandise (type printfulClaim, no
 *        label; the customer is asked for a photo by email), a wall-art
 *        return and a merchandise return (each its own label and band). Each
 *        is for Alan to approve, and each emails the team. A top-level
 *        `reason` is used for lines that carry none.
 *
 * Protected like the newsletter form: Cloudflare Turnstile on the lookup (the
 * step that reads an order), a honeypot and a 3-second time-to-submit check,
 * and per-visitor rate limits. A wrong reference and a wrong email get the
 * same answer, so the form cannot be used to find out whether an order exists.
 *
 * The later steps carry the session the lookup signed (HMAC with a key derived
 * from SHIPPING_SECRET under its own label, shipping-internal.mjs), which
 * names the order and expires after 30 minutes;
 * everything is re-checked against the order as it is now.
 *
 * The request is stored at returnRequest.<ref> -- a dotted id, so anonymous
 * reads never see it.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { returnsSessionKey } from './shipping-internal.mjs';
import { quoteReturnPounds } from './shipping-client.mjs';
import { evaluateReturn, pickLines, returnRoutes, REASONS, FAULTY, FAULTY_LABEL, longDate, londonDate, CONTACT } from './returns-eligibility.mjs';
import { returnBandFor, merchPackingNote, isUnderwear, isClothingLine } from './parcel-plan.mjs';
import { orderRefFor, normaliseOrderRef } from './order-ref.mjs';
import { sendEmail, newReturnEmail, newClaimEmail, claimReceivedEmail } from './shipping-emails.mjs';

const SESSION_TTL_MS = 30 * 60 * 1000;
const MIN_SUBMIT_MS = 3000;
export const HONEYPOT_FIELD = 'mv_ret_extra';
export const NOT_FOUND = `We couldn't find an order with that reference and email address. Please check both — the reference looks like #AB12CD34 and is in your order confirmation email. No reference? Email ${CONTACT}.`;

const json = (status, body) => ({ status, body });
const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sessionKey = (env) => returnsSessionKey(env);

export function issueSession({ orderId, email }, { env = process.env, now = Date.now() } = {}) {
  const payload = b64(JSON.stringify({ o: orderId, e: email, x: now + SESSION_TTL_MS }));
  return `${payload}.${b64(createHmac('sha256', sessionKey(env)).update(payload).digest())}`;
}

export function readSession(token, { env = process.env, now = Date.now() } = {}) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || !env.SHIPPING_SECRET) return null;
  const want = Buffer.from(b64(createHmac('sha256', sessionKey(env)).update(payload).digest()));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return s && typeof s.o === 'string' && s.x > now ? { orderId: s.o, email: s.e } : null;
  } catch { return null; }
}

const clientIp = (req) => req.headers.get('x-nf-client-connection-ip')
  || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';

/** True when the bot signals say this is not a person. Logged by name only. */
function botSignal(p, log) {
  if (typeof p[HONEYPOT_FIELD] === 'string' && p[HONEYPOT_FIELD].trim()) { log.warn('returns: honeypot filled — discarded'); return true; }
  const elapsed = Number(p.mv_ret_ts_submit) - Number(p.mv_ret_ts_load);
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_SUBMIT_MS) { log.warn(`returns: submitted ${elapsed}ms after load — discarded`); return true; }
  return false;
}

const ORDER_FIELDS = '{ _id, _type, orderRef, stripeSessionId, customerName, customerEmail, placedAt, items, hasInhouse, inhouseStatus, shipmentResult, dispatchEmailSentAt, shippingAddress, test, status, printfulOrderId, shippedAt, printfulShipments }';
const RETURNS_OF = '*[_type == "returnRequest" && orderId == $id && !(_id in path("drafts.**"))]{ status, lines }';

/** The order the customer means: their email and a reference that matches it. */
export async function findOrder(sanity, input, email) {
  const ref = normaliseOrderRef(input);
  if (!ref) return null;
  return sanity.fetch(
    `*[_type == "order" && orderRef == $r && lower(customerEmail) == $e && !(_id in path("drafts.**"))] | order(placedAt desc)[0]${ORDER_FIELDS}`,
    { r: ref, e: email },
  );
}

async function sessionOrder(sanity, session) {
  const order = await sanity.fetch(`*[_type == "order" && _id == $id][0]${ORDER_FIELDS}`, { id: session.orderId });
  return order && String(order.customerEmail || '').trim().toLowerCase() === session.email ? order : null;
}

const publicLine = (l) => ({
  lineKey: l.lineKey, title: l.title, format: l.format, size: l.size, merch: l.fulfilment === 'printful',
  ordered: l.ordered, returnable: l.returnable, claimable: l.claimable || 0, why: l.why,
});

/** The live quote for one parcel, in pounds, or null. Never throws. */
async function postageFor(order, picked, quote, log) {
  const band = returnBandFor(picked);
  const a = order.shippingAddress || {};
  const country = String(a.country || '').toUpperCase();
  if (!band || country !== 'GB' || !String(a.postalCode || '').trim()) return null;
  try {
    return quoteReturnPounds(await quote({ band, postalCode: String(a.postalCode).trim(), countryCode: country }));
  } catch (err) {
    log.warn(`returns: quote for ${orderRefFor(order)} (${band}) failed: ${err?.code || ''} ${err?.message || err}`);
    return null;
  }
}

/** Every parcel's quote and their sum (null if any has no exact figure). */
async function postageForRoutes(order, routes, quote, log) {
  const parts = [];
  for (const r of routes) {
    if (r.kind === 'claim') continue;
    parts.push({ kind: r.kind, band: returnBandFor(r.lines), postage: await postageFor(order, r.lines, quote, log) });
  }
  const total = parts.length && parts.every((x) => typeof x.postage === 'number')
    ? Math.round(parts.reduce((n, x) => n + x.postage, 0) * 100) / 100
    : (parts.length ? null : 0);
  return { postage: total, parts, claim: routes.some((r) => r.kind === 'claim') };
}

const money2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const shownFigure = (v) => {
  const n = Number(v);
  return v != null && v !== '' && Number.isFinite(n) && n >= 0 && n < 100 ? money2(n) : undefined;
};

/**
 * @param {Request} req
 * @param {{ sanity, getResend, shippingOn: boolean, clothing: boolean, env?, now?, turnstile, rateLimit, quote, log? }} deps
 *   turnstile(token, ip) -> { ok, status?, error? }  (_shared/turnstile.mjs verifyTurnstile, secret bound)
 */
export async function handleReturns(req, deps) {
  const { sanity, getResend, shippingOn, clothing = false, env = process.env, now = () => Date.now(), turnstile, rateLimit, quote, log = console } = deps;
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!shippingOn) return json(404, { error: `Online returns are not available yet. Please email ${CONTACT} with your order reference.` });
  if (!env.SHIPPING_SECRET) {
    log.error('returns: SHIPPING_SECRET is not set — refusing');
    return json(503, { error: `Returns are unavailable right now. Please email ${CONTACT}.` });
  }

  let p;
  try { p = await req.json(); } catch { return json(400, { error: 'Bad request' }); }
  if (!p || typeof p !== 'object') return json(400, { error: 'Bad request' });
  const ip = clientIp(req);
  const verdictOf = async (order) => evaluateReturn(order, { now: now(), existing: await sanity.fetch(RETURNS_OF, { id: order._id }), clothing });

  /* ── step 1: find the order ─────────────────────────────────────────── */
  if (p.action === 'lookup') {
    if (botSignal(p, log)) return json(404, { error: NOT_FOUND });
    const verdict = await turnstile(p.turnstile ? String(p.turnstile).slice(0, 2048) : '', ip);
    if (!verdict.ok) return json(verdict.status === 503 ? 503 : 400, { error: verdict.error || 'Please complete the anti-spam check and try again.' });

    const slot = await rateLimit('returns-lookup', `ip:${ip}`, 10, 60 * 60 * 1000);
    if (!slot) return json(429, { error: 'Too many attempts. Please wait an hour, or email us.' });

    const typed = String(p.orderRef || '').trim().slice(0, 100);
    const email = String(p.email || '').trim().toLowerCase().slice(0, 254);
    if (!normaliseOrderRef(typed) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(404, { error: NOT_FOUND });

    const order = await findOrder(sanity, typed, email);
    if (!order) return json(404, { error: NOT_FOUND });
    const v = await verdictOf(order);
    return json(200, {
      ok: true,
      orderNumber: orderRefFor(order),
      eligible: v.eligible,
      reason: v.reason,
      deliveryDateUnknown: v.deliveryDateUnknown,
      windowEndsOn: v.windowEndsOn ? longDate(v.windowEndsOn) : null,
      merchWindowEndsOn: v.merchWindowEndsOn && !v.shipDateUnknown ? longDate(v.merchWindowEndsOn) : null,
      lines: v.lines.map(publicLine),
      reasons: REASONS,
      faulty: { key: FAULTY, label: FAULTY_LABEL },
      session: v.eligible ? issueSession({ orderId: order._id, email }, { env, now: now() }) : null,
    });
  }

  /* ── between the steps: what the postage will be ────────────────────── */
  if (p.action === 'quote') {
    const session = readSession(p.session, { env, now: now() });
    if (!session) return json(400, { error: 'This page has timed out. Please look up your order again.' });
    const slot = await rateLimit('returns-quote', `ip:${ip}`, 60, 60 * 60 * 1000);
    if (!slot) return json(200, { ok: true, postage: null, parts: [] });
    const order = await sessionOrder(sanity, session);
    if (!order) return json(400, { error: 'This page has timed out. Please look up your order again.' });
    const picked = pickLines(await verdictOf(order), p.lines, Object.keys(REASONS)[0]);
    if (picked.error) return json(200, { ok: true, postage: null, parts: [] });
    return json(200, { ok: true, ...(await postageForRoutes(order, returnRoutes(picked.lines), quote, log)) });
  }

  /* ── step 2: make the request(s) ─────────────────────────────────────── */
  if (p.action === 'submit') {
    const session = readSession(p.session, { env, now: now() });
    if (!session) return json(400, { error: 'This page has timed out. Please look up your order again.' });
    if (botSignal(p, log)) return json(200, { ok: true, returnNumber: null, returnNumbers: [] });
    const fallback = Object.hasOwn(REASONS, p.reason) || p.reason === FAULTY ? p.reason : undefined;
    const notes = typeof p.notes === 'string' ? p.notes.trim().slice(0, 1000) : '';

    const slot = await rateLimit('returns-submit', `ip:${ip}`, 5, 60 * 60 * 1000);
    if (!slot) return json(429, { error: 'Too many requests. Please wait an hour, or email us.' });

    const order = await sessionOrder(sanity, session);
    if (!order) return json(400, { error: 'This page has timed out. Please look up your order again.' });
    const existing = await sanity.fetch(RETURNS_OF, { id: order._id });
    const v = evaluateReturn(order, { now: now(), existing, clothing });
    const picked = pickLines(v, p.lines, fallback);
    if (picked.error) return json(400, { error: picked.error });

    const orderNumber = orderRefFor(order);
    const routes = returnRoutes(picked.lines);
    const shownParts = p.shownParts && typeof p.shownParts === 'object' ? p.shownParts : {};
    const labelRoutes = routes.filter((r) => r.kind !== 'claim');
    const created = [];
    let n = (existing || []).length;

    for (const route of routes) {
      n += 1;
      const ref = `ret-${randomBytes(8).toString('hex')}`;
      const reasons = [...new Set(route.lines.map((l) => l.reasonLabel))];
      const base = {
        _id: `returnRequest.${ref}`,
        _type: 'returnRequest',
        returnRef: ref,
        returnNumber: `${orderNumber}-R${n}`,
        source: 'customer',
        order: { _type: 'reference', _ref: order._id, _weak: true },
        orderId: order._id,
        orderNumber,
        customerName: order.customerName || '',
        customerEmail: order.customerEmail,
        lines: route.lines,
        reason: route.lines[0].reason,
        reasonLabel: reasons.join('; '),
        ...(notes ? { customerNotes: notes } : {}),
        status: 'requested',
        ...(order.test ? { testOrder: true } : {}),
        requestedAt: new Date(now()).toISOString(),
      };
      let doc;
      if (route.kind === 'claim') {
        doc = {
          ...base,
          type: 'printfulClaim',
          freeLabel: true,
          claimResolution: 'replacement',
          refundAmount: money2(route.lines.reduce((s, l) => s + (Number(l.unitPrice) || 0) * (Number(l.quantity) || 1), 0)),
          ...(v.printfulOrderId ? { printfulOrderId: String(v.printfulOrderId) } : {}),
          ...(v.shippedAt ? { shippedAt: v.shippedAt } : {}),
          ...(v.claimDeadline ? { claimDeadline: v.claimDeadline, claimOverdue: londonDate(now()) > v.claimDeadline } : {}),
          ...(v.shipDateUnknown ? { shipDateUnknown: true } : {}),
        };
      } else {
        const band = returnBandFor(route.lines);
        // What the page showed for this parcel before they submitted (our own
        // quote step); a single-parcel request may send the older shownPostage.
        const shown = shownFigure(shownParts[route.kind]) ?? (labelRoutes.length === 1 ? shownFigure(p.shownPostage) : undefined);
        const merch = route.kind === 'merch';
        const note = merch ? merchPackingNote(route.lines) : null;
        doc = {
          ...base,
          type: 'return',
          freeLabel: false,
          ...(shown !== undefined ? { quotedPostage: shown } : {}),
          ...(band ? { band } : {}),
          ...(note ? { packingNote: note } : {}),
          ...(merch
            ? {
              ...(v.shippedAt ? { shippedAt: v.shippedAt } : {}),
              ...(v.merchWindowEndsOn ? { windowEndsOn: longDate(v.merchWindowEndsOn) } : {}),
              ...(v.shipDateUnknown ? { shipDateUnknown: true } : {}),
              deliveryDateUnknown: false,
            }
            : {
              ...(v.deliveredAt ? { deliveredAt: v.deliveredAt, windowEndsOn: longDate(v.windowEndsOn) } : {}),
              deliveryDateUnknown: !v.deliveredAt,
            }),
          ...(route.lines.some((l) => isClothingLine(l) && isUnderwear(l)) ? { underwear: true } : {}),
        };
      }
      await sanity.create(doc);
      created.push(doc);
      log.log(`returns: ${doc.returnNumber} requested (${route.kind}, ${route.lines.length} line(s))`);
    }

    const resend = getResend();
    for (const doc of created) {
      const team = await sendEmail(resend, doc.type === 'printfulClaim' ? newClaimEmail(doc) : newReturnEmail(doc));
      if (!team.ok) log.error(`returns: ${doc.returnNumber} team email not sent: ${team.error}`);
      if (doc.type === 'printfulClaim') {
        // The customer replies to this one with the photo.
        const cust = await sendEmail(resend, claimReceivedEmail(doc));
        if (!cust.ok) log.error(`returns: ${doc.returnNumber} photo-request email not sent: ${cust.error}`);
      }
    }
    const numbers = created.map((d) => d.returnNumber);
    return json(200, {
      ok: true,
      returnNumber: numbers[0] || null,
      returnNumbers: numbers,
      claim: created.some((d) => d.type === 'printfulClaim'),
      label: created.some((d) => d.type !== 'printfulClaim'),
    });
  }

  return json(400, { error: 'Bad request' });
}
