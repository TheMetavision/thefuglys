// src/pages/feeds/google-merchant.xml.ts
//
// /feeds/google-merchant.xml — the Google Merchant Center feed, built at BUILD time
// from production Sanity (a static file: every deploy refreshes it). One item per
// purchasable variant (design × product type × colour × size), at the price the page
// shows and the checkout charges. Built by src/lib/merchant-feed.mjs, which also
// writes the product pages' structured data, so the two agree.
//
// The build log gets a one-line summary: item count, and anything left out and why.

import type { APIRoute } from 'astro';
import { getAllProducts } from '../../lib/sanity';
import { MERCHANT_SITE } from '../../lib/merchant-site';
import { feedXml } from '../../lib/merchant-feed.mjs';
import shipTo from '../../data/ship-to.json';

export const prerender = true;

export const GET: APIRoute = async () => {
  const products = await getAllProducts();
  const leftOut: string[] = [];
  const { count, xml } = feedXml(products || [], MERCHANT_SITE, shipTo, (s: string) => leftOut.push(s));
  console.log(`[google-merchant] ${count} items from ${products?.length || 0} products${leftOut.length ? `; left out: ${leftOut.join('; ')}` : ''}`);
  return new Response(xml, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
