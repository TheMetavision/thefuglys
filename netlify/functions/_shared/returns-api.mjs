/**
 * POST /api/returns -- the public /returns page's steps (returns.mts wires it).
 *
 *   {action: "lookup", orderRef, email, turnstile, ...bot fields}
 *     -> which lines of that order can be returned, and a short-lived signed
 *        session for the next steps. orderRef is the #XXXXXXXX reference from
 *        the order confirmation email (with or without the "#").
 *   {action: "quote", session, lines: [{lineKey, quantity}]}
 *     -> {postage}: the return postage, in pounds, that would be deducted
 *        from the refund, from the service's quote-return. null when there is
 *        no exact figure (a mix Alan boxes by hand, or the quote failed): the
 *        page then shows the general wording.
 *   {action: "submit", session, lines, reason, notes, ...bot fields}
 *     -> a returnRequest for Alan to approve, and an email to the team.
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
import { evaluateReturn, pickLines, REASONS, longDate, CONTACT } from './returns-eligibility.mjs';
import { returnBandFor, isUnderwear, isClothingLine } from './parcel-plan.mjs';
import { orderRefFor, normaliseOrderRef } from './order-ref.mjs';
import { sendEmail, newReturnEmail } from './shipping-emails.mjs';

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

const ORDER_FIELDS = '{ _id, _type, orderRef, stripeSessionId, customerName, customerEmail, placedAt, items, hasInhouse, inhouseStatus, shipmentResult, dispatchEmailSentAt, shippingAddress, test }';
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
  lineKey: l.lineKey, title: l.title, format: l.format, size: l.size,
  ordered: l.ordered, returnable: l.returnable, why: l.why,
});

/** The live quote for a pick, in pounds, or null. Never throws. */
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
      lines: v.lines.map(publicLine),
      reasons: REASONS,
      session: v.eligible ? issueSession({ orderId: order._id, email }, { env, now: now() }) : null,
    });
  }

  /* ── between the steps: what the postage will be ────────────────────── */
  if (p.action === 'quote') {
    const session = readSession(p.session, { env, now: now() });
    if (!session) return json(400, { error: 'This page has timed out. Please look up your order again.' });
    const slot = await rateLimit('returns-quote', `ip:${ip}`, 60, 60 * 60 * 1000);
    if (!slot) return json(200, { ok: true, postage: null });
    const order = await sessionOrder(sanity, session);
    if (!order) return json(400, { error: 'This page has timed out. Please look up your order again.' });
    const picked = pickLines(await verdictOf(order), p.lines);
    if (picked.error) return json(200, { ok: true, postage: null });
    return json(200, { ok: true, postage: await postageFor(order, picked.lines, quote, log) });
  }

  /* ── step 2: make the request ───────────────────────────────────────── */
  if (p.action === 'submit') {
    const session = readSession(p.session, { env, now: now() });
    if (!session) return json(400, { error: 'This page has timed out. Please look up your order again.' });
    if (botSignal(p, log)) return json(200, { ok: true, returnNumber: null });
    if (!Object.hasOwn(REASONS, p.reason)) return json(400, { error: 'Please choose a reason.' });
    const notes = typeof p.notes === 'string' ? p.notes.trim().slice(0, 1000) : '';

    const slot = await rateLimit('returns-submit', `ip:${ip}`, 5, 60 * 60 * 1000);
    if (!slot) return json(429, { error: 'Too many requests. Please wait an hour, or email us.' });

    const order = await sessionOrder(sanity, session);
    if (!order) return json(400, { error: 'This page has timed out. Please look up your order again.' });
    const existing = await sanity.fetch(RETURNS_OF, { id: order._id });
    const v = evaluateReturn(order, { now: now(), existing, clothing });
    const picked = pickLines(v, p.lines);
    if (picked.error) return json(400, { error: picked.error });

    const orderNumber = orderRefFor(order);
    const ref = `ret-${randomBytes(8).toString('hex')}`;
    const returnNumber = `${orderNumber}-R${(existing || []).length + 1}`;
    const band = returnBandFor(picked.lines);
    const shown = Number(p.shownPostage);
    const underwear = picked.lines.some((l) => isClothingLine(l) && isUnderwear(l));
    const unknown = picked.lines.some((l) => isClothingLine(l)) || (!v.deliveredAt);
    const doc = {
      _id: `returnRequest.${ref}`,
      _type: 'returnRequest',
      returnRef: ref,
      returnNumber,
      source: 'customer',
      order: { _type: 'reference', _ref: order._id, _weak: true },
      orderId: order._id,
      orderNumber,
      customerName: order.customerName || '',
      customerEmail: order.customerEmail,
      lines: picked.lines,
      reason: p.reason,
      reasonLabel: REASONS[p.reason],
      ...(notes ? { customerNotes: notes } : {}),
      // What the page showed before they submitted (from our own quote step).
      ...(p.shownPostage != null && Number.isFinite(shown) && shown >= 0 && shown < 100 ? { quotedPostage: Math.round(shown * 100) / 100 } : {}),
      status: 'requested',
      freeLabel: false,
      ...(band ? { band } : {}),
      ...(v.deliveredAt ? { deliveredAt: v.deliveredAt, windowEndsOn: longDate(v.windowEndsOn) } : {}),
      deliveryDateUnknown: unknown,
      ...(underwear ? { underwear: true } : {}),
      ...(order.test ? { testOrder: true } : {}),
      requestedAt: new Date(now()).toISOString(),
    };
    await sanity.create(doc);
    log.log(`returns: ${returnNumber} requested (${picked.lines.length} line(s))${unknown ? ', delivery date unknown' : ''}`);

    const sent = await sendEmail(getResend(), newReturnEmail(doc));
    if (!sent.ok) log.error(`returns: ${returnNumber} team email not sent: ${sent.error}`);
    return json(200, { ok: true, returnNumber });
  }

  return json(400, { error: 'Bad request' });
}
