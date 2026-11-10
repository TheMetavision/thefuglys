/**
 * The Scrap Dash monthly prize: who holds it, passing it down, and the T-shirt.
 *
 * ONE RECORD PER MONTH, `winners/<YYYY-MM>` in the "scrap-dash" Blobs store:
 *   { v: 2, month, status: 'open' | 'claimed' | 'lapsed',
 *     candidates: [top 10 runs, furthest first: { rid, nick, dist, score, stage, runner, dev, flag, secs, disqualified? }],
 *     offer: { idx, claimCode, offeredAt, deadline, claiming?: { at } } | null,   // who may claim now
 *     claim: { idx, claimCode, at, claimant, design, garment, colour, size, printfulOrderId, draftOk } | null,
 *     history: [{ idx, nick, outcome: 'expired' | 'declined' | 'disqualified', at, printfulOrderId? }], at }
 * No name, email or address is ever stored here: those go only in the team
 * email and the Printful draft.
 *
 * WHO HOLDS IT. Month close offers it to candidate 0 until the end of the month
 * + 30 days. It passes to the next candidate (new code, 14 days) when the
 * window runs out (sd-prize-check, daily, or a late claim), when the holder
 * says they can't use a UK address (sd-decline), or when the team disqualifies
 * the run (sd-disqualify, also after a claim). After candidate 10 it lapses.
 *
 * WHICH DEVICE. `offers/<device hash>/<month>` marks the device that holds an
 * open offer, so the game can find a prize that passed down to it months
 * later (sd-winner). It is kept in step with the record by update().
 *
 * Every change is a conditional write on the record's etag (update()), so the
 * daily check, a claim, a decline and a disqualification can't overwrite each
 * other. A claim in progress holds `offer.claiming` for up to LOCK_MS; nothing
 * else moves the offer while it is held.
 *
 * KEPT APART FROM THE SHOP. Nothing here writes to Sanity (the catalogue is a
 * read-only GET), and the prize is never a Sanity order: no orders webhook,
 * shipping, post-delivery, referral or MailerLite step can see it
 * (tests/sd-prize.test.mjs proves it). The Printful order is always a DRAFT.
 */
import { claimCode, sha256, signText, sameText } from './sd-shared.mjs';
import { setting } from '../functions/_shared/site-config.mjs';

export const TOP_N = 10;
export const FIRST_DAYS = 30;
export const NEXT_DAYS = 14;
export const LOCK_MS = 2 * 60 * 1000;
const DAY = 86400000;

/** The garments a prize can be, and how they read in emails and on the claim page. */
export const PRIZE_GARMENTS = { tshirt: 'T-shirt', 'kids-tshirt': 'Kids T-shirt' };
const SIZE_ORDER = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];

/* ---------- windows ---------- */

/** The first winner's deadline: 30 days after the end of the month (UTC midnight starting the 1st). */
export function firstDeadline(month) {
  const [y, m] = month.split('-').map(Number);
  return Date.UTC(y, m, 1) + FIRST_DAYS * DAY;
}
/** The last day to claim, as people read it: "30 November 2026". */
export const claimByDate = (deadline) => new Date(deadline - 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' });

export const isLocked = (offer, now = Date.now()) => !!(offer && offer.claiming && now - offer.claiming.at < LOCK_MS);

/* ---------- the record ---------- */

const CAND_FIELDS = ['rid', 'nick', 'dist', 'score', 'stage', 'runner', 'dev', 'flag', 'secs'];
const candidate = (e) => Object.fromEntries(CAND_FIELDS.map((k) => [k, e[k]]));

export function newRecord(month, entries, now = Date.now()) {
  return {
    v: 2, month, status: 'open',
    candidates: entries.slice(0, TOP_N).map(candidate),
    offer: { idx: 0, claimCode: claimCode(), offeredAt: now, deadline: firstDeadline(month) },
    claim: null, history: [], at: now,
  };
}

/**
 * A record written before pass-down existed ({ nick, dev, claimCode, claimed, ... }),
 * rebuilt with that month's top 10 from its board. The winner and their code stay.
 * A month whose 30-day window had already closed was run under the old rules
 * ("prizes not claimed in time lapse"): it is marked lapsed, never passed down.
 */
export function upgradeLegacy(old, boardEntries = [], now = Date.now()) {
  const first = candidate(old);
  const rest = boardEntries.filter((e) => e.rid !== old.rid && e.dev !== old.dev).map(candidate);
  const deadline = firstDeadline(old.month);
  const rec = {
    v: 2, month: old.month, status: old.claimed ? 'claimed' : 'open',
    candidates: [first, ...rest].slice(0, TOP_N),
    offer: old.claimed ? null : { idx: 0, claimCode: old.claimCode, offeredAt: old.at || now, deadline: old.disqualified ? 0 : deadline },
    claim: old.claimed ? { idx: 0, claimCode: old.claimCode, at: old.claimedAt || null, legacy: true } : null,
    history: [], at: old.at || now, upgraded: true,
  };
  if (old.disqualified) first.disqualified = true;
  if (!old.claimed && now >= deadline) {
    rec.status = 'lapsed'; rec.offer = null;
    rec.history.push({ idx: 0, nick: first.nick, outcome: 'expired', at: deadline, legacy: true });
  }
  return rec;
}

/** The device that may claim now, or null. */
export const holderDev = (rec) => (rec && rec.status === 'open' && rec.offer ? (rec.candidates[rec.offer.idx] || {}).dev || null : null);

/**
 * Pass the prize on from whoever holds it (an open offer, or a claim being
 * disqualified) to the next candidate who isn't disqualified, with a new code
 * and NEXT_DAYS to claim. Lapses after the last candidate. Mutates and returns `rec`.
 */
export function passDown(rec, reason, now = Date.now()) {
  const cur = rec.offer ? rec.offer.idx : rec.claim ? rec.claim.idx : -1;
  const c = rec.candidates[cur];
  const entry = { idx: cur, nick: c ? c.nick : null, outcome: reason, at: now };
  if (rec.claim && rec.claim.printfulOrderId) entry.printfulOrderId = rec.claim.printfulOrderId;
  rec.history.push(entry);
  if (reason === 'disqualified' && c) c.disqualified = true;
  rec.claim = null;
  let next = -1;
  for (let i = cur + 1; i < Math.min(rec.candidates.length, TOP_N); i++) if (!rec.candidates[i].disqualified) { next = i; break; }
  if (next < 0) { rec.offer = null; rec.status = 'lapsed'; }
  else { rec.offer = { idx: next, claimCode: claimCode(), offeredAt: now, deadline: now + NEXT_DAYS * DAY }; rec.status = 'open'; }
  return rec;
}

/* ---------- storage ---------- */

const recKey = (month) => `winners/${month}`;
const idxKey = (dev, month) => `offers/${dev}/${month}`;

async function syncIndex(store, before, after) {
  const was = holderDev(before), now = holderDev(after);
  if (was && was !== now) await store.delete(idxKey(was, after.month));
  if (now) await store.setJSON(idxKey(now, after.month), { month: after.month });
}

/** { rec, etag } for a month, upgrading a legacy record (and writing it back) first; null if none. */
export async function readRecord(store, month, tries = 4) {
  const cur = await store.getWithMetadata(recKey(month), { type: 'json' });
  if (!cur || !cur.data) return null;
  if (cur.data.v === 2) return { rec: cur.data, etag: cur.etag };
  const board = await store.get(`board/${month}`, { type: 'json' });
  const rec = upgradeLegacy({ month, ...cur.data }, board ? board.entries : []);
  const res = await store.setJSON(recKey(month), rec, { onlyIfMatch: cur.etag });
  if (!(res && res.modified === false)) await syncIndex(store, null, rec);
  if (tries <= 0) throw new Error('prize record busy');
  return readRecord(store, month, tries - 1);
}

/**
 * Read, change and write a month's record with a conditional write, retried on
 * a clash. `change(rec)` edits a copy and returns it, or returns null for "no
 * change". Resolves to { rec, before, changed }.
 */
export async function update(store, month, change) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const got = await readRecord(store, month);
    if (!got) return { rec: null, before: null, changed: false };
    const next = change(structuredClone(got.rec));
    if (!next) return { rec: got.rec, before: got.rec, changed: false };
    const res = await store.setJSON(recKey(month), next, { onlyIfMatch: got.etag });
    if (res && res.modified === false) continue;
    await syncIndex(store, got.rec, next);
    return { rec: next, before: got.rec, changed: true };
  }
  throw new Error('prize record busy');
}

/** Write a brand-new month (month close). False if it already exists. */
export async function createRecord(store, rec) {
  const res = await store.setJSON(recKey(rec.month), rec, { onlyIfNew: true });
  if (res && res.modified === false) return false;
  await syncIndex(store, null, rec);
  return true;
}

/** Every month with a prize record. */
export async function prizeMonths(store) {
  const out = [];
  for await (const page of store.list({ prefix: 'winners/', paginate: true })) out.push(...page.blobs.map((b) => b.key.slice(8)));
  return out.filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
}

/** The months in which this device holds an open offer (sd-winner). */
export async function offerMonthsFor(store, deviceKey) {
  const dev = sha256(deviceKey), out = [];
  for await (const page of store.list({ prefix: `offers/${dev}/`, paginate: true })) out.push(...page.blobs.map((b) => b.key.split('/')[2]));
  return { dev, months: out.filter((m) => /^\d{4}-\d{2}$/.test(m)).sort() };
}

/**
 * The daily check: every open offer whose window has run out passes down.
 * Returns [{ month, before, rec }] for the team emails.
 */
export async function expireDue(store, now = Date.now()) {
  const done = [];
  for (const month of await prizeMonths(store)) {
    const r = await update(store, month, (rec) => {
      if (rec.status !== 'open' || !rec.offer || now < rec.offer.deadline || isLocked(rec.offer, now)) return null;
      return passDown(rec, 'expired', now);
    });
    if (r.changed) done.push({ month, before: r.before, rec: r.rec });
  }
  return done;
}

/* ---------- the team's disqualify link ---------- */

const dqSig = (month, idx) => signText(`sd-dq:${month}:${idx}`).slice(0, 32);
export const dqValid = (month, idx, sig) => /^\d{4}-\d{2}$/.test(month) && Number.isInteger(idx) && idx >= 0 && idx < TOP_N && typeof sig === 'string' && sameText(sig, dqSig(month, idx));
export const dqUrl = (month, idx) => `${setting('SITE_URL')}/api/sd-disqualify?m=${month}&i=${idx}&s=${dqSig(month, idx)}`;

/* ---------- the T-shirt: Fuglys designs from the shop (Sanity, read only) ---------- */

const PRODUCT_FIELDS = `{ name, "slug": slug.current, "variants": variants[productType in $types]{ productType, label, colourImages[]{ colour, imageUrl }, printfulVariants[]{ size, colour, syncVariantId } } }`;
const FILTER = '_type == "product" && active == true && count(variants[productType in $types && count(printfulVariants) > 0]) > 0';
export const PRIZE_QUERY = `*[${FILTER}] | order(coalesce(sortOrder, 999), name asc) ${PRODUCT_FIELDS}`;
export const PRIZE_ONE_QUERY = `*[${FILTER} && slug.current == $slug][0] ${PRODUCT_FIELDS}`;

/** A GROQ read from the public, published dataset. GET only: this code never writes to Sanity. */
export async function sanityRead(query, params = {}) {
  const url = new URL(`https://${setting('SANITY_PROJECT_ID')}.api.sanity.io/v2024-01-01/data/query/${setting('SANITY_DATASET')}`);
  url.searchParams.set('query', query);
  url.searchParams.set('perspective', 'published');
  for (const [k, v] of Object.entries({ types: Object.keys(PRIZE_GARMENTS), ...params })) url.searchParams.set('$' + k, JSON.stringify(v));
  const res = await globalThis.fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`Sanity ${res.status}`);
  return (await res.json()).result;
}

const sizeRank = (s) => { const i = SIZE_ORDER.indexOf(String(s).toUpperCase()); return i < 0 ? 100 : i; };
const bySize = (a, b) => sizeRank(a) - sizeRank(b) || String(a).localeCompare(String(b));

/**
 * What the claim page offers, built only from each design's real Printful
 * variants: [{ slug, name, garments: [{ type, label, colours: [{ colour, image, sizes }] }] }].
 * Kids T-shirts appear only for designs that have them. No variant ids leave the server.
 */
export function prizeDesigns(products) {
  const out = [];
  for (const p of products || []) {
    if (!p || !p.slug) continue;
    const garments = [];
    for (const type of Object.keys(PRIZE_GARMENTS)) {
      const v = (p.variants || []).find((x) => x && x.productType === type);
      const pv = ((v && v.printfulVariants) || []).filter((x) => x && x.colour && x.size && x.syncVariantId);
      if (!pv.length) continue;
      const colours = [...new Set(pv.map((x) => x.colour))].sort().map((colour) => ({
        colour,
        image: ((v.colourImages || []).find((ci) => ci && ci.colour === colour) || {}).imageUrl || null,
        sizes: [...new Set(pv.filter((x) => x.colour === colour).map((x) => x.size))].sort(bySize),
      }));
      garments.push({ type, label: PRIZE_GARMENTS[type], colours });
    }
    if (garments.length) out.push({ slug: p.slug, name: p.name, garments });
  }
  return out;
}

/** The chosen T-shirt, checked against that design's real variants; null if it isn't one. */
export function resolvePrize(product, { garment, colour, size }) {
  if (!product || !(garment in PRIZE_GARMENTS)) return null;
  const v = (product.variants || []).find((x) => x && x.productType === garment);
  const hit = ((v && v.printfulVariants) || []).find((x) => x && x.colour === colour && x.size === size && x.syncVariantId);
  if (!hit) return null;
  return { design: product.slug, name: product.name, garment, garmentLabel: PRIZE_GARMENTS[garment], colour, size, syncVariantId: String(hit.syncVariantId) };
}

/* ---------- the Printful draft ---------- */

/** One external_id per month and place on the board, so a retry finds the same draft. */
export const prizeExternalId = (month, idx) => `sd-${month}-${idx}`;

/** The draft order. No email address: Printful sends the claimant nothing. */
export function prizeOrder({ month, idx, f, prize }) {
  return {
    external_id: prizeExternalId(month, idx),
    shipping: 'STANDARD',
    recipient: { name: f.name, address1: f.a1, address2: f.a2 || '', city: f.town, country_code: 'GB', zip: f.pc },
    items: [{ sync_variant_id: Number(prize.syncVariantId) || prize.syncVariantId, quantity: 1 }],
  };
}

/** Where the team confirms the draft (site-config PRINTFUL_ORDERS_URL; {id} is replaced if present). */
export function printfulOrderLink(id) {
  const t = setting('PRINTFUL_ORDERS_URL');
  return t.includes('{id}') ? (id ? t.replace('{id}', encodeURIComponent(id)) : t.replace(/[?&][^?&]*\{id\}.*$/, '')) : t;
}
