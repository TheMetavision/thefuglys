/**
 * src/lib/analytics.ts  (The Fuglys — GA4, UK PECR consent)
 *
 * Nothing Google-related loads until the visitor accepts in the cookie banner
 * (src/components/CookieConsent.astro). The choice lives in localStorage
 * `fuglys-consent` ("granted" | "denied"). On accept: consent default (analytics
 * only, ads denied) → gtag.js → config (page_view). On a later reject: the
 * ga-disable flag stops further hits on this page and the _ga cookies go.
 *
 * Shop events (view_item, add_to_cart, begin_checkout) are sent only with
 * consent. The PDP inline scripts can't import this module, so they push
 * [eventName, rawItem] onto window.fuglysShop; initAnalytics() drains it.
 */
// @ts-ignore — shared CommonJS module (no .d.ts; resolved by Vite at build)
import { itemVariant, validGaIds } from './ga4-item.mjs';
import type { CartItem } from './cart';

export const GA_ID = 'G-DHY9KR4CZK';
export const CONSENT_KEY = 'fuglys-consent';
export const CURRENCY = 'GBP'; // create-checkout charges in gbp
const CHECKOUT_WAIT_MS = 800;

export type Consent = 'granted' | 'denied';

/** What the PDPs know about the selected product, before GA naming. */
export interface ShopItem {
  slug: string;
  name: string;
  productType?: string;
  colour?: string;
  size?: string;
  format?: string;
  price: number;
  quantity?: number;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fuglysShop?: { push: (entry: [string, ShopItem]) => unknown } | [string, ShopItem][];
    __fuglysGaLoaded?: boolean;
  }
}

export { itemVariant };

export function getConsent(): Consent | null {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    return v === 'granted' || v === 'denied' ? v : null;
  } catch {
    return null;
  }
}

const hasConsent = () => getConsent() === 'granted';

export function setConsent(choice: Consent) {
  try { localStorage.setItem(CONSENT_KEY, choice); } catch { /* private mode: applies to this page only */ }
  if (choice === 'granted') enableAnalytics();
  else disableAnalytics();
}

/* Order-confirmation pages carry Stripe's session_id in the URL: send Google
   the bare path, and only the referrer's domain. */
function pageParams(): Record<string, string> {
  const { pathname, search, origin } = window.location;
  const isSuccess = /^\/order-success\/?$/.test(pathname) || new URLSearchParams(search).has('session_id');
  if (!isSuccess) return {};
  let referrer = '';
  try { referrer = document.referrer ? new URL(document.referrer).origin + '/' : ''; } catch { /* unparsable */ }
  return { page_location: origin + pathname, page_referrer: referrer };
}

function enableAnalytics() {
  (window as any)[`ga-disable-${GA_ID}`] = false;
  if (window.__fuglysGaLoaded && window.gtag) {
    // Accepted again after rejecting on this page.
    window.gtag('consent', 'update', { analytics_storage: 'granted' });
    window.gtag('config', GA_ID, pageParams());
    return;
  }
  window.__fuglysGaLoaded = true;
  window.dataLayer = window.dataLayer || [];
  // gtag.js reads the Arguments object, not an array.
  window.gtag = function gtag() { window.dataLayer!.push(arguments); };
  window.gtag('consent', 'default', {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, pageParams());
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
}

function disableAnalytics() {
  (window as any)[`ga-disable-${GA_ID}`] = true;
  if (window.gtag) window.gtag('consent', 'update', { analytics_storage: 'denied' });
  // _ga and _ga_<container>, on every domain level they could have been set on.
  const host = window.location.hostname;
  const parts = host.split('.');
  const domains = [''];
  for (let i = 0; i < parts.length - 1; i++) {
    const d = parts.slice(i).join('.');
    domains.push(d, '.' + d);
  }
  document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter((n) => /^_ga(_|$)/.test(n)).forEach((name) => {
    for (const d of domains) {
      document.cookie = `${name}=; Max-Age=0; path=/${d ? '; domain=' + d : ''}`;
    }
  });
}

function track(name: string, params: Record<string, unknown>) {
  if (!hasConsent() || !window.gtag) return;
  window.gtag('event', name, params);
}

/** GA4 item. item_id = product slug, item_category = product type. */
export function toGaItem(i: ShopItem) {
  return {
    item_id: i.slug,
    item_name: i.name,
    item_category: i.productType || '',
    item_variant: itemVariant(i),
    price: Math.round((Number(i.price) || 0) * 100) / 100,
    quantity: i.quantity || 1,
  };
}

/* Product slug for a cart line. Carts saved before lines carried `slug` fall
   back to the id: wallart-{slug}-{format}-{size} / product-{slug}-{type}-{colour}-{size}. */
export function cartSlug(item: CartItem): string {
  if (item.slug) return item.slug;
  const id = String(item.id || '');
  const strip = (prefix: string, suffix: string) =>
    id.startsWith(prefix) && id.endsWith(suffix) && id.length > prefix.length + suffix.length
      ? id.slice(prefix.length, id.length - suffix.length) : '';
  return strip('wallart-', `-${item.format}-${item.size}`)
    || strip('product-', `-${item.productType}-${item.colour || ''}-${item.size}`)
    || id;
}

function cartGaItem(item: CartItem, quantity = item.quantity) {
  const wallArt = item.productType === 'wallart' || String(item.id).startsWith('wallart-');
  return toGaItem({
    slug: cartSlug(item),
    name: item.productName || item.title,
    productType: item.productType || (wallArt ? 'wallart' : ''),
    colour: item.colour,
    size: item.size,
    format: item.format,
    price: item.price,
    quantity,
  });
}

export function trackViewItem(i: ShopItem) {
  const item = toGaItem(i);
  track('view_item', { currency: CURRENCY, value: item.price, items: [item] });
}

export function trackAddToCart(cartItem: CartItem, quantity = 1) {
  const item = cartGaItem(cartItem, quantity);
  track('add_to_cart', { currency: CURRENCY, value: Math.round(item.price * quantity * 100) / 100, items: [item] });
}

/**
 * Before redirecting to Stripe: send begin_checkout and read the GA client and
 * session ids, together within CHECKOUT_WAIT_MS. Resolves to {} without consent
 * or if GA doesn't answer in time; only valid ids are returned.
 */
export async function prepareCheckout(items: CartItem[]): Promise<{ clientId?: string; sessionId?: string }> {
  const gtag = window.gtag;
  if (!hasConsent() || !gtag) return {};
  let clientId: unknown;
  let sessionId: unknown;
  const gaItems = items.map((i) => cartGaItem(i));
  const value = Math.round(gaItems.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
  const work = Promise.all([
    new Promise<void>((resolve) => gtag('event', 'begin_checkout', {
      currency: CURRENCY, value, items: gaItems,
      event_callback: () => resolve(), event_timeout: CHECKOUT_WAIT_MS,
    })),
    new Promise<void>((resolve) => gtag('get', GA_ID, 'client_id', (v: unknown) => { clientId = v; resolve(); })),
    new Promise<void>((resolve) => gtag('get', GA_ID, 'session_id', (v: unknown) => { sessionId = v; resolve(); })),
  ]);
  await Promise.race([work, new Promise((resolve) => setTimeout(resolve, CHECKOUT_WAIT_MS))]);
  const ids = validGaIds(clientId, sessionId);
  return ids.ga_client_id ? { clientId: ids.ga_client_id, sessionId: ids.ga_session_id } : {};
}

function handleShopEvent([name, item]: [string, ShopItem]) {
  if (name === 'view_item') trackViewItem(item);
}

/** Load GA if already accepted, then start handling queued shop events. */
export function initAnalytics() {
  if (hasConsent()) enableAnalytics();
  const queued = Array.isArray(window.fuglysShop) ? window.fuglysShop : [];
  window.fuglysShop = { push: handleShopEvent };
  queued.forEach(handleShopEvent);
}
