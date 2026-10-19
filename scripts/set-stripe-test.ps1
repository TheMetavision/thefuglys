# scripts/set-stripe-test.ps1 — Stripe TEST values for previews (The Fuglys)
#
# Puts a Stripe TEST secret key and a TEST webhook signing secret into the
# deploy-preview and branch-deploy contexts ONLY, so preview checkouts are
# test payments. Production (and dev / dev-server) keep their values; the
# script checks afterwards that every other context's value id is unchanged.
#
#   cd C:\Users\chris\Projects\thefuglys
#   powershell -ExecutionPolicy Bypass -File scripts\set-stripe-test.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\set-stripe-test.ps1 -Probe   # dry rehearsal, no Stripe values
#
# It asks for the two values (typed, never echoed or logged):
#   - a TEST key: rk_test_... (restricted: Checkout Sessions Write, Products Read) or sk_test_...
#   - the TEST-mode webhook endpoint's signing secret: whsec_...
#     (Stripe Dashboard > Developers, Test mode > Webhooks > the endpoint for this
#     site's preview URL, event checkout.session.completed)
# -Probe runs the same delete-and-set steps on a throwaway variable
# (CLAUDE_PROBE_DELETE_ME, dummy values, preview contexts only) and then deletes it.
#
# Talks to the Netlify API directly with the CLI's login (npx netlify-cli login), one
# context value at a time: no CLI prompts (the CLI asks before overwriting or unsetting
# in an interactive terminal, which made the first version fail), the variable keeps its
# secret flag and scopes, and Netlify's own error message is shown if a call fails.
param([switch]$Probe)
$ErrorActionPreference = 'Stop'
$SiteId   = 'dca358ca-0fa6-40fa-bc23-b85ccbde520a'   # thefuglys
$Contexts = @('deploy-preview', 'branch-deploy')

$cfg   = Get-Content (Join-Path $env:APPDATA 'netlify\Config\config.json') -Raw | ConvertFrom-Json
$token = $cfg.users.($cfg.userId).auth.token
if (-not $token) { throw 'Not logged in to Netlify: run  npx netlify-cli login  first.' }
$H    = @{ Authorization = "Bearer $token" }
$site = Invoke-RestMethod -Headers $H -Uri "https://api.netlify.com/api/v1/sites/$SiteId"
$Base = "https://api.netlify.com/api/v1/accounts/$($site.account_id)/env"

# Netlify's own error text (never the value we sent).
function Netlify($method, $uri, $body) {
  try {
    # -InputObject (not the pipeline) keeps a one-item array an array; -Depth keeps nested values.
    if ($body) { Invoke-RestMethod -Method $method -Headers $H -Uri $uri -ContentType 'application/json' -Body (ConvertTo-Json -InputObject $body -Depth 8 -Compress) }
    else { Invoke-RestMethod -Method $method -Headers $H -Uri $uri }
  } catch {
    $status = $_.Exception.Response.StatusCode.value__
    $msg = if ($_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
    throw "Netlify $method $($uri -replace '\?.*$','') -> $status $msg"
  }
}
function GetVar($key) {
  try { Invoke-RestMethod -Headers $H -Uri "$Base/${key}?site_id=$SiteId" }
  catch { if ($_.Exception.Response.StatusCode.value__ -eq 404) { $null } else { throw "Netlify GET $key -> $($_.ErrorDetails.Message)" } }
}
function Ids($key) {   # context -> value id
  $v = GetVar $key; $m = @{}
  if ($v) { foreach ($x in $v.values) { $m[$x.context] = $x.id } }
  $m
}
function Describe($key) {
  $v = GetVar $key
  if (-not $v) { return "${key}: not set" }
  "${key}: secret=$($v.is_secret); " + (($v.values | ForEach-Object { "$($_.context)=$($_.id.Substring(0,8))" }) -join ' ')
}
# Delete-then-recreate the value in each preview context only.
function SetPreview($key, $value) {
  $v = GetVar $key
  if (-not $v) { throw "$key is not set on this site at all; add it in the Netlify UI first (production value), then rerun." }
  foreach ($c in $Contexts) {
    foreach ($x in @($v.values | Where-Object { $_.context -eq $c })) { Netlify DELETE "$Base/$key/value/$($x.id)?site_id=$SiteId" $null | Out-Null }
    Netlify PATCH "$Base/${key}?site_id=$SiteId" @{ context = $c; value = $value } | Out-Null
  }
}

$linked = (Get-Content '.netlify\state.json' -Raw -ErrorAction SilentlyContinue | ConvertFrom-Json).siteId
if ($linked -ne $SiteId) { throw "Run this from C:\Users\chris\Projects\thefuglys (linked site $linked, expected $SiteId). Nothing changed." }

if ($Probe) {
  $k = 'CLAUDE_PROBE_DELETE_ME'
  Netlify POST "${Base}?site_id=$SiteId" @(@{ key = $k; is_secret = $true; scopes = @('builds','functions','runtime');
    values = @(@{ context = 'dev'; value = 'dummy-dev' }, @{ context = 'deploy-preview'; value = 'dummy-old' }, @{ context = 'branch-deploy'; value = 'dummy-old' }) }) | Out-Null
  $b = Ids $k; Write-Host "probe before: $(Describe $k)"
  SetPreview $k 'dummy-new'
  $a = Ids $k; Write-Host "probe after:  $(Describe $k)"
  $ok = ($a['dev'] -eq $b['dev']) -and ($a['deploy-preview'] -and $a['deploy-preview'] -ne $b['deploy-preview']) -and ($a['branch-deploy'] -and $a['branch-deploy'] -ne $b['branch-deploy'])
  Netlify DELETE "$Base/${k}?site_id=$SiteId" $null | Out-Null
  Write-Host ("probe " + $(if ($ok) { 'PASSED: preview values replaced, dev untouched; probe variable deleted.' } else { 'FAILED: see the ids above; probe variable deleted.' }))
  if (-not $ok) { exit 1 }
  exit 0
}

function Read-Secret($prompt) {
  $s = Read-Host -Prompt $prompt -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
$key = Read-Secret 'Stripe TEST secret key (rk_test_... or sk_test_...)'
if ($key -notmatch '^(rk|sk)_test_[A-Za-z0-9]+$') { throw 'Refused: that is not a Stripe TEST key (rk_test_/sk_test_). Nothing changed.' }
$whsec = Read-Secret 'TEST webhook signing secret (whsec_...)'
if ($whsec -notmatch '^whsec_[A-Za-z0-9]+$') { throw 'Refused: that is not a webhook signing secret (whsec_). Nothing changed.' }

$names  = 'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'
$before = @{}; foreach ($n in $names) { $before[$n] = Ids $n; Write-Host "before: $(Describe $n)" }
SetPreview 'STRIPE_SECRET_KEY' $key
SetPreview 'STRIPE_WEBHOOK_SECRET' $whsec
$key = $null; $whsec = $null

foreach ($n in $names) {
  $after = Ids $n
  foreach ($c in $before[$n].Keys) {
    if ($Contexts -contains $c) { continue }
    if ($after[$c] -ne $before[$n][$c]) { throw "STOP: $n $c value changed ($($before[$n][$c]) -> $($after[$c])). Check it in the Netlify UI now." }
  }
  foreach ($c in $Contexts) { if (-not $after[$c]) { throw "STOP: $n has no $c value after setting it." } }
  Write-Host "after:  $(Describe $n)"
}
Write-Host 'Done: TEST values in deploy-preview and branch-deploy; production, dev and dev-server unchanged. Redeploy the preview for them to apply.'
