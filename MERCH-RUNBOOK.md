# The Fuglys: merch run-book

What was changed in the shop, why, and how to repeat or undo it. Newest work at the bottom of each section.
Tooling lives in `C:\Users\chris\Projects\printful-sync` (its own git repo); the site's code is on branches here.

## Stores and IDs

| | |
|---|---|
| Printful store | `PRINTFUL_STORE_FUGLYS` (store-scoped token `PRINTFUL_TOKEN_FUGLYS` in printful-sync `.env`; `PRINTFUL_API_KEY` on Netlify) |
| Sanity | project `ngx60q2x`, dataset `production` |
| Netlify site | `thefuglys`, id `dca358ca-0fa6-40fa-bc23-b85ccbde520a` (repo linked 18 Oct: `.netlify/state.json`, gitignored) |
| Stripe | shared with Cats On Crack, Labrats and The Biker Babies (one account); sessions carry `metadata.brand = thefuglys` |
| Order log token | the webhook reads `SANITY_API_TOKEN` (else `SANITY_TOKEN`); Netlify has `SANITY_API_TOKEN` in production, deploy-preview and branch-deploy (checked 18 Oct, names only) |

---

## Part A: margin audit (18 Oct 2026)

**Finding.** Every drinkware product lost money on GB orders. Live Printful quotes (`POST /orders/estimate-costs`, single item),
our VAT on GB sales, Stripe 1.5% + 20p, the delivery charge collected:

| Product | Printful # | Stocked | Retail | GB landed | GB profit |
|---|---|---|---|---|---|
| 20oz Tumbler | 909 | US only | £22.50 | £36.41 | −£6.44 (−26%) |
| 16oz Can Glass | 690 | US only | £11.50 | £24.17 | −£5.24 (−34%) |
| Can Glass lid & straw | 690 | US only | £12.50 | £25.07 | −£5.17 (−32%) |
| Pin badge set (5) | 660 | US only | £9.95 | £18.41 | −£1.71 (−12%) |

Everything else makes 28–58% on a GB order. No customer had bought drinkware or pins, so actual losses were £0.

**Decisions (Alan, 18 Oct 2026):** tumbler moves to #585 (EU-stocked) at £32.95, white; can glass dropped; 11oz mug #19
(UK/EU) added at £12.95 with the design on both sides; pin badge sets dropped; delivery tied to destination.

### A1. GTVEMJDF and the Fuglys order log

- **GTVEMJDF (6 Jul 2026)** was a Fuglys order (Scabby Road poster + Fuglys Sticker Set 2). The Fuglys webhook fulfilled it
  correctly as Printful #165858044 in this store. It was never logged in this site's Sanity: order logging was broken
  then (the token-name mismatch; the webhook's token fallback was fixed 5 Oct 2026). No Fuglys order has come in since,
  so logging is **unverified**: the Fuglys test order below confirms it.
- The same order was also processed by the Cats On Crack webhook (before the 21 Jul brand guard, every brand's webhook
  processed every session on the shared Stripe account), which logged a false "fulfilment-failed" record there; that
  record is relabelled `other-brand` in the COC dataset (18 Oct).
- Added now, as a second lock: see "Own-store check" below.

### Daisy and Flint – Bad Ideas Only (repaired 18 Oct 2026)

Both designs were active, but all 544 of their tee, hoodie, tank, long-sleeve and can-glass variant ids in Sanity pointed at
Printful products that had been deleted and re-created under new ids: any order for them would have been charged and then
failed at Printful. The manifest held the dead ids too. Fixed with `sync-products.mjs thefuglys adopt --only=daisy,flint-bad-ideas-only`
(reads the live products back by external id; creates nothing), `sync --only=…` (drafts; copy, prices and images
unchanged) and `publish-drafts.mjs thefuglys`. printful-sync commit `5537bf6`. Afterwards every Sanity variant id of all
four IP brands resolved in its own store; live immediately (the checkout reads Sanity's API at each purchase).

### Own-store check and confirm rule in the webhook (branch `feat/margin-delivery`)

- Before placing a Printful order, `stripe-webhook.cjs` asks `GET /store/variants/{id}` for every line with the store-scoped
  `PRINTFUL_API_KEY`: 200 only for this store's variants, 404 for another store's. If any line isn't ours, or the check
  fails, **nothing is ordered**: the merchant alert says NOT OUR VARIANT with the ids, and the order log gets
  `status: fulfilment-failed` and the reason in `failureReason`.
- The Printful order is **confirmed only** when `PRINTFUL_AUTO_CONFIRM` is exactly `true` (set in the production context
  only, 18 Oct) **and** the payment is live; otherwise it is a draft, and the confirm flag is always sent explicitly.
  Stripe test-mode payments are always drafts, logged with `test: true` and a `[TEST]` alert.
- Order schema (`sanity/schemas/order.js`, the file the Studio imports; `order.ts` beside it is an older copy): `other-brand`
  status and the `test` flag.
- Tests: `tests/own-store-check.test.mjs`.

### A2. Delivery tied to the destination (branch `feat/margin-delivery`)

Before: all five delivery rates were offered to every buyer, so an overseas buyer could pick UK Standard (£6.95).

- `src/lib/shipping-regions.mjs`: regions and rates (unchanged: UK £6.95, free from £75; Europe £9.95; USA/Canada £10.95;
  Australia/NZ/Japan/Brazil £11.95; Rest of World £14.95) and the same 76 countries. Identical in all four IP sites.
- Cart drawer: "Delivering to" country picker (remembered on the device as `fuglys-delivery-country`, guessed from the
  browser language), the delivery line and total for that country, the free-UK bar only for GB, and a warning (checkout
  disabled) for lines Printful won't ship there.
- `create-checkout.cjs`: requires the country; refuses unknown ones (400) and lines Printful won't ship there (422);
  Stripe gets `allowed_countries: [country]` and only that region's rate; `metadata.delivery_country`.
- `src/data/ship-to.json`: countries refused per productType, generated from Printful's own answers. Regenerate after any
  range change:
  ```powershell
  cd C:\Users\chris\Projects\printful-sync
  node --env-file=.env probe-ship-to.mjs catsoncrack labrats thefuglys bikerbabies --extra=585,19   # ~25 min, quotes only
  node export-ship-to.mjs thefuglys C:\Users\chris\Projects\thefuglys\src\data\ship-to.json
  ```
- What the probe found (18 Oct): **Brazil** fails for every Printful product (Printful needs the recipient's CPF/CNPJ and
  the checkout doesn't collect it), so Printful lines are refused for BR; wall art (in-house) still ships there.
  **Ukraine** is refused for adult apparel (tee, hoodie, tank, long sleeve). #585 and the mug ship to all but Brazil.
- Tests: `tests/delivery-destination.test.mjs`.

### Previews: test payments and draft catalogue

- **Stripe TEST values** in `deploy-preview` and `branch-deploy` only, so preview checkouts are test payments. Production
  keeps the live values. Set with `scripts\set-stripe-test.ps1` (refuses anything but `rk_test_`/`sk_test_` and
  `whsec_`, delete-then-recreate as secrets, stops if production's value ids change). Needs a TEST-mode webhook endpoint
  in Stripe for the preview URL, event `checkout.session.completed`.
  Production value ids before (18 Oct): `STRIPE_SECRET_KEY` `b60350d3`, `STRIPE_WEBHOOK_SECRET` `d1edae2b`.
- **Draft catalogue on previews:** `SANITY_PERSPECTIVE=previewDrafts` is set in `deploy-preview` and `branch-deploy` only
  (18 Oct), so a preview build and its checkout read Sanity drafts; production reads published.

### A3. Pin badge sets (#660)

Printful has no UK/EU badge blank (#660 is its only one, US-stocked). 30% on GB would need £20.50 for a set of five, against
£5–£10 in the market. Dropped. Sanity docs and Printful products: see Part B (`pins-report.mjs thefuglys`).

---

## Part B: drinkware

Config: `printful-sync/brands/thefuglys.config.mjs` (36 designs).

| Garment | Blank | Price | Notes |
|---|---|---|---|
| `tumbler` | #585 Stainless Steel Tumbler 20 oz, White (EU) | £32.95 | `externalKey: tumbler585` (new products sit beside #909's until those go). Printed on both sides, as Dotty's: the design twice, at ¼ and ¾ of the 2776×2374 wrap, each in a 1250×1450 box (`make-mug-wraps.mjs --kind=tumbler` → `designs.tumblerPrintFileUrl`); images: Left, "Printed on both sides", Right |
| `mug` | #19 White Glossy Mug 11 oz (UK + EU) | £12.95 | design twice, at ¼ and ¾ of the 2700×1050 wrap (`make-mug-wraps.mjs` → `designs.mugPrintFileUrl`); images: Front, "Printed on both sides", Handle on Left |
| `glass` | #690 | — | removed from the config |

Site: Mugs tab added after Tumblers; Can Glasses and Badges tabs kept while those products exist (empty tabs vanish);
size guide lists the tumbler and mug.

Steps done (18–19 Oct 2026, printful-sync):

1. Mockup check before creating anything (`mockup-check.mjs`, Mockup Generator, no products): the two-sided tumbler (Left and
   Right) and the mug (Front and Handle on Left) on axel-run-fast. Images: `printful-sync/mockup-checks/thefuglys/`.
2. Wraps for all 36 designs uploaded to the Sanity CDN: `make-mug-wraps.mjs thefuglys --kind=mug` and `--kind=tumbler`.
3. Printful products created in batches of 6 (`run-batches.ps1 -Brand thefuglys -Stage printful -Flags "--types=tumbler,mug"`,
   waiting whenever printful-sync was busy): one #585 tumbler and one mug per design, 72 products.
   `store-check.mjs thefuglys tumbler585,mug`: every design has one of each, no duplicate external ids.
4. Pin sets: drafts with `active: false` (`draft-inactive.mjs`) for the 6 pin sets (`product-badge-set-1` … `-6`; Printful 437554239, 437554304, 437554400, 437554457, 437554543, 437554627). No unfinished Printful orders.
5. Mockups for the new garments only, in small resumable runs (`next-mockups.ps1 -Brand thefuglys -Count 3`, memory checked
   between runs): every tumbler has Left, "Printed on both sides" and Right; every mug Front, "Printed on both sides" and
   Handle on Left (Mockup Generator, re-hosted on the Sanity CDN).
6. Sanity **drafts** (`run-batches.ps1 -Brand thefuglys -Stage sync -Flags "--types=tumbler,mug --drop-types=glass"`): on all 36 designs
   the tumbler is replaced by #585 (£32.95, White), the mug added (£12.95), the can glass removed; every other garment, all
   copy and images exactly as published. `verify-drafts.mjs thefuglys tumbler,mug glass`: no problems, every variant id in the
   live store. Production still shows the published (old) catalogue; the deploy preview reads the drafts.
7. Size guide: tumbler 20 oz / 600 ml, 8.4″ (21.4 cm); mug 11 oz, 3.8″ (9.6 cm), from Printful's catalogue for #585 and #19.
8. Preview: https://deploy-preview-2--thefuglys.netlify.app. The checkout function refuses no country (400), an unknown one (400), a Printful item to Brazil
   or a tee to Ukraine (422), all before Stripe.

### Launch order, after Alan approves the preview (in this order, nothing earlier)

1. **Merge the PR** (`feat/margin-delivery`, Alan). Netlify rebuilds production from `main`: the new code against the old,
   published catalogue. It handles both: can glasses and badges still list and check out until their products go (tabs
   kept, empty tabs vanish; test "old and new catalogue both check out"), and a basket with no country set just shows the
   picker.
2. **Deploy the Studio schema** from `sanity/`: `npx sanity schema deploy` and `npx sanity deploy` (`other-brand` status,
   `test` flag).
3. **Publish the drafts**: `cd C:\Users\chris\Projects\printful-sync`, `node --env-file=.env publish-drafts.mjs thefuglys --dry`,
   then without `--dry`. Production then needs a rebuild to show them (Netlify: trigger deploy, or the next push to `main`).
4. **Check the live site**: a tumbler and a mug page (both-sides images), the basket country picker, a GB basket reaching
   Stripe with one rate and one country, merch tabs without Can Glasses or Badges.
5. **Only then delete the old products**, after `pins-report.mjs thefuglys` shows no unfinished Printful orders: the #909
   tumblers (`thefuglys-<slug>-tumbler`), the #690 can glasses (`-glass`) and the pin sets. The badge-set docs stay in
   Sanity, inactive.
6. `store-check.mjs thefuglys tumbler585,mug,tumbler,glass,pin` should then show 0 for tumbler, glass and pin.
7. Production env: `PRINTFUL_AUTO_CONFIRM=true` (production context only, set 18 Oct) makes live orders confirmed once the
   new code is merged; without it they are Printful drafts to confirm by hand. Previews never confirm.

### Fuglys test order (confirms the order log)

After `scripts\set-stripe-test.ps1` has put the TEST values in the preview contexts and the preview has been redeployed:

1. On the deploy preview, put one item in the basket (Delivering to: United Kingdom) and pay with Stripe's test card
   `4242 4242 4242 4242`.
2. Check the Sanity order log (Studio, Orders, or a query for `*[_type == "order" && test == true]`): one record,
   `test: true`, status `fulfilled`, with a Printful order id.
3. Check Printful: that order is a **DRAFT** (never confirmed).
4. Clean up (next section).

### After every preview test payment

Test-mode orders reach Printful as **drafts** (never confirmed) and the Sanity log as `test: true`. Delete them after each test:
`cd C:\Users\chris\Projects\printful-sync`, `node --env-file=.env delete-test-orders.mjs thefuglys` (lists them), then
`... --apply` (deletes the Printful drafts and the test log records).
