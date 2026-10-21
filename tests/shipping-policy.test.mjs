// The Shipping Policy page (Sanity legalPage.shipping-policy, static text) must
// quote exactly what the checkout charges: every region's rate, time and countries
// and the free-UK threshold from src/lib/shipping-regions.mjs (the sentences come
// from src/lib/shipping-policy-text.mjs), and nothing the checkout doesn't offer.
//
// The last test reads the published page from Sanity with SANITY_API_TOKEN (legal
// pages have private ids); it reads .env if there is one, and is skipped without a token.
//
//   npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHIPPING_REGIONS, FREE_UK_THRESHOLD_PENCE } from '../src/lib/shipping-regions.mjs';
import { COUNTRY_NAMES, policyLines, pounds, shippingPolicyProblems } from '../src/lib/shipping-policy-text.mjs';

try { process.loadEnvFile('.env'); } catch { /* no .env: the variables come from the environment */ }

test('every country the checkout accepts has a fixed name', () => {
  for (const r of SHIPPING_REGIONS) for (const c of r.countries) assert.ok(COUNTRY_NAMES[c], `no name for ${c}`);
});

test('the lines carry each region rate, time and every country', () => {
  const { regions, ukFree } = policyLines();
  assert.equal(regions.length, SHIPPING_REGIONS.length);
  SHIPPING_REGIONS.forEach((r, i) => {
    assert.ok(regions[i].includes(pounds(r.pence)), regions[i]);
    assert.ok(regions[i].includes(`${r.days[0]}–${r.days[1]} business days`), regions[i]);
    if (r.id !== 'uk') for (const c of r.countries) assert.ok(regions[i].includes(COUNTRY_NAMES[c]), `${c} in ${regions[i]}`);
  });
  assert.ok(ukFree.includes(pounds(FREE_UK_THRESHOLD_PENCE)));
  assert.equal(pounds(695), '£6.95');
  assert.equal(pounds(7500), '£75');
});

test('the check catches a stale rate, Express and an unknown amount', () => {
  const { regions, ukFree } = policyLines();
  assert.deepEqual(shippingPolicyProblems([...regions, ukFree, 'Other text.']), []);
  const stale = [regions[0].replace(pounds(SHIPPING_REGIONS[0].pence), '£4.99'), ...regions.slice(1), ukFree];
  const p = shippingPolicyProblems(stale);
  assert.ok(p.some((x) => x.startsWith('missing:')) && p.some((x) => x.startsWith('unknown amount £4.99')), p.join('\n'));
  assert.ok(shippingPolicyProblems([...regions, ukFree, 'Express (where available): 1–3 days']).some((x) => x.startsWith('forbidden')));
});

test('the published Shipping Policy page matches the checkout', async (t) => {
  const token = process.env.SANITY_API_TOKEN;
  if (!token) return t.skip('SANITY_API_TOKEN not set: the live page was not checked');
  const projectId = process.env.SANITY_PROJECT_ID, dataset = process.env.SANITY_DATASET || 'production';
  assert.ok(projectId, 'SANITY_PROJECT_ID not set');
  const q = encodeURIComponent('*[_id == "legalPage.shipping-policy"][0].body[_type == "block"]{ "t": pt::text(@) }');
  const r = await fetch(`https://${projectId}.api.sanity.io/v2024-01-01/data/query/${dataset}?query=${q}&perspective=published`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200, `Sanity answered ${r.status}`);
  const blocks = ((await r.json()).result || []).map((b) => b.t);
  assert.ok(blocks.length, 'no published legalPage.shipping-policy');
  assert.deepEqual(shippingPolicyProblems(blocks), [], 'paste policyLines() from src/lib/shipping-policy-text.mjs into the page');
});
