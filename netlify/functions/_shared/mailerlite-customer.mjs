/**
 * Add or update a buyer in this brand's MailerLite "<XX> - Customers" group
 * when their order first ships (_shared/post-delivery.mjs). Joining the group
 * starts the brand's post-delivery automation.
 *
 * FIELDS. MailerLite custom fields are shared by every brand in the account,
 * so one person who buys from two brands is one subscriber. Each brand writes
 * its own prefixed fields (MAILERLITE_FIELD_PREFIX in site-config.mjs:
 * fg_, lr_, coc_, bb_), so no brand's emails can show another's code or
 * order, plus MailerLite's built-in `name` (first name), as Pixel8 does: it is
 * the same person whichever brand writes it. The unprefixed fields Comic
 * Strip Canvas uses (order_id, product, referral_code, marketing_ok ...) are
 * never written. With prefix "fg":
 *
 *   name                 first name (MailerLite's built-in field)
 *   fg_order_id          #XXXXXXXX (the reference customers already have)
 *   fg_product           "Product", or "Product and 2 more"
 *   fg_last_order_date   YYYY-MM-DD (date field)
 *   fg_referral_code     FUG-XXXXXX, or '' if Stripe was unavailable
 *   fg_contents          'merch', 'wallart' or 'both'
 *   fg_first_shipped     'merch' (Printful's package_shipped came first) or
 *                        'wallart' (the in-house dispatch email came first)
 *   fg_marketing_ok      'yes' or 'no'
 *
 * A buyer who ticked "Don't send me offers or referral emails" is never added
 * at all, so the automation never starts for them; _marketing_ok stays as a
 * second guard for the automation's referral email.
 *
 * MailerLite's POST /subscribers is an upsert. No `status` is sent, so it
 * never resubscribes someone who unsubscribed.
 *
 * Env: MAILERLITE_API_KEY (already set for the newsletter). The group id is
 * MAILERLITE_CUSTOMERS_GROUP_ID in site-config.mjs (env override allowed).
 *
 * Never throws: returns { ok, skipped?, status?, error? } for the caller to log.
 */
import { fetchWithTimeout } from './timing.mjs';
import { setting } from './site-config.mjs';
import { marketingRefused } from './marketing-consent.mjs';
import { orderRefFor } from './order-ref.mjs';

const ML = 'https://connect.mailerlite.com/api';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The field keys this brand writes, e.g. fg_order_id. */
export function fieldKeys(prefix = setting('MAILERLITE_FIELD_PREFIX')) {
  const k = (s) => `${prefix}_${s}`;
  return {
    orderId: k('order_id'), product: k('product'), lastOrderDate: k('last_order_date'),
    referralCode: k('referral_code'), contents: k('contents'), firstShipped: k('first_shipped'),
    marketingOk: k('marketing_ok'),
  };
}

/** "Grimy Gus Tee", or "Grimy Gus Tee and 2 more" for a multi-line order. */
export function productTitleFor(items) {
  const list = Array.isArray(items) ? items : [];
  const first = String(list[0]?.title || '').trim();
  if (!first) return 'your order';
  const more = list.length - 1;
  return more > 0 ? `${first} and ${more} more` : first;
}

/** 'merch', 'wallart' or 'both', from the order's lines. */
export function contentsFor(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const art = items.some((l) => l?.fulfilment === 'inhouse') || (Boolean(order?.hasInhouse) && !items.length);
  const merch = items.some((l) => l?.fulfilment !== 'inhouse');
  if (art && merch) return 'both';
  return art ? 'wallart' : 'merch';
}

/** The MailerLite subscriber body for one shipped order. */
export function customerPayload(order, { referralCode, firstShipped, groupId, prefix }) {
  const f = fieldKeys(prefix);
  return {
    email: String(order.customerEmail || '').trim(),
    groups: [String(groupId)],
    fields: {
      // MailerLite's built-in field, shared by every brand: the first name only.
      name: String(order.customerName || '').trim().split(/\s+/)[0] || '',
      [f.orderId]: orderRefFor(order) || '',
      [f.product]: productTitleFor(order.items),
      [f.lastOrderDate]: String(order.placedAt || order._createdAt || '').slice(0, 10),
      [f.referralCode]: referralCode || '',
      [f.contents]: contentsFor(order),
      [f.firstShipped]: firstShipped === 'wallart' ? 'wallart' : 'merch',
      // Not ticking the box ('not_asked') allows the referral email under the
      // soft opt-in; it carries an unsubscribe link.
      [f.marketingOk]: marketingRefused(order.marketingConsent) ? 'no' : 'yes',
    },
  };
}

export async function addShippedCustomer(order, { referralCode, firstShipped } = {}, env = process.env, fetchFn = fetchWithTimeout) {
  if (marketingRefused(order?.marketingConsent)) return { ok: false, skipped: 'buyer refused marketing at checkout' };
  const apiKey = env.MAILERLITE_API_KEY;
  const groupId = setting('MAILERLITE_CUSTOMERS_GROUP_ID', env);
  const prefix = setting('MAILERLITE_FIELD_PREFIX', env);
  if (!apiKey || !groupId) return { ok: false, skipped: 'MAILERLITE_API_KEY or MAILERLITE_CUSTOMERS_GROUP_ID not set' };
  const body = customerPayload(order, { referralCode, firstShipped, groupId, prefix });
  if (!EMAIL_RE.test(body.email)) return { ok: false, skipped: 'no valid email' };
  try {
    const res = await fetchFn(`${ML}/subscribers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    }, 4000, 'MailerLite customer');
    if (!res.ok) return { ok: false, status: res.status, error: await res.text().catch(() => '') };
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
