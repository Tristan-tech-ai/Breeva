# Launch Claude Code in AUTONOMOUS MODE for Tier 1 execution.
#
# Usage:
#   .\scripts\run-tier-1.ps1
#
# Flags applied:
#   --dangerously-skip-permissions  → no approval prompts
#   --model claude-opus-4-7          → max capability
#   --add-dir <repo-root>            → full repo access
#
# Initial prompt is piped from eve\TIER_1_AGENT_PROMPT.md (sebagai konteks awal).
# Agent akan baca playbook + execute Phase 0 → 1.4 secara autonomous.
#
# Stop dengan Ctrl+C kapan saja. State (commits, DB migrations) survive.
# Re-run akan resume dari git state terakhir.

$ErrorActionPreference = 'Stop'

# Verify we're at repo root
if (-not (Test-Path "CLAUDE.md")) {
    Write-Host "ERROR: Run dari root project (cwd harus berisi CLAUDE.md)" -ForegroundColor Red
    exit 1
}

# Verify playbook + prompt exist
$promptFile = "eve\TIER_1_AGENT_PROMPT.md"
$playbookFile = "eve\TIER_1_EXECUTION.md"
$manualFile = "eve\PRECISION_MANUAL_STEPS.md"

foreach ($f in @($promptFile, $playbookFile, $manualFile)) {
    if (-not (Test-Path $f)) {
        Write-Host "ERROR: Missing file $f" -ForegroundColor Red
        Write-Host "Pastikan playbook + entry prompt sudah generated." -ForegroundColor Red
        exit 1
    }
}

# Pre-flight: prerequisite env vars
Write-Host "Pre-flight env vars check..." -ForegroundColor Cyan
$envFile = ".env.local"
if (-not (Test-Path $envFile)) {
    Write-Host "ERROR: .env.local tidak ada" -ForegroundColor Red
    exit 1
}
$envContent = Get-Content $envFile -Raw
$requiredVars = @(
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GEMINI_API_KEYS',
    'CDSE_USERNAME',
    'CDSE_PASSWORD',
    'TOMTOM_API_KEY',
    'SUPABASE_POOLER_URL'
)
$missing = @()
foreach ($v in $requiredVars) {
    if ($envContent -notmatch "(?m)^\s*$v\s*=") { $missing += $v }
}
if ($missing.Count -gt 0) {
    Write-Host "ERROR: Missing env vars di .env.local:" -ForegroundColor Red
    $missing | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "`nLihat eve\PRECISION_MANUAL_STEPS.md untuk cara dapatkan." -ForegroundColor Yellow
    exit 1
}
Write-Host "  All env vars present" -ForegroundColor Green

# Verify git working tree (warn but don't block)
$gitStatus = git status --short
if ($gitStatus) {
    Write-Host "WARNING: working tree tidak clean:" -ForegroundColor Yellow
    Write-Host $gitStatus
    $confirm = Read-Host "Lanjut anyway? (y/N)"
    if ($confirm -ne 'y' -and $confirm -ne 'Y') { exit 1 }
}

# Verify pre-existing classify-backlog tidak masih jalan (akan conflict dengan classify per kota baru)
$nodeProcesses = Get-Process -Name node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "INFO: Node processes detected (mungkin classify-backlog masih jalan):" -ForegroundColor Yellow
    $nodeProcesses | Format-Table Id, Name, CPU, WorkingSet -AutoSize
    Write-Host "Agent akan lihat existing processes via tasklist." -ForegroundColor Yellow
}

Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host "  TIER 1 AUTONOMOUS EXECUTION" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "Mode:        --dangerously-skip-permissions" -ForegroundColor White
Write-Host "Model:       claude-opus-4-7" -ForegroundColor White
Write-Host "Working dir: $PWD" -ForegroundColor White
Write-Host "Playbook:    $playbookFile (1456 lines)" -ForegroundColor White
Write-Host "Manual ref:  $manualFile" -ForegroundColor White
Write-Host "Entry:       $promptFile" -ForegroundColor White
Write-Host "Phases:      Phase 0 + 1.1 + 1.2 + 1.3 + 1.4" -ForegroundColor White
Write-Host "Budget:      7 hari kalendar (hard cap)" -ForegroundColor White
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Load entry prompt
$entryPrompt = Get-Content $promptFile -Raw

# Verify `claude` CLI installed
$claudeExe = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claudeExe) {
    Write-Host "ERROR: claude CLI tidak ditemukan di PATH" -ForegroundColor Red
    Write-Host "Install via: npm install -g @anthropic-ai/claude-code" -ForegroundColor Yellow
    exit 1
}
Write-Host "Using claude at: $($claudeExe.Source)" -ForegroundColor DarkGray

# Final confirmation
Write-Host "`nLaunching Claude Code in 3 seconds... Ctrl+C untuk cancel." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Launch — pipe entry prompt as initial message via stdin
# Note: claude CLI mendukung `-p` untuk non-interactive single-shot,
# tapi untuk multi-turn autonomous mode kita pakai interactive mode
# dan paste prompt via stdin (CLI akan tahan koneksi).
#
# --add-dir gives agent access ke tambahan paths (mis. D:\breeva-osm-data
# untuk Phase 0 Geofabrik fallback).
& claude `
    --dangerously-skip-permissions `
    --model claude-opus-4-7 `
    --add-dir "D:\breeva-osm-data" `
    --append-system-prompt "Operating mode: autonomous Tier 1 execution. No approval prompts. Refer eve\TIER_1_AGENT_PROMPT.md for full spec." `
    $entryPrompt

$exitCode = $LASTEXITCODE
Write-Host "`n=========================================" -ForegroundColor Cyan
Write-Host "Tier 1 session ended (exit $exitCode)" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Post-flight verifikasi
Write-Host "`nFinal git state:" -ForegroundColor Cyan
git log --oneline -10
Write-Host "`nFinal DB state:" -ForegroundColor Cyan
Write-Host "  Run: psql `$SUPABASE_POOLER_URL -c `"\dt`" untuk inspect tables" -ForegroundColor DarkGray

exit $exitCode
