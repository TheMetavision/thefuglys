// Cart quantity rules, kept free of nanostores/analytics so they can be
// unit-tested directly (tests/cart-quantity.test.mjs).
//
// The checkout function (netlify/functions/create-checkout.*) is the real
// guard: it re-prices every line from Sanity and rejects any quantity that is
// not a whole number from 1 to 99. These rules keep the cart inside that.

/** Most a shopper can choose per cart line (product page selector and drawer +). */
export const MAX_QTY_PER_LINE = 10;

/**
 * Ceiling for quantities already in a saved basket. The old cart had no cap
 * (each Add to cart was +1), so a basket may hold more than MAX_QTY_PER_LINE;
 * it is kept as it is (the shopper can bring it down) as long as checkout
 * would accept it.
 */
export const STORED_QTY_CEILING = 99;

export interface QtyLine {
  id: string;
  size: string;
  quantity: number;
}

/** A requested quantity from a selector or event: whole number 1..MAX, anything else 1. */
export function requestedQty(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_QTY_PER_LINE, Math.max(1, Math.floor(n)));
}

const sameLine = (a: { id: string; size: string }, id: string, size: string) => a.id === id && a.size === size;

/**
 * Add `qty` of an item: merges into an existing line (same id + size) up to
 * MAX_QTY_PER_LINE. Returns the new list and how many were actually added
 * (0 when the line was already at the cap).
 */
export function addLine<T extends QtyLine>(items: T[], item: Omit<T, 'quantity'>, qty: unknown): { items: T[]; added: number } {
  const want = requestedQty(qty);
  const existing = items.find((i) => sameLine(i, item.id, item.size));
  if (!existing) {
    return { items: [...items, { ...item, quantity: want } as T], added: want };
  }
  const next = Math.max(existing.quantity, Math.min(existing.quantity + want, MAX_QTY_PER_LINE));
  const added = next - existing.quantity;
  if (added === 0) return { items, added: 0 };
  return { items: items.map((i) => (sameLine(i, item.id, item.size) ? { ...i, quantity: next } : i)), added };
}

/**
 * Set a line's quantity. Below 1 removes the line. Increases stop at
 * MAX_QTY_PER_LINE (a saved line already above it can only go down).
 * Non-numbers and fractions are ignored / floored.
 */
export function setLineQty<T extends QtyLine>(items: T[], id: string, size: string, qty: unknown): T[] {
  const line = items.find((i) => sameLine(i, id, size));
  if (!line) return items;
  const n = typeof qty === 'number' && Number.isFinite(qty) ? Math.floor(qty) : NaN;
  if (Number.isNaN(n)) return items;
  if (n < 1) return items.filter((i) => !sameLine(i, id, size));
  const target = n > line.quantity ? Math.max(line.quantity, Math.min(n, MAX_QTY_PER_LINE)) : n;
  if (target === line.quantity) return items;
  return items.map((i) => (sameLine(i, id, size) ? { ...i, quantity: target } : i));
}

/**
 * Read a basket from localStorage ('wf-cart-v1') defensively. The stored
 * shape is unchanged; this only drops entries that could never check out and
 * repairs quantities, so a corrupt or hand-edited basket can't break the page.
 */
export function sanitizeStoredCart(raw: unknown): QtyLine[] {
  if (!Array.isArray(raw)) return [];
  const out: QtyLine[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id || typeof e.size !== 'string') continue;
    if (typeof e.price !== 'number' || !Number.isFinite(e.price)) continue;
    const q = typeof e.quantity === 'number' && Number.isFinite(e.quantity) ? Math.floor(e.quantity) : 1;
    out.push({ ...(e as unknown as QtyLine), quantity: Math.min(STORED_QTY_CEILING, Math.max(1, q)) });
  }
  return out;
}
