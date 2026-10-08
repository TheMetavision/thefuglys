// Tests for the cart's quantity rules in src/lib/cart-quantity.ts (pure; no
// nanostores, no window). Node 23.6+ runs the .ts file directly.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { MAX_QTY_PER_LINE, requestedQty, addLine, setLineQty, sanitizeStoredCart } =
  await import('../src/lib/cart-quantity.ts');

const hoodieM = {
  id: 'product-dead-set-shred-hoodie-Black-M', slug: 'dead-set-shred', title: 'Dead Set Shred Hoodie',
  price: 49.5, size: 'M', colour: 'Black', image: 'x', productType: 'hoodie', stripePriceId: '',
};
const hoodieL = { ...hoodieM, id: 'product-dead-set-shred-hoodie-Black-L', size: 'L' };
const line = (item, quantity) => ({ ...item, quantity });

test('the cap is 10 per line', () => {
  assert.equal(MAX_QTY_PER_LINE, 10);
});

test('requestedQty: whole numbers 1..10; anything else becomes 1', () => {
  assert.equal(requestedQty(3), 3);
  assert.equal(requestedQty('4'), 4);
  assert.equal(requestedQty(2.9), 2);
  assert.equal(requestedQty(50), 10);
  for (const bad of [0, -5, NaN, Infinity, undefined, null, '', 'lots', true, [2], {}]) {
    assert.equal(requestedQty(bad), 1, `requestedQty(${String(bad)})`);
  }
});

test('addLine: same variant merges (1 + 1 = 2), a new size is a new line', () => {
  let { items, added } = addLine([], hoodieM, 1);
  assert.equal(added, 1);
  ({ items, added } = addLine(items, hoodieM, undefined));
  assert.equal(added, 1);
  assert.deepEqual(items.map((i) => i.quantity), [2]);
  ({ items } = addLine(items, hoodieL, 3));
  assert.deepEqual(items.map((i) => [i.size, i.quantity]), [['M', 2], ['L', 3]]);
});

test('addLine: adding a chosen quantity stops at the cap and reports what was added', () => {
  let { items, added } = addLine([line(hoodieM, 8)], hoodieM, 5);
  assert.equal(items[0].quantity, 10);
  assert.equal(added, 2);
  ({ items, added } = addLine(items, hoodieM, 1));
  assert.equal(added, 0);
  assert.equal(items[0].quantity, 10);
});

test('addLine: a saved line already above the cap is not reduced by adding', () => {
  const { items, added } = addLine([line(hoodieM, 12)], hoodieM, 1);
  assert.equal(items[0].quantity, 12);
  assert.equal(added, 0);
});

test('setLineQty: + and − within 1..10; below 1 removes; the cap holds', () => {
  const start = [line(hoodieM, 2), line(hoodieL, 1)];
  assert.equal(setLineQty(start, hoodieM.id, 'M', 3)[0].quantity, 3);
  assert.equal(setLineQty(start, hoodieM.id, 'M', 1)[0].quantity, 1);
  assert.deepEqual(setLineQty(start, hoodieM.id, 'M', 0).map((i) => i.size), ['L']);
  assert.equal(setLineQty([line(hoodieM, 10)], hoodieM.id, 'M', 11)[0].quantity, 10);
  // a saved line of 12 can come down but not go up
  assert.equal(setLineQty([line(hoodieM, 12)], hoodieM.id, 'M', 11)[0].quantity, 11);
  assert.equal(setLineQty([line(hoodieM, 12)], hoodieM.id, 'M', 13)[0].quantity, 12);
  // only the targeted line changes
  assert.equal(setLineQty(start, hoodieM.id, 'M', 5)[1].quantity, 1);
});

test('setLineQty: junk is ignored, fractions are floored, unknown lines are a no-op', () => {
  const start = [line(hoodieM, 2)];
  for (const bad of ['5', NaN, Infinity, null, undefined, true, [4]]) {
    assert.equal(setLineQty(start, hoodieM.id, 'M', bad), start, `setLineQty(${JSON.stringify(bad)})`);
  }
  assert.equal(setLineQty(start, hoodieM.id, 'M', 3.7)[0].quantity, 3);
  assert.equal(setLineQty(start, 'nope', 'M', 3), start);
});

test('sanitizeStoredCart: a basket saved by the old cart loads unchanged', () => {
  // exactly what the pre-change cart wrote to localStorage 'wf-cart-v1'
  const saved = JSON.parse(JSON.stringify([
    line(hoodieM, 2),
    { id: 'product-x-mug--One Size', title: 'Mug', price: 14, size: 'One Size', image: 'y', quantity: 1 }, // no slug/colour (older shape)
    line(hoodieL, 14), // the old cart had no cap
  ]));
  assert.deepEqual(sanitizeStoredCart(saved), saved);
});

test('sanitizeStoredCart: repairs or drops what could never check out', () => {
  assert.deepEqual(sanitizeStoredCart(null), []);
  assert.deepEqual(sanitizeStoredCart({ items: [] }), []);
  const out = sanitizeStoredCart([
    null, 'x', { title: 'no id', price: 1, size: 'M', quantity: 1 },
    { id: 'a', size: 'M', price: 'free', quantity: 1 },
    { id: 'b', size: 'M', price: 10, quantity: 0 },
    { id: 'c', size: 'M', price: 10, quantity: -3 },
    { id: 'd', size: 'M', price: 10, quantity: 2.6 },
    { id: 'e', size: 'M', price: 10, quantity: 1e6 },
    { id: 'f', size: 'M', price: 10, quantity: '3' },
  ]);
  assert.deepEqual(out.map((i) => [i.id, i.quantity]), [['b', 1], ['c', 1], ['d', 2], ['e', 99], ['f', 1]]);
});
