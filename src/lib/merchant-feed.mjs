// src/lib/merchant-feed.mjs — the Google Merchant Center feed (/feeds/google-merchant.xml)
// and the product pages' ProductGroup structured data, from ONE list of purchasable
// variants, so the two can never disagree.
//
// A purchasable variant is what the product page lets you put in the basket and the
// checkout accepts (netlify/functions/create-checkout.cjs findVariantMatch): one
// printfulVariants entry (with a sync id) of an active product, in a colour the page
// offers (coloursFor in the page script), at the page's and the checkout's price
// (the size's sizePrices entry, else basePrice). Each one becomes a feed item and a
// hasVariant Product, linked as /products/<slug>/?type=&colour=&size=, which the page
// preselects. The page's canonical stays the plain product URL.
//
// Delivery comes from shipping-regions.mjs. FEED_COUNTRIES says which countries the
// feed and the structured data quote; adding one is a one-line change there (items
// Printful won't ship to it, per src/data/ship-to.json, simply carry no rate for it).
// The same file is in all four IP-brand sites; keep the copies identical.

import { SHIPPING_REGIONS, FREE_UK_THRESHOLD_PENCE, regionFor } from './shipping-regions.mjs';

/** Countries the feed quotes delivery for (ISO codes from shipping-regions.mjs). */
export const FEED_COUNTRIES = ['GB'];

/** Business days to make an order (Shipping Policy section 2); the rest of a region's days is transit. */
export const MAKE_DAYS = [2, 5];

/** Days to tell us you're cancelling (Returns & Refunds section 2); the customer pays return postage. */
export const RETURN_DAYS = 14;

/*
 * What each product type is, for Google. category: Google product taxonomy id
 * (taxonomy-with-ids.en-GB.txt). age: Google age_group ('babygrow' goes by size).
 * colour: the colour to quote when the Printful variant has none (mugs are white;
 * the socks' foot is black, the rest printed all over). Types not listed here are
 * left out of the feed and logged, rather than guessed.
 */
export const TYPE_INFO = {
  tshirt: { category: 212, productType: 'Clothing > T-Shirts', age: 'adult' },
  hoodie: { category: 212, productType: 'Clothing > Hoodies', age: 'adult' },
  tank: { category: 212, productType: 'Clothing > Vest Tops', age: 'adult' },
  longsleeve: { category: 212, productType: 'Clothing > Long Sleeve T-Shirts', age: 'adult' },
  socks: { category: 209, productType: 'Clothing > Socks', age: 'adult', colour: 'Multicolour' },
  'kids-tshirt': { category: 212, productType: 'Kids > T-Shirts', age: 'kids' },
  'kids-hoodie': { category: 212, productType: 'Kids > Hoodies', age: 'kids' },
  'kids-longsleeve': { category: 212, productType: 'Kids > Long Sleeve T-Shirts', age: 'kids' },
  babygrow: { category: 5411, productType: 'Baby > Babygros', age: 'by-size' },
  mug: { category: 2169, productType: 'Drinkware > Mugs', colour: 'White' },
  tumbler: { category: 2951, productType: 'Drinkware > Tumblers' },
  sticker: { category: 4054, productType: 'Stickers > Sticker Sheets', noColour: true },
  'holographic-sticker': { category: 4054, productType: 'Stickers > Holographic Sticker Sheets', noColour: true },
};

/** Google age_group for a baby size: up to 12 months infant, then toddler. */
const babyAge = (size) => (parseInt(String(size), 10) <= 12 ? 'infant' : 'toddler');

const norm = (s) => String(s == null ? '' : s).trim();

/** The page's price for a size (sizePrices entry, else basePrice), or null. */
export function priceFor(variant, size) {
  const sp = (variant.sizePrices || []).find((s) => norm(s.size) === norm(size));
  const p = sp ? sp.price : variant.basePrice;
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null;
}

/** Colours the page offers for a garment, in its order (coloursFor in the page script). */
export function coloursFor(variant) {
  const matrix = variant.printfulVariants || [];
  const inMatrix = new Set(matrix.map((m) => norm(m.colour)));
  let opts = (variant.colourImages || []).map((c) => norm(c.colour)).filter((c) => inMatrix.has(c));
  if (!opts.length) opts = [...inMatrix];
  return [...new Set(opts)];
}

/** Product page link that preselects a variant (colour/size left out when the page has none to pick). */
export function variantLink(site, slug, type, colour, size) {
  const q = new URLSearchParams({ type });
  if (colour) q.set('colour', colour);
  if (size) q.set('size', size);
  return `${site.url}${site.productPath}${slug}/?${q.toString().replace(/\+/g, '%20')}`;
}

/** An id of at most 50 characters (Google's limit), stable for the same input. */
function shortId(s) {
  if (s.length <= 50) return s;
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${s.slice(0, 41)}-${h.toString(36)}`.slice(0, 50);
}

/** Delivery for one country: { country, service, pence, free, days, transit } or null if we don't deliver there. */
export function deliveryFor(country) {
  const r = regionFor(country);
  if (!r) return null;
  return {
    country,
    service: r.name,
    pence: r.pence,
    freeFromPence: r.id === 'uk' ? FREE_UK_THRESHOLD_PENCE : null,
    days: r.days,
    transit: [Math.max(1, r.days[0] - MAKE_DAYS[0]), Math.max(1, r.days[1] - MAKE_DAYS[1])],
  };
}

/**
 * Every purchasable variant of one product, grouped by garment:
 * [{ groupId, type, label, info, items: [{ id, colour, feedColour, size, price, link, image, images, ageGroup, countries }] }]
 * `shipTo` is src/data/ship-to.json ({ blocked: { <type>: [ISO2, ...] } }); `log` gets the left-out reasons.
 */
export function productGroups(product, site, shipTo, log = () => {}) {
  const groups = [];
  for (const v of product.variants || []) {
    const info = TYPE_INFO[v.productType];
    if (!info) { log(`${product.slug}/${v.productType}: not a known product type, left out`); continue; }
    const blocked = (shipTo && shipTo.blocked && shipTo.blocked[v.productType]) || [];
    const countries = FEED_COUNTRIES.filter((c) => !blocked.includes(c) && deliveryFor(c));
    if (!countries.length) { log(`${product.slug}/${v.productType}: ships to none of ${FEED_COUNTRIES.join(', ')}, left out`); continue; }
    const colours = coloursFor(v);
    const colourless = colours.filter(Boolean).length <= 1; // the page hides the picker and uses the only colour
    const items = [];
    for (const colour of colours) {
      const images = (v.colourImages || []).filter((c) => norm(c.colour) === colour && c.imageUrl).map((c) => c.imageUrl);
      if (!images.length && v.colourImages?.[0]?.imageUrl) images.push(v.colourImages[0].imageUrl);
      if (!images.length) { log(`${product.slug}/${v.productType}/${colour || '-'}: no picture, left out`); continue; }
      const seen = new Set();
      for (const pv of (v.printfulVariants || []).filter((m) => norm(m.colour) === colour)) {
        const size = norm(pv.size);
        if (!pv.syncVariantId || seen.has(size)) continue;
        seen.add(size);
        const price = priceFor(v, size);
        if (price == null) { log(`${product.slug}/${v.productType}/${colour}/${size}: no price, left out`); continue; }
        items.push({
          id: String(pv.syncVariantId),
          colour,
          feedColour: info.noColour ? '' : colour || info.colour || '',
          size,
          price,
          link: variantLink(site, product.slug, v.productType, colourless ? '' : colour, size),
          image: images[0],
          images: images.slice(1, 11),
          ageGroup: info.age === 'by-size' ? babyAge(size) : info.age || '',
          countries,
        });
      }
    }
    if (items.length) groups.push({ groupId: shortId(`${product.slug}-${v.productType}`), type: v.productType, label: v.label || v.productType, info, items });
  }
  return groups;
}

const money = (n) => `${Number(n).toFixed(2)} GBP`;
const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const xmlEscape = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** The product's own words: SEO description, description, tagline or backstory. */
export function baseDescription(product, site) {
  return norm(product.seoDescription || product.description || product.tagline || product.backstory)
    || `${product.name}: official ${site.brand} merchandise.`;
}

const variantName = (product, g, it) =>
  `${product.name} ${g.label}${[it.feedColour, it.size].filter(Boolean).length ? ` – ${[it.feedColour, it.size].filter(Boolean).join(', ')}` : ''}`;

function itemDescription(product, site, g, it) {
  const uk = deliveryFor('GB');
  const what = [it.feedColour, it.size && `size ${it.size}`].filter(Boolean).join(', ');
  return truncate(`${baseDescription(product, site)} This listing is the ${site.brand} ${g.label}${what ? ` in ${what}` : ''}, `
    + `printed to order and dispatched in ${MAKE_DAYS[0]}–${MAKE_DAYS[1]} business days. `
    + `UK delivery £${(uk.pence / 100).toFixed(2)}, free when your goods total is £${uk.freeFromPence / 100} or more.`, 4900);
}

/** One <item> per purchasable variant of every product. */
export function feedItemsXml(products, site, shipTo, log) {
  const out = [];
  for (const product of products) {
    for (const g of productGroups(product, site, shipTo, log)) {
      for (const it of g.items) {
        const lines = [
          ['g:id', it.id],
          ['g:item_group_id', g.groupId],
          ['g:title', truncate(variantName(product, g, it), 150)],
          ['g:description', itemDescription(product, site, g, it)],
          ['g:link', it.link],
          ['g:image_link', it.image],
          ...it.images.map((u) => ['g:additional_image_link', u]),
          ['g:availability', 'in_stock'],
          ['g:price', money(it.price)],
          ['g:brand', site.brand],
          ['g:condition', 'new'],
          ['g:identifier_exists', 'no'],
          ['g:google_product_category', g.info.category],
          ['g:product_type', `${site.brand} > ${g.info.productType}`],
          ...(it.feedColour ? [['g:color', it.feedColour]] : []),
          ...(it.size ? [['g:size', it.size]] : []),
          ...(it.ageGroup ? [['g:age_group', it.ageGroup], ['g:gender', 'unisex'], ['g:size_system', 'UK'], ['g:size_type', 'regular']] : []),
          ['g:custom_label_0', g.type],
        ];
        let xml = `\n    <item>\n${lines.map(([k, v]) => `      <${k}>${xmlEscape(v)}</${k}>`).join('\n')}`;
        for (const c of it.countries) {
          const d = deliveryFor(c);
          xml += `\n      <g:shipping>\n        <g:country>${c}</g:country>\n        <g:service>${xmlEscape(d.service)}</g:service>\n        <g:price>${money(d.pence / 100)}</g:price>`
            + `\n        <g:min_handling_time>${MAKE_DAYS[0]}</g:min_handling_time>\n        <g:max_handling_time>${MAKE_DAYS[1]}</g:max_handling_time>`
            + `\n        <g:min_transit_time>${d.transit[0]}</g:min_transit_time>\n        <g:max_transit_time>${d.transit[1]}</g:max_transit_time>\n      </g:shipping>`;
          if (d.freeFromPence != null) {
            xml += `\n      <g:free_shipping_threshold>\n        <g:country>${c}</g:country>\n        <g:price_threshold>${money(d.freeFromPence / 100)}</g:price_threshold>\n      </g:free_shipping_threshold>`;
          }
        }
        out.push(`${xml}\n    </item>`);
      }
    }
  }
  return out;
}

/** The whole RSS 2.0 feed. */
export function feedXml(products, site, shipTo, log) {
  const items = feedItemsXml(products, site, shipTo, log);
  return { count: items.length, xml: `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${xmlEscape(site.brand)} — Google Merchant Center feed</title>
    <link>${site.url}/</link>
    <description>${xmlEscape(site.brand)} merchandise, one item per colour and size.</description>${items.join('')}
  </channel>
</rss>
` };
}

/** schema.org shipping for one country, as the feed quotes it. */
function shippingDetails(country) {
  const d = deliveryFor(country);
  const days = (min, max) => ({ '@type': 'QuantitativeValue', minValue: min, maxValue: max, unitCode: 'DAY' });
  return {
    '@type': 'OfferShippingDetails',
    shippingRate: { '@type': 'MonetaryAmount', value: (d.pence / 100).toFixed(2), currency: 'GBP' },
    shippingDestination: { '@type': 'DefinedRegion', addressCountry: country },
    deliveryTime: { '@type': 'ShippingDeliveryTime', handlingTime: days(MAKE_DAYS[0], MAKE_DAYS[1]), transitTime: days(d.transit[0], d.transit[1]) },
  };
}

/** The Returns & Refunds page, for structured data: 14 days, by post, customer pays return postage. */
function returnPolicy(site, countries) {
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: countries,
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: RETURN_DAYS,
    returnMethod: 'https://schema.org/ReturnByMail',
    returnFees: 'https://schema.org/ReturnFeesCustomerResponsibility',
    merchantReturnLink: site.returnsUrl,
  };
}

/**
 * The product page's structured data: one ProductGroup per garment, each variant a
 * Product whose sku, price, availability, link, delivery and returns are the feed item's.
 */
export function productGroupsJsonLd(product, site, shipTo) {
  const pageUrl = `${site.url}${site.productPath}${product.slug}/`;
  const description = baseDescription(product, site);
  return productGroups(product, site, shipTo).map((g) => ({
    '@context': 'https://schema.org',
    '@type': 'ProductGroup',
    '@id': `${pageUrl}#${g.type}`,
    name: `${product.name} ${g.label}`,
    description,
    url: pageUrl,
    brand: { '@type': 'Brand', name: site.brand },
    productGroupID: g.groupId,
    variesBy: [...(g.items.some((it) => it.feedColour) ? ['https://schema.org/color'] : []), 'https://schema.org/size'],
    hasVariant: g.items.map((it) => ({
      '@type': 'Product',
      sku: it.id,
      name: variantName(product, g, it),
      image: [it.image, ...it.images],
      ...(it.feedColour ? { color: it.feedColour } : {}),
      ...(it.size ? { size: it.size } : {}),
      ...(it.ageGroup ? { audience: { '@type': 'PeopleAudience', suggestedGender: 'unisex', suggestedAge: { '@type': 'QuantitativeValue', name: it.ageGroup } } } : {}),
      offers: {
        '@type': 'Offer',
        url: it.link,
        price: it.price.toFixed(2),
        priceCurrency: 'GBP',
        availability: 'https://schema.org/InStock',
        itemCondition: 'https://schema.org/NewCondition',
        shippingDetails: it.countries.map(shippingDetails),
        hasMerchantReturnPolicy: returnPolicy(site, it.countries),
        seller: { '@id': `${site.url}/#organization` },
      },
    })),
  }));
}
