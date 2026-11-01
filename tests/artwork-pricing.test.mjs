// Wall art (made in-house): prices, sizes and orientation.
// Ported from Wyrmfuel's tests/wall-art.test.mjs (the pricing and size parts).
// Pure functions only; nothing leaves the machine.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/lib/artwork-pricing.mjs';

test('prices are unchanged and match Comic Strip Canvas, in pence', () => {
  assert.deepEqual(P.ARTWORK_PRICES, {
    poster: { small: 999, medium: 1299, large: 1699 },
    'canvas-standard': { small: 2699, medium: 3199, large: 4499 },
    'canvas-gallery': { small: 2899, medium: 3399, large: 4699 },
  });
  assert.equal(P.ARTWORK_FROM_PRICE, 999);
  assert.equal(P.artworkPrice('poster', 'medium'), 1299);
  assert.throws(() => P.artworkPrice('poster', 'xl'));
  assert.throws(() => P.artworkPrice('framed', 'large'));
});

test('size ids are still small, medium and large', () => {
  assert.deepEqual(P.ARTWORK_SIZES.map((s) => s.id), ['small', 'medium', 'large']);
});

test('sizes are 12x8, 18x12 and 24x16, turned for portrait pieces', () => {
  assert.deepEqual(['small', 'medium', 'large'].map((s) => P.artworkDimensions(s, 'landscape')), ['12x8', '18x12', '24x16']);
  assert.deepEqual(['small', 'medium', 'large'].map((s) => P.artworkDimensions(s, 'portrait')), ['8x12', '12x18', '16x24']);
  assert.equal(P.artworkSizeInches('medium', 'landscape'), '18 x 12"');
  assert.equal(P.artworkSizeInches('medium', 'portrait'), '12 x 18"');
  assert.equal(P.artworkVariantLabel('canvas-gallery', 'large', 'portrait'), 'Canvas — Gallery Frame · Large (16 x 24")');
  assert.equal(P.artworkVariantLabel('poster', 'medium', 'landscape'), 'Poster Print · Medium (18 x 12")');
});

test('16x12 is gone from every label', () => {
  for (const f of P.ARTWORK_FORMATS) for (const s of P.ARTWORK_SIZES) for (const o of ['landscape', 'portrait']) {
    assert.doesNotMatch(P.artworkVariantLabel(f.id, s.id, o), /16 x 12|12 x 16/);
  }
});

test('no or unknown orientation means landscape (old carts, old Stripe sessions)', () => {
  assert.equal(P.artworkVariantLabel('poster', 'medium'), 'Poster Print · Medium (18 x 12")');
  assert.equal(P.artworkDimensions('medium', 'sideways'), '18x12');
  assert.equal(P.normOrientation(undefined), 'landscape');
  assert.equal(P.normOrientation('portrait'), 'portrait');
});

test('orientation comes from the image width and height, landscape when they are missing', () => {
  assert.equal(P.orientationFromDimensions(1536, 1024), 'landscape');
  assert.equal(P.orientationFromDimensions(1024, 1536), 'portrait');
  assert.equal(P.orientationFromDimensions(1024, 1024), 'landscape');
  const missing = [];
  assert.equal(P.orientationFromDimensions(undefined, 1536, () => missing.push('a')), 'landscape');
  assert.equal(P.orientationFromDimensions(0, 0, () => missing.push('b')), 'landscape');
  assert.equal(P.orientationFromDimensions('x', null, () => missing.push('c')), 'landscape');
  assert.deepEqual(missing, ['a', 'b', 'c']);
});

test('a line id names its own format and size, or no slug at all', () => {
  assert.equal(P.wallArtLineId('scabby-road', 'poster', 'large'), 'wallart-scabby-road-poster-large');
  assert.equal(P.slugFromLineId('wallart-group-a-poster-large', 'poster', 'large'), 'group-a');
  assert.equal(P.slugFromLineId('wallart-group-a-poster-large', 'canvas-gallery', 'large'), '');
  assert.equal(P.slugFromLineId('product-group-a-poster-large', 'poster', 'large'), '');
  assert.equal(P.isWallArt({ productType: 'wallart' }), true);
  assert.equal(P.isWallArt({ id: 'wallart-x-poster-small' }), true);
  assert.equal(P.isWallArt({ id: 'product-x-tee-black-m', productType: 'tee' }), false);
});
