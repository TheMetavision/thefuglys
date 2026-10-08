import { atom, computed } from 'nanostores';
import { persistentAtom } from '@nanostores/persistent';
import { trackAddToCart } from './analytics';
import { addLine, setLineQty, sanitizeStoredCart, MAX_QTY_PER_LINE } from './cart-quantity';

export { MAX_QTY_PER_LINE };

export interface CartItem {
  id: string;        // POD: product-{slug}-{type}-{colour}-{size}  ·  wall art: wallart-{slug}-{format}-{size}
  title: string;
  slug?: string;        // product / wall-art slug (GA4 item_id); older saved carts lack it — see cartSlug()
  productName?: string; // product name without the garment label (GA4 item_name)
  price: number;     // per-size price, already resolved on the PDP (server re-prices wall art)
  size: string;
  colour?: string;
  format?: string;   // wall art only: format id (poster | canvas-standard | canvas-gallery)
  image: string;
  productType?: string;
  quantity: number;
  stripePriceId?: string; // vestigial; checkout uses ad-hoc price_data
}

// Keep in sync with FREE_THRESHOLD_PENCE (7500) in create-checkout.js.
export const FREE_SHIPPING_THRESHOLD = 75;

// Brand-scoped persist key so no other brand's cart can leak in.
// Key and stored shape unchanged by quantity controls; decoding only repairs
// or drops entries that could never check out (see sanitizeStoredCart).
export const $cartItems = persistentAtom<CartItem[]>('fuglys-cart-v1', [], {
  encode: JSON.stringify,
  decode: (raw) => {
    try {
      return sanitizeStoredCart(JSON.parse(raw)) as CartItem[];
    } catch {
      return [];
    }
  },
});

export const $cartOpen = atom(false);

export const $cartTotal = computed($cartItems, (items) =>
  items.reduce((sum, item) => sum + item.price * item.quantity, 0)
);
export const $cartCount = computed($cartItems, (items) =>
  items.reduce((sum, item) => sum + item.quantity, 0)
);
export const $qualifiesForFreeShipping = computed($cartTotal, (t) => t >= FREE_SHIPPING_THRESHOLD);
export const $amountToFreeShipping = computed($cartTotal, (t) => Math.max(0, FREE_SHIPPING_THRESHOLD - t));

/**
 * Add `quantity` (default 1) of an item. The same variant merges into one
 * line, capped at MAX_QTY_PER_LINE. Returns how many were actually added.
 */
export function addToCart(item: Omit<CartItem, 'quantity'>, quantity: unknown = 1): number {
  const { items, added } = addLine($cartItems.get(), item, quantity);
  if (added > 0) $cartItems.set(items);
  $cartOpen.set(true);
  // Every add goes through here (CartDrawer's add-to-cart listener). No-op without consent.
  if (added > 0) trackAddToCart({ ...item, quantity: added }, added);
  return added;
}

/** Set a line's quantity from the drawer's − / + controls. Below 1 removes it. */
export function setQuantity(id: string, size: string, quantity: number) {
  const before = $cartItems.get();
  const line = before.find((i) => i.id === id && i.size === size);
  const after = setLineQty(before, id, size, quantity);
  if (after === before) return;
  $cartItems.set(after);
  const now = after.find((i) => i.id === id && i.size === size);
  if (line && now && now.quantity > line.quantity) {
    trackAddToCart(now, now.quantity - line.quantity);
  }
}

export function removeFromCart(id: string, size: string) {
  $cartItems.set($cartItems.get().filter((i) => !(i.id === id && i.size === size)));
}
export function clearCart() { $cartItems.set([]); }
export function toggleCart() { $cartOpen.set(!$cartOpen.get()); }
export function closeCart() { $cartOpen.set(false); }

// ── Backwards-compatible aliases ──
// Existing Fuglys components (e.g. CartButton.tsx) import the store atoms
// without the `$` prefix. These alias the same stores so both naming
// conventions resolve to one source of truth.
export const cartItems = $cartItems;
export const cartOpen = $cartOpen;
export const cartTotal = $cartTotal;
export const cartCount = $cartCount;
export const qualifiesForFreeShipping = $qualifiesForFreeShipping;
export const amountToFreeShipping = $amountToFreeShipping;
