/**
 * Create a Printful order, retrying once on a transient failure.
 *
 * Byte-identical in every brand repo that sends orders to Printful (the four
 * IP brands and Dotty: src/lib/printful-order.cjs; Wyrmfuel:
 * netlify/lib/printful-order.cjs). Fix it in one, copy it to all six.
 *
 * Why: on 4 Nov 2026 Printful answered a Dotty order POST with HTTP 500 ("An
 * internal server error occurred"); with no retry the order never reached
 * Printful and nothing recorded why.
 *
 *   - A 5xx, a timeout or a network error is retried once after
 *     config.retryDelayMs (1 s). A 4xx is not retried: it won't fix itself.
 *   - Each attempt times out after config.timeoutMs (4 s), so the worst case
 *     (timeout, wait, timeout) is about 9 s and fits inside Netlify's default
 *     10 s synchronous function limit.
 *   - Retrying is safe because external_id is fixed per Stripe session. If
 *     the first attempt actually created the order (Printful 500'd or timed
 *     out after writing it), the retry is rejected as a duplicate. That
 *     "already exists" answer counts as success and the existing order is
 *     looked up by external_id (GET /orders/@{external_id}). The same goes
 *     for a duplicate on the first attempt: that is a Stripe redelivery of a
 *     session whose order is already in Printful, not a failure.
 *   - Every failure carries `error`: the Printful status and message, or the
 *     exception message, ready for the order's failureReason and the alert.
 *
 * The confirm flag is the caller's decision and is passed through unchanged:
 * true / false is sent as ?confirm=, undefined sends no confirm parameter.
 *
 * Never throws. Resolves to
 *   { ok: true,  id, confirmed, existing, attempts }
 *   { ok: false, status, error, attempts }        (status null = no response)
 */
'use strict';

const PRINTFUL_ORDERS_URL = 'https://api.printful.com/orders';

// Mutable so tests can set retryDelayMs to 0.
const config = { retryDelayMs: 1000, timeoutMs: 4000 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Printful errors look like {"code":500,"result":"…","error":{"reason":"…","message":"…"}}. */
function printfulMessage(text) {
  try {
    const body = JSON.parse(text);
    const msg = (body && body.error && body.error.message) || (body && typeof body.result === 'string' && body.result);
    if (msg) return String(msg);
  } catch (_) { /* not JSON */ }
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  return raw ? raw.slice(0, 300) : '(empty response)';
}

/* Printful's answer when an order with this external_id is already there. */
function isDuplicate(status, message) {
  if (status !== 400 && status !== 409) return false;
  return /already exists|already been used|already used|duplicate/i.test(message)
    || (/external.?id/i.test(message) && /exist|used|taken/i.test(message));
}

function errorText(err, timeoutMs) {
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) return `Printful did not answer within ${Math.round(timeoutMs / 1000)} s`;
  return `Printful request failed: ${err && err.message ? err.message : String(err)}`;
}

async function attemptOnce(url, init, timeoutMs) {
  try {
    const res = await globalThis.fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (res.ok) {
      let id = null;
      try { id = JSON.parse(text).result?.id ?? null; } catch (_) { /* ignore */ }
      return { ok: true, id };
    }
    const message = printfulMessage(text);
    return { ok: false, status: res.status, message, error: `Printful API ${res.status}: ${message}`, retryable: res.status >= 500 };
  } catch (err) {
    return { ok: false, status: null, error: errorText(err, timeoutMs), retryable: true };
  }
}

/* The order a duplicate retry collided with. Never throws; null if unreadable. */
async function findExisting(externalId, apiKey, timeoutMs) {
  try {
    const res = await globalThis.fetch(`${PRINTFUL_ORDERS_URL}/@${encodeURIComponent(externalId)}`, {
      headers: { Authorization: 'Bearer ' + apiKey },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const result = JSON.parse(await res.text()).result;
    return result && result.id != null ? result : null;
  } catch (_) {
    return null;
  }
}

async function createPrintfulOrder({ apiKey, order, confirm, log = console }) {
  const timeoutMs = config.timeoutMs;
  const url = confirm === undefined ? PRINTFUL_ORDERS_URL : `${PRINTFUL_ORDERS_URL}?confirm=${confirm ? 'true' : 'false'}`;
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(order),
  };
  const confirmed = confirm === true;

  // Already in Printful under this external_id: record that order, not a failure.
  const existing = async (attempts) => {
    const found = await findExisting(order.external_id, apiKey, timeoutMs);
    if (!found) log.warn(`[PRINTFUL] external_id ${order.external_id}: already in Printful, but the existing order could not be read back.`);
    return {
      ok: true,
      id: found ? found.id : null,
      confirmed: found && found.status ? found.status !== 'draft' : confirmed,
      existing: true,
      attempts,
    };
  };

  const first = await attemptOnce(url, init, timeoutMs);
  if (first.ok) return { ok: true, id: first.id, confirmed, existing: false, attempts: 1 };
  if (isDuplicate(first.status, first.message || '')) return existing(1);
  if (!first.retryable) return { ok: false, status: first.status, error: first.error, attempts: 1 };

  log.warn(`[PRINTFUL-RETRY] external_id ${order.external_id}: ${first.error}; retrying in ${config.retryDelayMs} ms.`);
  await sleep(config.retryDelayMs);

  const second = await attemptOnce(url, init, timeoutMs);
  if (second.ok) return { ok: true, id: second.id, confirmed, existing: false, attempts: 2 };
  // The first attempt did create it after all.
  if (isDuplicate(second.status, second.message || '')) return existing(2);

  const error = second.error === first.error
    ? `${second.error} (tried twice)`
    : `${second.error} (tried twice; first attempt: ${first.error})`;
  return { ok: false, status: second.status, error, attempts: 2 };
}

module.exports = { createPrintfulOrder, config, isDuplicate, printfulMessage, PRINTFUL_ORDERS_URL };
