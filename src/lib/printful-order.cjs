/**
 * The Printful part of a Stripe webhook: the own-store variant check, then the
 * order, retried once on a transient failure. All inside one time budget.
 *
 * Byte-identical in every brand repo that sends orders to Printful (the four
 * IP brands and Dotty: src/lib/printful-order.cjs; Wyrmfuel:
 * netlify/lib/printful-order.cjs). Fix it in one, copy it to all six.
 *
 * Why: on 4 Nov 2026 Printful answered a Dotty order POST with HTTP 500 ("An
 * internal server error occurred"); with no retry the order never reached
 * Printful and nothing recorded why.
 *
 * Time budget. Netlify's default synchronous function limit is 10 s, so the
 * caller takes printfulDeadline() (now + config.budgetMs, 9 s) before the
 * store check and passes it to both calls below:
 *   - checkStoreVariants: every variant is looked up in parallel, each call
 *     capped at config.timeoutMs (4 s) and the deadline. No retry. A call that
 *     times out is "couldn't verify": reported in `unverified` (the caller
 *     logs it) and the order still goes ahead. A 404 (not this store's), any
 *     other status or a network error is a problem, as before.
 *   - createPrintfulOrder: each attempt is capped at config.timeoutMs and what
 *     is left of the deadline. A 5xx, a timeout or a network error is retried
 *     once after config.retryDelayMs (1 s), if at least 1 s + 1 s of the
 *     budget is left; otherwise the failure says there was no time to retry.
 *     A 4xx is not retried: it won't fix itself.
 *   Worst case: check 4 s + order 4 s, then no time to retry = 8 s; or a fast
 *   check + 4 s + 1 s + 4 s = 9 s. Either way inside the 9 s budget.
 *
 * Retrying is safe because external_id is fixed per Stripe session. If the
 * first attempt actually created the order (Printful 500'd or timed out after
 * writing it), the retry is rejected as a duplicate. That "already exists"
 * answer counts as success and the existing order is looked up by external_id
 * (GET /orders/@{external_id}). The same goes for a duplicate on the first
 * attempt: that is a Stripe redelivery of a session whose order is already in
 * Printful, not a failure.
 *
 * Every order failure carries `error`: the Printful status and message, or the
 * exception message, ready for the order's failureReason and the alert.
 *
 * The confirm flag is the caller's decision and is passed through unchanged:
 * true / false is sent as ?confirm=, undefined sends no confirm parameter.
 *
 * Neither call throws. createPrintfulOrder resolves to
 *   { ok: true,  id, confirmed, existing, attempts }
 *   { ok: false, status, error, attempts }        (status null = no response)
 * checkStoreVariants resolves to { problems: [string], unverified: [string] }.
 */
'use strict';

const PRINTFUL_ORDERS_URL = 'https://api.printful.com/orders';
const PRINTFUL_STORE_VARIANTS_URL = 'https://api.printful.com/store/variants';

// Mutable so tests can set retryDelayMs to 0 or shorten the timeouts.
const config = { retryDelayMs: 1000, timeoutMs: 4000, budgetMs: 9000, minAttemptMs: 1000 };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* The deadline for the whole Printful part; take it just before the store check. */
function printfulDeadline() {
  return Date.now() + config.budgetMs;
}

/* The timeout for one call: config.timeoutMs, or less if the deadline is near
   (never under config.minAttemptMs, so a call always gets a fair chance). */
function callTimeout(deadline) {
  const left = deadline === undefined ? Infinity : deadline - Date.now();
  return Math.max(config.minAttemptMs, Math.min(config.timeoutMs, left));
}

const isTimeout = (err) => Boolean(err && (err.name === 'TimeoutError' || err.name === 'AbortError'));

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
  if (isTimeout(err)) return `Printful did not answer within ${Math.round(timeoutMs / 1000)} s`;
  return `Printful request failed: ${err && err.message ? err.message : String(err)}`;
}

/* ── Own-store variant check ─────────────────────────────────────────────── */

/* Every Printful line must be a variant in this site's own Printful store. The
   API key is store-scoped, so GET /store/variants/{id} answers 200 only for
   this store's variants (another store's id is a 404). `notOursText` is the
   brand's wording for a 404. An empty `problems` list means go ahead. */
async function checkStoreVariants({ apiKey, ids, deadline, notOursText = 'not in this Printful store' }) {
  const results = await Promise.all(ids.map(async (id) => {
    const timeoutMs = callTimeout(deadline);
    try {
      const res = await globalThis.fetch(`${PRINTFUL_STORE_VARIANTS_URL}/${encodeURIComponent(id)}`, {
        headers: { Authorization: 'Bearer ' + apiKey },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.ok) return null;
      return { problem: `${id}: ${res.status === 404 ? notOursText : `could not be checked (Printful ${res.status})`}` };
    } catch (err) {
      if (isTimeout(err)) return { unverified: `${id}: Printful did not answer within ${Math.round(timeoutMs / 1000)} s` };
      return { problem: `${id}: could not be checked (${err && err.message ? err.message : err})` };
    }
  }));
  return {
    problems: results.filter((r) => r && r.problem).map((r) => r.problem),
    unverified: results.filter((r) => r && r.unverified).map((r) => r.unverified),
  };
}

/* ── Order ───────────────────────────────────────────────────────────────── */

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

async function createPrintfulOrder({ apiKey, order, confirm, deadline, log = console }) {
  const url = confirm === undefined ? PRINTFUL_ORDERS_URL : `${PRINTFUL_ORDERS_URL}?confirm=${confirm ? 'true' : 'false'}`;
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
    body: JSON.stringify(order),
  };
  const confirmed = confirm === true;

  // Already in Printful under this external_id: record that order, not a failure.
  const existing = async (attempts) => {
    const found = await findExisting(order.external_id, apiKey, callTimeout(deadline));
    if (!found) log.warn(`[PRINTFUL] external_id ${order.external_id}: already in Printful, but the existing order could not be read back.`);
    return {
      ok: true,
      id: found ? found.id : null,
      confirmed: found && found.status ? found.status !== 'draft' : confirmed,
      existing: true,
      attempts,
    };
  };

  const first = await attemptOnce(url, init, callTimeout(deadline));
  if (first.ok) return { ok: true, id: first.id, confirmed, existing: false, attempts: 1 };
  if (isDuplicate(first.status, first.message || '')) return existing(1);
  if (!first.retryable) return { ok: false, status: first.status, error: first.error, attempts: 1 };

  const left = deadline === undefined ? Infinity : deadline - Date.now();
  if (left < config.retryDelayMs + config.minAttemptMs) {
    log.warn(`[PRINTFUL-RETRY] external_id ${order.external_id}: ${first.error}; no time left in the budget to retry.`);
    return { ok: false, status: first.status, error: `${first.error} (no time left to retry)`, attempts: 1 };
  }

  log.warn(`[PRINTFUL-RETRY] external_id ${order.external_id}: ${first.error}; retrying in ${config.retryDelayMs} ms.`);
  await sleep(config.retryDelayMs);

  const second = await attemptOnce(url, init, callTimeout(deadline));
  if (second.ok) return { ok: true, id: second.id, confirmed, existing: false, attempts: 2 };
  // The first attempt did create it after all.
  if (isDuplicate(second.status, second.message || '')) return existing(2);

  const error = second.error === first.error
    ? `${second.error} (tried twice)`
    : `${second.error} (tried twice; first attempt: ${first.error})`;
  return { ok: false, status: second.status, error, attempts: 2 };
}

module.exports = {
  createPrintfulOrder, checkStoreVariants, printfulDeadline, config,
  isDuplicate, printfulMessage, PRINTFUL_ORDERS_URL, PRINTFUL_STORE_VARIANTS_URL,
};
