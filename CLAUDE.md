# The Fuglys -- agent handoff

---

## Path migration (May 2026)

Generated 2026-05-02 during the Downloads -> Projects migration.

### Path change

- **Old path:** `C:\Users\chris\Downloads\The Fuglys Astro Site\merged`
- **New path:** `C:\Users\chris\Projects\thefuglys`

Any older agent instructions, scripts, or notes that reference the old path should be treated as referring to the new path.

### Quick stack reference

- **Brand:** The Fuglys
- **Sanity project ID:** `ngx60q2x`
- **Sanity Studio:** thefuglys.sanity.studio
- **GitHub remote:** https://github.com/TheMetavision/thefuglys.git
- **Cowork agent ownership:** Axiom (build) + Arc (content)
- **Stack:** Astro + Sanity CMS + Netlify (per Metavision house standard)

---

## Sendcloud shipping (wall art only) -- feat/sendcloud-dispatch

Read `docs/SHIPPING.md`. In short:

- Only in-house wall art ships via the metavision-shipping service (brand
  `FUGLYS`). Printful ships merchandise and sends its own email
  (`printful-webhook.mjs`); never touch that path or the order's `status`,
  `carrier`, `trackingNumber`, `trackingUrl`, `shippedAt`,
  `printfulOrderId`. Wall art has `wallArtCarrier` / `wallArtTrackingNumber`.
- Everything Sendcloud is behind `SHIPPING_ENABLED` (functions + build) and
  `SANITY_STUDIO_SHIPPING_ENABLED` (Studio). The hand-dispatch wall-art email
  (In-house Status -> Dispatched + wall-art tracking) works without the flag.
- Sanity webhooks: both slots used once "Fuglys orders" ->
  `/api/sanity-orders-webhook` exists. Never add a third: route new
  order/return jobs through `_shared/orders-router.mjs`.
- Non-secret settings go in `netlify/functions/_shared/site-config.mjs`
  (functions env is capped at 4 KB). Internal keys derive from
  `SHIPPING_SECRET` (`_shared/shipping-internal.mjs`).
- The shipping modules are identical in thefuglys, labrats, catsoncrack and
  bikerbabies; only site-config.mjs, returns.astro, the order schema and
  sanity.config.js differ. Change one, copy to all four.
- Operator fields: `shipment.status`, `parcelPlan`, `inhouseStatus`, wall-art
  carrier/tracking. Server fields: `shipmentResult`, dispatch-email stamps;
  written with `_shared/server-patch.mjs` (published + draft).
- One dispatch-email module with an atomic claim: `_shared/dispatch-email.mjs`.
