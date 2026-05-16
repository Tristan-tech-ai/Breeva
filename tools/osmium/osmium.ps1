# Breeva osmium-tool wrapper — proxies args ke Docker container `breeva/osmium:latest`.
# Mounts $env:BREEVA_OSM_DATA (default D:\breeva-osm-data) sebagai /data dan auto-translate path Windows -> container.
#
# Usage (sama seperti native osmium):
#   .\tools\osmium\osmium.ps1 --version
#   .\tools\osmium\osmium.ps1 extract --bbox=98.60,3.52,98.78,3.70 D:\breeva-osm-data\sumatra-latest.osm.pbf -o D:\breeva-osm-data\medan-highway.osm.pbf
#   .\tools\osmium\osmium.ps1 tags-filter D:/breeva-osm-data/medan-highway.osm.pbf w/highway -o D:/breeva-osm-data/medan-roads.osm.pbf
#
# Tip: tambahkan alias di $PROFILE supaya bisa dipanggil "osmium ...":
#   Set-Alias osmium "C:\Users\Tristan\Downloads\breeva\tools\osmium\osmium.ps1"

$ErrorActionPreference = 'Stop'

$dataDir = if ($env:BREEVA_OSM_DATA) { $env:BREEVA_OSM_DATA } else { "D:\breeva-osm-data" }

if (-not (Test-Path $dataDir)) {
    Write-Host "Creating data directory: $dataDir" -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

$dataDirAbs = (Resolve-Path $dataDir).Path
$dataDirForward = $dataDirAbs -replace '\\', '/'

$translated = @()
foreach ($a in $args) {
    $s = [string]$a
    $pattern = '(?i)' + [regex]::Escape($dataDirAbs) + '|' + [regex]::Escape($dataDirForward)
    $s = $s -replace $pattern, '/data'
    $s = $s -replace '\\', '/'
    $translated += $s
}

$mount = "${dataDirAbs}:/data"
& docker run --rm -v $mount breeva/osmium:latest @translated
exit $LASTEXITCODE
