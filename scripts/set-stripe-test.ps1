# scripts/set-stripe-test.ps1 — Stripe TEST values for previews (The Fuglys)
#
# Puts a Stripe TEST secret key and a TEST webhook signing secret into the
# deploy-preview and branch-deploy contexts ONLY, so preview checkouts are
# test payments. Production keeps its live values; the script checks that
# production's value ids are unchanged afterwards and stops if they aren't.
#
#   cd C:\Users\chris\Projects\thefuglys
#   powershell -ExecutionPolicy Bypass -File scripts\set-stripe-test.ps1
#
# It asks for the two values (typed, never echoed or logged):
#   - a TEST key: rk_test_... (restricted: Checkout Sessions Write, Products Read) or sk_test_...
#   - the TEST-mode webhook endpoint's signing secret: whsec_...
#     (Stripe Dashboard > Developers, Test mode > Webhooks > the endpoint for this
#     site's preview URL, event checkout.session.completed)
# Needs: npx netlify-cli logged in (netlify login).

$ErrorActionPreference = 'Stop'
$SiteId   = 'dca358ca-0fa6-40fa-bc23-b85ccbde520a'   # thefuglys
$Contexts = @('deploy-preview', 'branch-deploy')

function Read-Secret($prompt) {
  $s = Read-Host -Prompt $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

# The CLI's own login, to read value ids from the Netlify API (values are never read).
$cfg   = Get-Content (Join-Path $env:APPDATA 'netlify\Config\config.json') -Raw | ConvertFrom-Json
$token = $cfg.users.($cfg.userId).auth.token
if (-not $token) { throw 'Not logged in to Netlify: run  npx netlify-cli login  first.' }
$H     = @{ Authorization = "Bearer $token" }
$site  = Invoke-RestMethod -Headers $H -Uri "https://api.netlify.com/api/v1/sites/$SiteId"
$linked = (Get-Content '.netlify\state.json' -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json).siteId
if ($linked -ne $SiteId) { throw "Run this from C:\Users\chris\Projects\thefuglys (linked site $linked, expected $SiteId). Nothing changed." }
function ProdValueId($key) {
  $v = Invoke-RestMethod -Headers $H -Uri "https://api.netlify.com/api/v1/accounts/$($site.account_id)/env/${key}?site_id=$SiteId"
  ($v.values | Where-Object { $_.context -eq 'production' }).id
}

$key = Read-Secret 'Stripe TEST secret key (rk_test_... or sk_test_...)'
if ($key -notmatch '^(rk|sk)_test_[A-Za-z0-9]+$') { throw 'Refused: that is not a Stripe TEST key (rk_test_/sk_test_). Nothing changed.' }
$whsec = Read-Secret 'TEST webhook signing secret (whsec_...)'
if ($whsec -notmatch '^whsec_[A-Za-z0-9]+$') { throw 'Refused: that is not a webhook signing secret (whsec_). Nothing changed.' }

$before = @{ STRIPE_SECRET_KEY = ProdValueId 'STRIPE_SECRET_KEY'; STRIPE_WEBHOOK_SECRET = ProdValueId 'STRIPE_WEBHOOK_SECRET' }
Write-Host "Production value ids before: key $($before.STRIPE_SECRET_KEY.Substring(0,8))..., webhook $($before.STRIPE_WEBHOOK_SECRET.Substring(0,8))..."

# Delete-then-recreate, explicit contexts, as secrets.
foreach ($pair in @(@('STRIPE_SECRET_KEY', $key), @('STRIPE_WEBHOOK_SECRET', $whsec))) {
  # Run from the repo folder: .netlify\state.json links it to the site above.
  npx -y netlify-cli@latest env:unset $pair[0] --context $Contexts | Out-Null
  npx -y netlify-cli@latest env:set $pair[0] $pair[1] --context $Contexts --secret | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "env:set $($pair[0]) failed" }
}
$key = $null; $whsec = $null

$after = @{ STRIPE_SECRET_KEY = ProdValueId 'STRIPE_SECRET_KEY'; STRIPE_WEBHOOK_SECRET = ProdValueId 'STRIPE_WEBHOOK_SECRET' }
foreach ($k in $before.Keys) {
  if ($before[$k] -ne $after[$k]) { throw "STOP: production $k changed ($($before[$k]) -> $($after[$k])). Check it in the Netlify UI now." }
}
foreach ($k in 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET') {
  $v = Invoke-RestMethod -Headers $H -Uri "https://api.netlify.com/api/v1/accounts/$($site.account_id)/env/${k}?site_id=$SiteId"
  Write-Host ("{0}: secret={1}; " -f $k, $v.is_secret) + (($v.values | ForEach-Object { "$($_.context)=$($_.id.Substring(0,8))" }) -join ' ')
}
Write-Host 'Done: TEST values in deploy-preview and branch-deploy; production unchanged. Redeploy the preview for them to apply.'
