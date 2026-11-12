# Sendcloud shipping and returns for wall art (metavision-shipping)

Branch `feat/sendcloud-dispatch`. This ports Wyrmfuel's design (`wyrmfuel/docs/SHIPPING.md`) to The Fuglys, using this repo's conventions: `.mts` functions with **no `config.path`** (the `/api/*` redirect in `netlify.toml` routes them), shared code in `netlify/functions/_shared/*.mjs`, and the Studio in `sanity/`.

**One design, four repos.** The Fuglys, Labrats, Cats On Crack and The Biker Babies have the same shipping code, byte for byte. Only these files differ between them:
- `netlify/functions/_shared/site-config.mjs`: names, addresses, colours, the brand code `FUGLYS`;
- `src/pages/returns.astro`: the layout wrapper;
- the order schema and `sanity/sanity.config.js`;
- this doc.

Fix a bug in one repo, then copy the file to the other three.

**Only in-house wall art ships via Sendcloud.** Printful makes and posts the merchandise (clothing, stickers, badges…). `printful-webhook.mjs` keeps updating the order log (`status`, `carrier`, `trackingNumber`, `trackingUrl`, `shippedAt`) and sends its "It's shipped" email once per shipment; the send-once fix is already in this repo. The only change there: on an order that also has wall art, that email now adds *"Your wall art is made by us and ships separately, with its own tracking email."* Nothing else in the Printful path changed. `stripe-webhook.cjs` is untouched.

**Wall art has its own carrier and tracking fields** (`wallArtCarrier`, `wallArtTrackingNumber`). The order's `carrier` and `trackingNumber` belong to Printful, so the two never overwrite each other.

**Everything Sendcloud sits behind `SHIPPING_ENABLED`.** With it unset, orders, emails and the Studio work as they do today, with three deliberate exceptions:
- **The wall-art dispatch email for hand dispatches.** In-house Status → Dispatched with a wall-art tracking number emails the customer once. It works as soon as the "Fuglys orders" webhook exists, with or without the flag. Wall art had no dispatch email before. Orders placed before `DISPATCH_EMAIL_SINCE` (1 Nov 2026) are never emailed.
- **The Printful mixed-order sentence** above.
- **The `#XXXXXXXX` reference on order-success**, which this site didn't show before. It's the same reference as the confirmation email.
- **The order is no longer read-only as a whole.** Every field the webhooks write stays read-only, but In-house Status (and the new wall-art fields) can now be edited. Before this, the whole document was `readOnly`, so wall art couldn't be marked Dispatched in the Studio at all.

`/returns` redirects to the Returns & Refunds policy until **both** `SHIPPING_ENABLED` is on at build time **and** `TURNSTILE_SITE_KEY` is set.

## How it works

| Step | What happens | Code |
|---|---|---|
| Order paid | `stripe-webhook.cjs` logs the order as before. The new webhook sees it arrive and, with shipping on, writes the **default parcel plan**. It flags anything it can't place (`shipmentResult.planProblem`) and any address outside the UK (`shipmentResult.international`). | `_shared/orders-router.mjs`, `_shared/parcel-plan.mjs` |
| Alan: Shipment → **Ready to ship**, publish | The router starts `shipping-dispatch-background`. That buys one label per planned parcel, writes `shipmentResult`, and emails chaos@thefuglys.com **"label ready"** with signed print links. | `_shared/shipping-dispatch.mjs` |
| Print label | The link (also stored on each parcel as `labelUrl`, and behind the Studio's **Print label** button) is `/api/shipping-label?l=…&x=…&s=…`. It's signed, expires after **30 days**, and proxies the PDF from the service. This site has no admin area, so the link itself is the credential. | `shipping-label.mts`, `_shared/shipping-internal.mjs` |
| Links expired | Shipment → On hold → Ready to ship: new links, emailed again. No new labels are bought. | same |
| First carrier scan | `/api/shipping-event` checks the signature, hands the event to `shipping-event-background` and answers 200 at once (the service wants a reply within 4 s). The background function then sets `shipmentResult.dispatchedAt` and In-house Status → Dispatched (plus the wall-art tracking number and carrier if empty), then sends **the wall-art dispatch email, once**. | `_shared/shipping-event-handoff.mjs`, `_shared/shipping-events.mjs`, `_shared/dispatch-email.mjs` |
| Delivered | Sets `shipmentResult.deliveredAt`. The **14-day** return window counts from this. | |
| Hand dispatch | In-house Status → Dispatched, with Wall-art carrier and Wall-art tracking number, then publish. The same email, once. | `_shared/dispatch-email.mjs` |
| Customer return | `/returns`: they look up `#XXXXXXXX` (with or without the `#`) + email (Turnstile), tick prints, **see the return postage from `quote-return` before submitting**, and submit. That creates `returnRequest.<ref>` and emails the team. | `_shared/returns-api.mjs`, `src/components/ReturnsForm.astro` |
| Alan approves or rejects | The router starts `shipping-return-background`. Approve: `create-return` buys the label, which is emailed with "£X.XX will be deducted" (`postageDeduction`). Reject: the reason is emailed word for word. | `_shared/shipping-returns.mjs` |
| Return at a collection point | The team email names the point: InPost locker, 59 West Road, Shoeburyness / ASDA Shoebury, North Shoebury Road / Skanda, 93-95 West Road, Shoeburyness. The customer is never told which. | `_shared/site-config.mjs` |
| Faulty, damaged or wrong print | The customer emails (policy §5). Alan: Order → **Create return (free label)**. No deduction. | `sanity/actions/CreateReturnAction.tsx` |

**The order reference** stays `#XXXXXXXX` (the last 8 characters of the Stripe session id), which customers already have from the confirmation and Printful emails. There's no brand prefix. The shipping service gets the bare 8 characters as `orderRef` (it scopes them per brand), so labels and callbacks carry the same code. Return numbers are `#XXXXXXXX-R1`, `-R2`, and so on.

**Mixed orders (merchandise + wall art).** These get two shipments and two emails, and neither overwrites the other:
- **Printful** writes its own fields and sends "It's shipped" per package, plus the sentence saying the wall art ships separately.
- **Wall art** has its own fields: `shipment`, `parcelPlan`, `shipmentResult`, `wallArtCarrier`/`wallArtTrackingNumber` and `dispatchEmailSentAt`. Its email lists only the prints and adds: *"Your other items are made by our production partner and ship separately, with their own tracking email."*

**Parcel bands and the default plan** (agreed 1 Nov 2026). Order lines store the format id in `colour` and the size id (`small`/`medium`/`large`) in `size`. Orientation comes from the image (`wallart_orientation` in Stripe), but it doesn't change the band.

| | small 12x8 / 8x12 | medium 18x12 / 12x18 | large 24x16 / 16x24 |
|---|---|---|---|
| poster | P1 | P3 | P4 |
| canvas-standard | CS1 | CS3 | CS4 |
| canvas-gallery | CG1 | CG3 | CG4 |

- **Posters:** every poster on the order goes in **one tube**, at the band of the largest poster. Each poster after the first adds `POSTER_EXTRA_WEIGHT_G` (0 g: measured as negligible; the setting stays in case that changes), sent to the service as `extraWeightG`. The service adds it to the declared weight.
- **A lone 12x8** goes flat at P1. Several 12x8s alone are flagged for a decision.
- **Each canvas** is its own parcel.
- **Any other format or size is flagged**, never guessed (`planProblem`). "Medium" was 16x12 before 1 Nov 2026; it gets the same band.
- **Outside the UK:** The Fuglys sells posters **and canvas** worldwide, but the service is GB-only. Every non-GB wall-art order is flagged *"dispatch by hand"* and keeps today's manual flow. The hand-dispatch email still goes out.

**Returns eligibility** (`_shared/returns-eligibility.mjs`, from the Returns & Refunds policy in Sanity):
- **Wall art:** until the end of the **14th day after `deliveredAt`**, UK time (§2). With no delivery date (hand-dispatched), the return is allowed and flagged "delivery date unknown".
- **Policy §3 exclusions** (personalised, digital, gift cards) don't apply to wall art: the prints are standard designs.
- **Not yet dispatched:** "email us to cancel".
- **Non-UK address:** "email us".
- **Merchandise** (`RETURNS_CLOTHING` on since feat/merch-returns): change of mind / wrong size until the end of the **21th day after Printful's ship date** (`RETURNS_MERCH_WINDOW_DAYS`; with several packages, the latest), UK time, by prepaid label with the postage deducted, exactly like wall art. Not for personalised / custom, gift-card or final-sale items. Bands by product type (`parcel-plan.mjs` `MERCH_BAND_BY_TYPE`): **X1** mailer for flat garments, **X2** bulky box for hoodies, trainers and boxed items; a type not in the list gets no band and is flagged for you to choose. **Faulty, misprinted or damaged merchandise** is a **Printful claim** (see below), not a label.
- **Faulty, damaged or wrong print:** the Studio's free-label action.
- **Refunds** stay manual in Stripe, less `postageDeduction` unless it's a free label.

### Lessons from CSC, Pixel8 and Wyrmfuel, built in

1. **Webhooks.** ngx60q2x had one, "Netlify rebuild" → the Netlify build hook directly. The new **"Fuglys orders"** webhook takes the free slot and points at the router. Both slots are then used, so **any future job must route through `sanity-orders-webhook`**, never a third webhook. "Netlify rebuild" goes straight to the build hook with no code in between, so **its filter must list `returnRequest`** (step 3b), or every return request would rebuild the site.
2. **4 KB function env.** Non-secret values live in `_shared/site-config.mjs` (an env var of the same name still overrides). Shipping adds only `SHIPPING_SECRET`, `SHIPPING_ENABLED`, and `SHIPPING_TEST_MODE` while testing, plus `SANITY_WEBHOOK_SECRET` (this site has none yet).
3. **One dispatch-email module** with an atomic claim (`ifRevisionId`). It's used by the router (hand dispatch) and by the tracking callback. `afterDispatchEmail()` is the single hook for anything that must follow it. Nothing does today.
4. **Server results go in `shipmentResult`**, never in `shipment.status` or `parcelPlan`. Every server write also patches an existing draft (`_shared/server-patch.mjs`), so publishing a draft can't undo it. Printful's fields are never written.
5. **Loop guard.** The webhook projection carries `before()`. Work starts only when a document *moves into* a state. To retry after an exception: On hold → Ready to ship (or Requested → Approved for a return). Orders dispatched by hand before this change are never emailed by a later edit. Without the projection, orders placed before `DISPATCH_EMAIL_SINCE` are skipped.
6. **Internal keys.** Background functions start with a key derived from `SHIPPING_SECRET` under its own HMAC label. The label-link key and the `/returns` session key are derived the same way, each under a different label. None needs an env var. ⚠ Rotating `SHIPPING_SECRET` (on this site **and** the service, together) invalidates every print link already sent: re-issue them with On hold → Ready to ship.
7. **Return points** are in `site-config.mjs` and appear in team emails only.
8. **Studio flag.** `sanity/lib/shipping-flag.mjs` reads `process.env.SANITY_STUDIO_SHIPPING_ENABLED` inside a `try`, so the build can inline it. Checked in a local build: with the variable set, the flag compiles to `true` and the Shipping desk is in the bundle. (Wyrmfuel's version guards with `typeof process`, which is false in a browser, so its Shipping UI won't appear even with the variable set. Reported separately.)

## Alan's setup: in order, nothing here has been done

### 1. Shipping service (metavision-shipping Netlify site)

`SHIPPING_SECRET` is already in this repo's `.env` (64 characters). The service needs the **same** value as `SHIPPING_SECRET_FUGLYS`. These commands read it from `.env` without printing it:

```powershell
cd C:\Users\chris\Projects\thefuglys
$s = ((Select-String -LiteralPath .env -Pattern '^SHIPPING_SECRET=(.*)$').Matches[0].Groups[1].Value).Trim().Trim('"')
cd C:\Users\chris\Projects\metavision-shipping
npx netlify env:unset SHIPPING_SECRET_FUGLYS
npx netlify env:set SHIPPING_SECRET_FUGLYS $s --secret --context production deploy-preview
npx netlify env:set CALLBACK_URL_FUGLYS "https://thefuglys.com/api/shipping-event" --context production deploy-preview
# Test mode: add FUGLYS to what is there (case doesn't matter), e.g. "CSC,PIXEL8,WYRMFUEL,FUGLYS"
npx netlify env:get SHIPPING_TEST_BRANDS
npx netlify env:set SHIPPING_TEST_BRANDS "<existing>,FUGLYS" --context production
```

Before any **real** label, fill in the sizes and weights for **P1, P3, P4, CS1, CS3, CS4, CG1, CG3, CG4** in `config/shipping.json` (and X1, X2 before merchandise returns). Test labels don't need them. `brands.FUGLYS.displayName` is already set there.

### 2. The Fuglys Netlify env

```powershell
cd C:\Users\chris\Projects\thefuglys
$s = ((Select-String -LiteralPath .env -Pattern '^SHIPPING_SECRET=(.*)$').Matches[0].Groups[1].Value).Trim().Trim('"')
npx netlify env:unset SHIPPING_SECRET
npx netlify env:set SHIPPING_SECRET $s --secret --context production deploy-preview
npx netlify env:set SHIPPING_ENABLED "true" --context production deploy-preview      # Functions AND Builds scope: /returns is built from it
npx netlify env:set SHIPPING_TEST_MODE "true" --context production deploy-preview    # free test labels only; unset before going live
```

**`SANITY_WEBHOOK_SECRET` is new here.** "Netlify rebuild" calls the build hook and has no secret, so generate one for the new webhook (step 3) and set it:

```powershell
cd C:\Users\chris\Projects\thefuglys
$w = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
$w | Set-Clipboard   # paste as the webhook's Secret in step 3; never commit it
npx netlify env:set SANITY_WEBHOOK_SECRET $w --secret --context production deploy-preview
```

`TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, `SANITY_API_TOKEN` and `RESEND_API_KEY` are already set and are reused.

**Env size** (production, 1 Nov 2026; secret values are masked by the CLI, so these are estimates): about ~2.5 KB (26 vars) today; shipping adds about 0.1 KB (0.2 KB with `SANITY_WEBHOOK_SECRET`). Every credential is already marked secret.

### 3. Sanity webhook: create **"Fuglys orders"** (sanity.io/manage → ngx60q2x → API → Webhooks)

Only once this branch is merged and deployed.

| Field | Value |
|---|---|
| Name | `Fuglys orders` |
| Description | Order + return events → router (dispatch email, Sendcloud labels, returns) |
| URL | `https://thefuglys.com/api/sanity-orders-webhook` |
| Dataset | `production` |
| Trigger on | **Create**, **Update** (not Delete) |
| Filter | `_type in ["order", "returnRequest"] && delta::changedAny((inhouseStatus, wallArtTrackingNumber, wallArtCarrier, shipment, parcelPlan, status, band, freeLabel, rejectionReason))` |
| Projection | `{..., "before": before(){ inhouseStatus, wallArtTrackingNumber, status, "shipmentStatus": shipment.status }}` |
| Status | Enabled |
| HTTP method | POST |
| API version | `v2025-02-19` |
| Drafts / versions | off / off |
| Secret | the value from step 2 |

**Rollback:** disable "Fuglys orders". Nothing else depends on it.

### 3b. Edit "Netlify rebuild" in place: add `returnRequest` to its filter

Do this **before** turning shipping on. Without it, every return request (and every server write to one) starts a full Netlify build.

| | Filter |
|---|---|
| Now | `!(_type match "sanity.*") && !(_type match "system.*") && !(_type in ["contactSubmission","order","lineItem","category","merchCategory","faq"])` |
| New | `!(_type match "sanity.*") && !(_type match "system.*") && !(_type in ["contactSubmission","order","lineItem","category","merchCategory","faq","returnRequest"])` |

Nothing else on that webhook changes.

Since sanity-galleries the filter also lists `game`: see `docs/REBUILD-WEBHOOK.md`, which holds the current filter.

### 4. Studio: schema + hosted Studio (two deploys)

```powershell
cd C:\Users\chris\Projects\thefuglys\sanity
# sanity/.env holds SANITY_AUTH_TOKEN (seed scripts), which breaks `sanity deploy`:
# move it aside for the deploy, add the flag to a temporary .env, then put it back.
Move-Item -LiteralPath .env -Destination ..\sanity.env.bak
Set-Content -LiteralPath .env -Value "SANITY_STUDIO_SHIPPING_ENABLED=true" -Encoding ascii
try { npx sanity schema deploy; npx sanity deploy } finally { Remove-Item -LiteralPath .env; Move-Item -LiteralPath ..\sanity.env.bak -Destination .env }
```

**New fields on `order`** (`sanity/schemas/order.js`, from `sanity/schemas/shippingFields.ts`):
- Always shown on wall-art orders: Wall-art carrier, Wall-art carrier name (Other), Wall-art tracking number, Wall-art dispatch email sent.
- Shipping UI only: `shipment`, `parcelPlan`, `shipmentResult` (with the Print label panel).
- The document-level `readOnly` is replaced by `lockWebhookFields()`: the same fields stay read-only, but In-house Status is now editable.

**New type:** `returnRequest` (no "new document" button: ids are made by `/returns` or the action). **New desk sections:** **Shipping (wall art)** and **Returns**. **New action:** **Create return (free label)** on orders.

All of this is in `sanity/lib/shipping-desk.js`. I built it locally with the flag on (desk present) and off (desk absent). Nothing has been deployed.

### 5. Env clean-up (after this is live and verified; each step stands alone)

```powershell
cd C:\Users\chris\Projects\thefuglys
npx netlify env:unset STRIPE_PUBLISHABLE_KEY      # ~130 bytes; no code reads it (checkout is Stripe-hosted)
```
- The duplicate Sanity token: SANITY_TOKEN_FUGLYS (no code reads it; every function reads SANITY_API_TOKEN). Confirm `SANITY_API_TOKEN` is the Editor token first (stripe-webhook already writes orders with it), then `npx netlify env:unset SANITY_TOKEN_FUGLYS`.
- Non-secrets the shipping code now reads from `site-config.mjs` (`SITE_URL`, `LOGO_URL`, `BRAND_NAME`, `BRAND_ACCENT`, `EMAIL_HEADER_BG`, `SANITY_PROJECT_ID`, `SANITY_DATASET`) are still read from env by the older functions. Moving those is a later, per-function change.

### 6. Policy drafts for you to apply in the Studio (Legal Pages): not applied ⚠ legal wording, check it yourself

The four brands share one template, so these drafts are the same everywhere apart from the name and domain.

**a) Faulty items: align Shipping §10 with Returns §5 (30 days).** In *Shipping Policy* §10, replace the sentence with:

> If your order arrives damaged, please email us within 30 days of delivery with photographs of the parcel and the damaged items. We will arrange a free replacement or refund.

**b) Missing domain ending.** In *Shipping Policy*'s first paragraph, change "orders placed at thefuglys." to "orders placed at thefuglys.com."

**c) In-house wall art paragraph.** In *Shipping Policy*, add a section after "2. Production time":

> **Wall art we print ourselves.** Our posters and canvases are printed, finished and packed by us in the UK, not by our print partner. Posters are rolled and sent in a protective tube (a single small poster may travel flat), and each canvas is boxed on its own. UK orders go by a tracked service, and we email you the tracking number as soon as your wall art is on its way. If your order also includes clothing or other merchandise, that is made and sent separately by our print partner, with its own tracking email.

⚠ Before publishing "tracked", check that every UK option in the service's `routing.zones.GB` list is a tracked service.

**d) Privacy policy, "Who we share it with".** Add after the print-on-demand line:

> - **Sendcloud** — creating postage labels for the wall art we print and post ourselves, and for returns (receives your name, delivery address and what's in the parcel; for a return, also your email address).
> - **Delivery companies** (such as Royal Mail, Evri, InPost, DPD or UPS) — delivering and tracking your parcel, under their own privacy policies.

Then add a paragraph:

> **Delivery & Returns.** To post your wall art we share your name and delivery address with Sendcloud, the shipping platform we use to create labels, and with the carrier that delivers it. If you return an item, we share your name, address and email address with Sendcloud and the carrier that collects or handles the return, so they can send you drop-off details and keep you updated. We buy the return label for you and never share your payment details. Sendcloud is based in the Netherlands and processes data within the European Economic Area. Lawful basis: performing our contract with you.

**e) Returns & Refunds, "6. How to return an item"** (once `/returns` is live). Replace the list with:

> - **Wall art (UK addresses):** go to thefuglys.com/returns, enter your order reference (the # code in your order confirmation email) and the email you ordered with, and choose what's coming back. You'll see the return postage before you send the request. Once we've approved it, we email you a prepaid return label, and its cost is deducted from your refund.
> - **Clothing and other merchandise, or an address outside the UK:** email contact@themetavision.co.uk with your order number and reason for return. We will reply with a returns address and any reference number.
> - Pack the item securely (wall art in its original tube or box) with a copy of your order confirmation.
> - If you send it back yourself, use a tracked service and keep your receipt — we cannot refund items lost in return transit.
> - Once received and inspected, we will issue your refund to the original payment method within 14 days.

Under "Who pays for return postage?", replace the change-of-mind line with:

> Change of mind / unwanted items: you cover the cost. If we email you a prepaid return label, its cost is deducted from your refund — for wall art returned through our returns page you'll see the amount before you submit.

Under "Conditions for return", add: *wall art must be unused and returned in its original tube or box.*

`src/lib/merchant-feed.mjs` already declares 14-day, customer-paid returns, which still holds.

## Live test plan (test labels only)

Prerequisites: steps 1–4 done (and 3b), with `SHIPPING_TEST_MODE=true` and `FUGLYS` in `SHIPPING_TEST_BRANDS`. Test labels are the free `sendcloud:letter`; the planned band shows on each parcel, but the label itself is the letter.

1. **Endpoints refuse strangers.**
   ```powershell
   foreach ($p in 'sanity-orders-webhook','shipping-event','shipping-dispatch-background','shipping-return-background') {
     try { Invoke-WebRequest -Method Post -Uri "https://thefuglys.com/api/$p" -Body '{}' -UseBasicParsing | Out-Null } catch { "$p -> $($_.Exception.Response.StatusCode.value__)" }
   }
   # expect 401, 401, 403, 403
   try { Invoke-WebRequest -Uri "https://thefuglys.com/api/shipping-label?l=1&x=2&s=3" -UseBasicParsing | Out-Null } catch { $_.Exception.Response.StatusCode.value__ }   # 403
   ```
2. **Reference and plan.** Place a real low-value order (one 12x8 poster) to your own UK address. The confirmation page and email show `#XXXXXXXX`. In the Studio the order has a parcel plan of **Parcel 1 · P1**.
3. **Hand dispatch email (works even without the flag).** On a *second* test order, set In-house Status → Dispatched, Wall-art carrier Royal Mail, Wall-art tracking number `TEST123`, then publish. You get one "Your Fuglys wall art is on its way — order #…" email with a Royal Mail link. Publish again: no second email.
4. **Mixed order.** Order a poster + a tee. The plan covers the poster only. The wall-art email lists the poster only and carries the "other items ship separately" sentence. When Printful ships the tee, its "It's shipped" email says the wall art ships separately; its carrier and tracking stay in the Printful fields.
5. **Labels.** On the order from step 2, set Shipment → Ready to ship, then publish. You get a "[TEST] … label ready" email to chaos@thefuglys.com with a **Print label** link, a `TEST` parcel in the panel, and the PDF opens from both the email and the Studio button.
6. **First scan → dispatch email.**
   ```powershell
   cd C:\Users\chris\Projects\metavision-shipping
   node --env-file=.env tools/simulate-event.mjs --brand=FUGLYS --parcel=<parcelId> --status=in_transit
   ```
   In-house Status becomes Dispatched with the wall-art tracking number, the customer email arrives once, and running the command again sends nothing.
7. **Delivered.** Run `--status=delivered`. Check that `shipmentResult.deliveredAt` is set and the order is in Shipping → Delivered.
8. **Multi-poster tube.** Order a 12x8 + a 24x16 poster. The plan is one parcel at **P4** (extra weight 0 g while `POSTER_EXTRA_WEIGHT_G` is 0). Ready to ship buys one label.
9. **Exception and retry.** Use `--status=exception` on a parcel. You get a team alert and nothing goes to the customer. Then set On hold → Ready to ship on an order whose label failed: one retry, not a loop.
10. **Overseas.** A wall-art order to a non-UK address (poster or canvas) lands in Shipping → "Outside the UK — dispatch by hand". Ready to ship gives an exception that says so. A hand dispatch emails the customer.
11. **Return.** At `/returns`, enter the reference from step 2 (try it without the `#`) and your email. Tick the poster: the postage figure shows before Submit. Submit, then check the team email and Returns → Requested. Approve and publish: you get a label email with "£X.XX will be deducted". Then:
    ```powershell
    node --env-file=.env tools/simulate-event.mjs --brand=FUGLYS --parcel=<returnParcelId> --status=ready_to_collect
    ```
    You get a team email naming the InPost locker, 59 West Road (or ASDA / Skanda for Evri / UPS).
12. **Rejected return and merchandise.** Reject with a reason; the customer gets it word for word. Then try a merchandise line on `/returns`: it says "email us". After 14 days from delivery, the wall art says the window has ended.
13. **Faulty print.** On a delivered order, use **Create return (free label)**, check the band and approve it: the label email says it's free and `postageDeduction` is 0.
14. **Clean up.**
    ```powershell
    node --env-file=.env tools/cancel-test-parcels.mjs --dry-run
    node --env-file=.env tools/cancel-test-parcels.mjs
    ```
    Refund the test orders in Stripe and delete the test documents in the Studio.

## Merchandise returns and Printful claims (feat/merch-returns)

Switched on by `RETURNS_CLOTHING: 'true'` in `site-config.mjs` (an env var of that name still overrides; `false` puts merchandise back to "email us").

- **Per-item reason** on `/returns`. A merchandise line also offers **"Faulty, misprinted or damaged"**.
- **One request per route.** A submission can mix wall art and merchandise; `returnRoutes()` splits it into up to three `returnRequest`s, numbered `-R1`, `-R2`…:
  - **Printful claim** (`type: printfulClaim`): the faulty merchandise. No label, no band, no quote, any country. Holds the **Printful order id** and **claim by** date (Printful's 30 days from the *earliest* package's ship date, `PRINTFUL_CLAIM_DAYS`). A report after that date is still taken, flagged *past Printful's deadline*. The team gets a "Printful claim" email; the customer gets "please reply to this email with a photo" (the form takes no uploads; the reply lands in the brand inbox).
  - **Wall-art return**: unchanged (one label, the wall-art bands).
  - **Merchandise return**: one label for all the change-of-mind merchandise: X2 if anything in it is bulky, else X1. Several items, or an unknown type, add a ⚠ Parcel note for you to check the band.
- The quote is per parcel and summed on the page before submitting; each request stores the figure the customer saw for its own parcel.
- **Studio:** Returns → **Printful claims** (To do, soonest deadline first; Refund due; Replacement sent; All). Label returns no longer list claims. Report the problem in Printful (Orders → the order → Report a problem) once the photo is in, then set the claim to **Approved**: the customer is emailed **"your replacement is on its way"** (status → Replacement sent). To refund instead, choose **Refund instead** (and check **Refund (£)**, which starts at the item price) before approving: the customer is told the amount and the status becomes **Refund due**; refund by hand in Stripe, then set Refunded. Reject works as for returns, worded for a claim.
- **Ship dates** come from Printful's own fields (`shippedAt`, `printfulShipments[]`), read only. An order Printful says is shipped but with no date: the window runs from the order date plus 10 days, flagged *Printful ship date unknown*. Not shipped yet: "email us to cancel".
- **Product type on new orders:** `stripe-webhook.cjs` now copies the checkout's product type onto each merchandise line (`productType`). Older lines are banded from their title.
- **The orders webhook needs no change:** its filter already fires on `status`, and its projection is the whole document.
- Before real merchandise labels: X1 and X2 must have sizes and weights on the shipping service (`config/shipping.json`); until then `create-return` fails with `band_not_configured` and you get the "no label sent" email.

**Going live:** fill in the band sizes on the service, unset `SHIPPING_TEST_MODE`, and apply the policy drafts. **Merchandise returns** are switched on in code (feat/merch-returns): measure X1/X2 on the service before the first real merchandise label.

**Known edge:** `printful-webhook` patches an order with `ifRevisionID` and skips (no email) on a 409. If a shipping write lands on the same order in the same fraction of a second as Printful's `package_shipped`, that one Printful update is lost. It's very unlikely (the two happen days apart), but if a Printful shipment is ever missing from a mixed order, that's why. Printful's code is deliberately unchanged.
