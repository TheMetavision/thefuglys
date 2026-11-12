# "Netlify rebuild" Sanity webhook (ngx60q2x)

The Fuglys has no rebuild code (no `content-build.mjs` as in Cats On Crack).
The Sanity webhook **"Netlify rebuild"** POSTs straight to the Netlify build
hook, so **its filter is the only list of types that don't rebuild the site**.
A type left out of it starts a full Netlify build on every create, update and
delete.

Edit it at https://www.sanity.io/manage/project/ngx60q2x → API → Webhooks →
"Netlify rebuild" → Filter. Change nothing else on the webhook. Never add a
third webhook (both slots are used; see `docs/SHIPPING.md`).

## Filter

| | Filter |
|---|---|
| Was (since SHIPPING.md step 3b) | `!(_type match "sanity.*") && !(_type match "system.*") && !(_type in ["contactSubmission","order","lineItem","category","merchCategory","faq","returnRequest"])` |
| **Now** (adds `game`) | `!(_type match "sanity.*") && !(_type match "system.*") && !(_type in ["contactSubmission","order","lineItem","category","merchCategory","faq","returnRequest","game"])` |

`game` (sanity-galleries, PR #19) is Studio-only: the site never reads it, so
creating game records or adding game art must not rebuild. Image uploads are
`sanity.imageAsset` and are already excluded by `sanity.*`.

## Not covered

`character` and `worldLocation` are read by the site, so they stay in. Adding
images to their `referenceGallery` still starts a rebuild (one per document
patched). If a bulk gallery upload makes too many builds, the options are a
`delta::` clause on this filter or porting `content-build.mjs` (debounced
builds) from Cats On Crack.
