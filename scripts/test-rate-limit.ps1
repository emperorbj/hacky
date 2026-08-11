<#
.SYNOPSIS
  Fires repeated requests at the API to verify the Arcjet rate limit rule
  (slidingWindow, configured in src/app.module.ts) actually blocks traffic.

.PARAMETER Count
  Number of requests to send. Default sends a few more than the configured
  limit so you can see it flip from 200 -> 403.

.PARAMETER Url
  Endpoint to hit. Defaults to the root route.

.PARAMETER ApiKey
  Value sent as the x-api-key header. Must match the API_KEY env var the
  server was started with, otherwise ApiKeyMiddleware will 401 every request
  before Arcjet is ever reached.

.EXAMPLE
  # In one terminal:
  $env:API_KEY = "test123"
  npm run start:dev

  # In another terminal:
  .\scripts\test-rate-limit.ps1 -ApiKey test123
#>
param(
  [int]$Count = 10,
  [string]$Url = "http://127.0.0.1:3000/",
  [string]$ApiKey = "test123"
)

Write-Host "Sending $Count requests to $Url ..." -ForegroundColor Cyan

$results = @()
for ($i = 1; $i -le $Count; $i++) {
  try {
    $response = Invoke-WebRequest -Uri $Url -Headers @{ "x-api-key" = $ApiKey } -Method Get -SkipHttpErrorCheck
    $code = $response.StatusCode
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
  }
  $results += $code
  $color = if ($code -eq 200) { "Green" } elseif ($code -eq 403) { "Red" } elseif ($code -eq 401) { "Yellow" } else { "Gray" }
  Write-Host "  [$i] $code" -ForegroundColor $color
}

Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan
$results | Group-Object | Sort-Object Name | ForEach-Object {
  Write-Host ("  {0} -> {1} request(s)" -f $_.Name, $_.Count)
}

if ($results -contains 403) {
  Write-Host "`nRate limit triggered (403 seen) - Arcjet is enforcing." -ForegroundColor Green
} elseif ($results -contains 401) {
  Write-Host "`nAll/some requests got 401 - check that -ApiKey matches the server's API_KEY env var." -ForegroundColor Yellow
} else {
  Write-Host "`nNo 403 seen. Increase -Count, or check that ARCJET_ENV=development is set in .env (otherwise Arcjet can't fingerprint localhost requests and fails open)." -ForegroundColor Yellow
}
