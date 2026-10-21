// The Merchant Center feed and the product pages' structured data come from the
// same purchasable variants (src/lib/merchant-feed.mjs): what the page offers and
// the checkout accepts, at the checkout's price, with delivery from shipping-regions.mjs.
//
// Pure: a fixture product, no network.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHIPPING_REGIONS, FREE_UK_THRESHOLD_PENCE } from '../src/lib/shipping-regions.mjs';
import { productGroups, feedXml, productGroupsJsonLd, variantLink, FEED_COUNTRIES, TYPE_INFO } from '../src/lib/merchant-feed.mjs';

const site = { brand: 'Test & Co', url: 'https://example.test', productPath: '/products/', returnsUrl: 'https://example.test/legal/returns-refunds/' };
const img = (n) => `https://cdn.sanity.io/images/x/production/${n}-2000x2000.jpg`;
const product = {
  name: 'Rat & Roll', slug: 'rat-and-roll', description: 'A <loud> design.',
  variants: [
    { productType: 'tshirt', label: 'T-Shirt', basePrice: 25,
      sizePrices: [{ size: 'S', price: 25 }, { size: '2XL', price: 27.5 }],
      colourImages: [{ colour: 'Black', imageUrl: img('b') }, { colour: 'Sport Grey', imageUrl: img('g') }],
      printfulVariants: [
        { size: 'S', colour: 'Black', syncVariantId: 101 }, { size: '2XL', colour: 'Black', syncVariantId: 102 },
        { size: 'S', colour: 'Sport Grey', syncVariantId: 103 },
        { size: 'S', colour: 'Red', syncVariantId: 104 }, // no picture: the page doesn't offer Red
        { size: 'M', colour: 'Black' }, // no sync id: the checkout can't sell it
      ] },
    { productType: 'babygrow', label: 'Baby Grow', basePrice: 18.5, sizePrices: [],
      colourImages: [{ colour: 'White', imageUrl: img('w') }],
      printfulVariants: [{ size: '6M', colour: 'White', syncVariantId: 201 }, { size: '18M', colour: 'White', syncVariantId: 202 }] },
    { productType: 'mug', label: '11oz Mug', basePrice: 12.95, sizePrices: [{ size: '11 oz', price: 12.95 }],
      colourImages: [{ colour: '', imageUrl: img('m1') }, { colour: '', imageUrl: img('m2') }, { colour: '', imageUrl: img('m3') }],
      printfulVariants: [{ size: '11 oz', colour: '', syncVariantId: 301 }] },
    { productType: 'sticker', label: 'Sticker', basePrice: 7.5, sizePrices: [],
      colourImages: [{ colour: 'White', imageUrl: img('s') }], printfulVariants: [{ size: '5.5″×5.5″', colour: 'White', syncVariantId: 401 }] },
    { productType: 'mystery', label: 'Mystery', basePrice: 9, colourImages: [{ colour: '', imageUrl: img('q') }],
      printfulVariants: [{ size: 'One Size', colour: '', syncVariantId: 501 }] },
  ],
};
const shipTo = { blocked: { tshirt: ['BR'] } };

test('items are exactly the variants the page offers and the checkout sells', () => {
  const log = [];
  const groups = productGroups(product, site, shipTo, (s) => log.push(s));
  const ids = groups.flatMap((g) => g.items.map((it) => it.id));
  assert.deepEqual(ids, ['101', '102', '103', '201', '202', '301', '401']);
  assert.ok(log.some((l) => l.includes('mystery')), 'unknown type is logged');
  const t = groups.find((g) => g.type === 'tshirt');
  assert.equal(t.groupId, 'rat-and-roll-tshirt');
  assert.deepEqual(t.items.map((it) => it.price), [25, 27.5, 25]);
});

test('apparel carries colour, size and age group; babygrows by size; drinkware and stickers as they should', () => {
  const groups = productGroups(product, site, shipTo);
  const by = (id) => groups.flatMap((g) => g.items).find((it) => it.id === id);
  assert.equal(by('101').ageGroup, 'adult');
  assert.equal(by('201').ageGroup, 'infant');
  assert.equal(by('202').ageGroup, 'toddler');
  assert.equal(by('301').feedColour, TYPE_INFO.mug.colour);
  assert.equal(by('301').ageGroup, '');
  assert.deepEqual(by('301').images, [img('m2'), img('m3')]);
  assert.equal(by('401').feedColour, '');
});

test('links preselect the variant; colourless garments have no colour in the link', () => {
  assert.equal(variantLink(site, 'rat-and-roll', 'tshirt', 'Sport Grey', '2XL'),
    'https://example.test/products/rat-and-roll/?type=tshirt&colour=Sport%20Grey&size=2XL');
  const groups = productGroups(product, site, shipTo);
  assert.equal(groups.find((g) => g.type === 'mug').items[0].link, 'https://example.test/products/rat-and-roll/?type=mug&size=11%20oz');
});

test('the feed is escaped XML with delivery from shipping-regions.mjs', () => {
  const { count, xml } = feedXml([product], site, shipTo);
  assert.equal(count, 7);
  assert.ok(xml.includes('<g:title>Rat &amp; Roll T-Shirt – Sport Grey, S</g:title>'));
  assert.ok(xml.includes('A &lt;loud&gt; design.'));
  assert.ok(xml.includes('?type=tshirt&amp;colour=Black&amp;size=2XL'));
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml), 'every & is escaped');
  const uk = SHIPPING_REGIONS.find((r) => r.id === 'uk');
  assert.ok(xml.includes(`<g:price>${(uk.pence / 100).toFixed(2)} GBP</g:price>`));
  assert.ok(xml.includes(`<g:price_threshold>${(FREE_UK_THRESHOLD_PENCE / 100).toFixed(2)} GBP</g:price_threshold>`));
  assert.equal((xml.match(/<g:shipping>/g) || []).length, 7 * FEED_COUNTRIES.length);
  assert.ok(xml.includes('<g:age_group>infant</g:age_group>') && xml.includes('<g:size_system>UK</g:size_system>'));
});

test('the structured data has the feed items: same sku, price, link, delivery and returns', () => {
  const groups = productGroups(product, site, shipTo);
  const ld = productGroupsJsonLd(product, site, shipTo);
  assert.equal(ld.length, groups.length);
  const variants = ld.flatMap((g) => g.hasVariant);
  const items = groups.flatMap((g) => g.items);
  assert.deepEqual(variants.map((v) => v.sku), items.map((it) => it.id));
  assert.deepEqual(variants.map((v) => Number(v.offers.price)), items.map((it) => it.price));
  assert.deepEqual(variants.map((v) => v.offers.url), items.map((it) => it.link));
  const uk = SHIPPING_REGIONS.find((r) => r.id === 'uk');
  for (const v of variants) {
    assert.equal(v.offers.shippingDetails[0].shippingRate.value, (uk.pence / 100).toFixed(2));
    assert.equal(v.offers.hasMerchantReturnPolicy.merchantReturnDays, 14);
    assert.equal(v.offers.availability, 'https://schema.org/InStock');
  }
  assert.equal(ld[0].productGroupID, 'rat-and-roll-tshirt');
});

test('a garment Printful will not ship to any feed country is left out', () => {
  const groups = productGroups(product, site, { blocked: { tshirt: FEED_COUNTRIES } });
  assert.ok(!groups.some((g) => g.type === 'tshirt'));
});

// Wall art: one item per artwork × format × size, at the checkout's price (artwork-pricing.mjs).
import { wallArtGroup, wallArtJsonLd, WALL_ART_INFO } from '../src/lib/merchant-feed.mjs';
import { ARTWORK_FORMATS, ARTWORK_SIZES, artworkPrice } from '../src/lib/artwork-pricing.mjs';

const piece = { slug: 'lab-at-night', title: 'Lab At Night', description: 'Neon & glass.', imageUrl: img('art'),
  studioMockupUrl: img('studio'), posterMockupUrl: img('poster'), roomMockupUrl: '', mockups: [{ url: img('studio') }, { url: img('extra') }] };

test('wall art: every format × size at the checkout price, linked with the format and size preselected', () => {
  const g = wallArtGroup(piece, site);
  assert.equal(g.groupId, 'wallart-lab-at-night');
  assert.equal(g.info, WALL_ART_INFO);
  assert.equal(g.items.length, ARTWORK_FORMATS.length * ARTWORK_SIZES.length);
  for (const f of ARTWORK_FORMATS) for (const s of ARTWORK_SIZES) {
    const it = g.items.find((x) => x.link === `https://example.test/wall-art/lab-at-night/?format=${f.id}&size=${s.id}`);
    assert.ok(it, `${f.id}/${s.id}`);
    assert.equal(it.price, artworkPrice(f.id, s.id) / 100);
    assert.ok(it.id.length <= 50);
  }
  assert.equal(new Set(g.items.map((it) => it.id)).size, g.items.length, 'ids unique');
  assert.equal(g.items[0].image, img('art'));
  assert.deepEqual(g.items[0].images, [img('studio'), img('poster'), img('extra')]);
});

test('wall art is in the feed and its structured data has the same items', () => {
  const { count, xml } = feedXml([], site, shipTo, () => {}, [piece]);
  assert.equal(count, ARTWORK_FORMATS.length * ARTWORK_SIZES.length);
  assert.ok(xml.includes('<g:google_product_category>500044</g:google_product_category>'));
  assert.ok(xml.includes('<g:material>Canvas, gallery frame</g:material>'));
  assert.ok(xml.includes('Neon &amp; glass.'));
  const g = wallArtGroup(piece, site);
  const ld = wallArtJsonLd(piece, site)[0];
  assert.deepEqual(ld.hasVariant.map((v) => v.sku), g.items.map((it) => it.id));
  assert.deepEqual(ld.hasVariant.map((v) => Number(v.offers.price)), g.items.map((it) => it.price));
  assert.equal(ld.hasVariant[0].offers.hasMerchantReturnPolicy.merchantReturnDays, 14);
});
