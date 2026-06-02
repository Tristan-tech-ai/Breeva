# Refresh the "Breeva Cloud Health" dashboard, $0:
#   1. regenerate panels.json from the LIVE ADX free cluster + App Insights probe health
#   2. redeploy the static site to Azure Static Web Apps (Free)
#
# Runs on the always-on rig (local-first strategy) — it uses the local `az` CLI auth, which is
# what reaches the ADX free cluster (a separate $0 entity with no service principal) and the
# breeva-logs workspace. The GitHub Actions workflow (.github/workflows/datathon-deploy.yml)
# deploys code changes from git; THIS script keeps the live DATA fresh.
#
# Wire to Task Scheduler (every 6h) — run once, elevated:
#   $s = "C:\Users\Tristan\Downloads\breeva\scripts\azure\refresh_dashboard.ps1"
#   schtasks /Create /TN "Breeva\DashboardRefresh" /SC HOURLY /MO 6 /RL LIMITED /F `
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File `"$s`""
#
# Manual run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\azure\refresh_dashboard.ps1

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)   # ...\breeva
$py   = Join-Path $repo "vayu\.venv\Scripts\python.exe"
$dash = Join-Path $repo "vayu\azure\dashboard"
$az   = "C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin\az.cmd"

Write-Host "[refresh] regenerating panels.json from live ADX + App Insights..."
& $py (Join-Path $repo "vayu\azure\build_dashboard_data.py")
if ($LASTEXITCODE -ne 0) { throw "build_dashboard_data.py failed (exit $LASTEXITCODE)" }

# SWA deploy token: prefer env var (so it need not be stored on disk), else fetch via az.
$token = $env:SWA_DEPLOY_TOKEN
if (-not $token) {
  $token = (& $az staticwebapp secrets list -n breeva-health -g breeva-rg --query "properties.apiKey" -o tsv).Trim()
}
if (-not $token) { throw "no SWA deploy token (set `$env:SWA_DEPLOY_TOKEN or run az login)" }

# SWA CLI (installed via `npm i -g @azure/static-web-apps-cli`).
$swa = Join-Path $env:APPDATA "npm\swa.cmd"
if (-not (Test-Path $swa)) { $swa = "swa" }   # fall back to PATH

Write-Host "[refresh] deploying to Azure SWA (Free)..."
& $swa deploy $dash --deployment-token $token --env production
if ($LASTEXITCODE -ne 0) { throw "swa deploy failed (exit $LASTEXITCODE)" }

Write-Host "[refresh] done -> https://jolly-ocean-030041400.7.azurestaticapps.net"
