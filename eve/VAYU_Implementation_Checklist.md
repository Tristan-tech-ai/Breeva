# VAYU Engine — Implementation Checklist
### Breeva Air Intelligence Engine | Berdasarkan ERD v2.2.0
> Checklist lengkap dari nol sampai production. Setiap item memiliki referensi ke ERD section terkait.

---

## Legend

- ✅ = Sudah selesai / sudah tersedia
- ☐ = Belum dikerjakan
- 🔴 = MVP (harus selesai sebelum launch Phase 0)
- 🟡 = Phase 0.5 (bulan 1–3 setelah MVP)
- 🟢 = Phase 1+ (setelah MVP stabil)
- 📎 = Referensi ke ERD section

---

## STAGE 0: Persiapan Akun & API Key

> Semua service gratis. Tidak ada biaya.
> 📎 ERD Section 17.1

### Akun yang Sudah Ada (Verifikasi Saja)

| # | Task | Status | Catatan |
|---|---|---|---|
| 0.1 | Verifikasi **Supabase** project aktif (tidak paused) | ✅ Done | `tqhdlcwiyqrnlrgjsymc.supabase.co` |
| 0.2 | Verifikasi **Vercel** project "breeva" aktif | ✅ Done | breeva.site |
| 0.3 | Verifikasi **GitHub** repo "Breeva" — Actions enabled | ✅ Done | github.com/Tristan-tech-ai/Breeva |
| 0.4 | Verifikasi **Upstash Redis** database aktif | ✅ Done | console.upstash.com |
| 0.5 | Verifikasi **OpenRouteService** API key masih valid | ✅ Done | 2.000 req/hari |

### Akun Baru — MVP (🔴 Wajib Sebelum Coding)

| # | Task | Status | URL | Key yang Didapat |
|---|---|---|---|---|
| 0.6 | **Open-Meteo** — tidak perlu registrasi | ☐ Verify | open-meteo.com | Tidak perlu key |

> Open-Meteo adalah satu-satunya external API yang dibutuhkan untuk MVP. Semua resource lain (OSM, H3, dispersion math) berjalan lokal atau dari cache.

### Akun Baru — Phase 0.5 (🟡 Setelah MVP Jalan)

| # | Task | Status | URL | Key yang Didapat |
|---|---|---|---|---|
| 0.7 | Daftar **TomTom Developer** + buat App | ✅ Done | developer.tomtom.com | `LhF1ZeQYGYUp7LRhxeU730ec2TbusXPn` |
| 0.8 | ~~Daftar **OpenAQ v3**~~ — server bug, skip | ⛔ Blocked | ~~explore.openaq.org~~ | Gunakan **WAQI** (0.9) sebagai pengganti |
| 0.9 | Request **WAQI** data platform token | ✅ Done | aqicn.org/data-platform/token | `1c259ba8c32df7b10067f1ce09b7b8301f874629` |

### Akun Baru — Phase 1+ (🟢 Nanti Saja)

| # | Task | Status | URL | Key yang Didapat |
|---|---|---|---|---|
| 0.10 | Daftar **IQAir** Community plan | ✅ Done | dashboard.iqair.com | `e32ddc01-2d2d-4430-be2f-9856f391712b` |
| 0.11 | Daftar **OpenTopography** | ✅ Done | opentopography.org | `6f6676e9f1c8c93c48939acca38c672c` |
| 0.12 | Daftar **Copernicus CDSE** | ✅ Done | dataspace.copernicus.eu | `1542ce3c-9ea6-4507-926c-4119eb864bee` |
| 0.13 | Daftar **NASA Earthdata** | ✅ Done | urs.earthdata.nasa.gov | `eyJ0eXAiOiJKV1QiLCJvcmlnaW4iOiJFYXJ0aGRhdGEgTG9naW4iLCJzaWciOiJlZGxqd3RwdWJrZXlfb3BzIiwiYWxnIjoiUlMyNTYifQ.eyJ0eXBlIjoiVXNlciIsInVpZCI6ImNyYWZ0aWZ5IiwiZXhwIjoxNzc4MjIzOTg3LCJpYXQiOjE3NzMwMzk5ODcsImlzcyI6Imh0dHBzOi8vdXJzLmVhcnRoZGF0YS5uYXNhLmdvdiIsImlkZW50aXR5X3Byb3ZpZGVyIjoiZWRsX29wcyIsImFjciI6ImVkbCIsImFzc3VyYW5jZV9sZXZlbCI6M30.X4Z6FJU9cpCxWqj7QuTVKg5pl94FURGiGSsJJ6YAtXKVYkQGCgtwYEo7ObLIPWoKk-2LwvLjtLVVZ09aRZX92vEavNk2NPcUoJT04b6eiTQ3cYOHWepa7AbQ9PwsahNxHENgOpVZSwS37m4XUbcFcTQ928x74JbjYnyINxg6mKQWPbYTexH56l_FS5VXPbPNHM4l8NNBQNu1kXdaxDo8t8zHgglmuyvKsF2f13Sp744I7nolZAo4Ee3i97ijue9_AdHdu1mOdilZhMI5yg9vU6Gh8Ovjecj5BZYUB3gko5JWNiGLJGPwW9xGwStdt4pfGt-oIyor61uZEeqx9QbARA` |
| 0.14 | Daftar **Cloudflare R2** (opsional, untuk Parquet storage) | ☐ Todo | dash.cloudflare.com | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` |

---

## STAGE 1: Setup Environment & Tools

> 📎 ERD Section 17.2, 17.5, 17.6

### 1A. TypeScript Dependencies (Mode A — Vercel Serverless)

| # | Task | Status | Command / Detail |
|---|---|---|---|
| 1.1 | Install **h3-js** (hexagonal grid) | ✅ Done | h3-js 4.4.0 |
| 1.2 | Install **ngeohash** (geohash encoding) | ✅ Done | ngeohash 0.6.3 |
| 1.3 | Install **@types/ngeohash** | ✅ Done | @types/ngeohash 0.6.8 |
| 1.4 | Verifikasi **openmeteo** sudah terinstall | ✅ Done | Sudah ada di package.json |
| 1.5 | Verifikasi **@supabase/supabase-js** sudah terinstall | ✅ Done | Sudah ada di package.json |

### 1B. Python Environment (Mode B — GitHub Actions)

| # | Task | Status | Detail |
|---|---|---|---|
| 1.6 | Install **Python 3.11+** di local machine | ✅ Done | python.org/downloads — centang "Add to PATH" |
| 1.7 | Buat folder `breeva/vayu/` | ✅ Done | + core/, ml/, calibration/, jobs/, tests/ |
| 1.8 | Buat virtual environment | ✅ Done | Python 3.14.3 venv |
| 1.9 | Aktivasi venv | ✅ Done | `.\.venv\Scripts\Activate.ps1` |
| 1.10 | Buat `vayu/requirements.txt` | ✅ Done | 13 packages (numpy≥ 2.0 untuk Python 3.14 compat) |
| 1.11 | Install Python dependencies | ✅ Done | Semua import OK. `supabase` diganti `postgrest`+`gotrue` (pyiceberg butuh MSVC) |
| 1.12 | Buat `vayu/.python-version` (isi: `3.14`) | ✅ Done | Sesuai Python aktual |
| 1.13 | Tambah `vayu/.venv/` ke `.gitignore` | ✅ Done | + `__pycache__/`, `*.pyc` |

### 1C. Environment Variables

| # | Task | Status | Detail |
|---|---|---|---|
| 1.14 | Update `.env.example` dengan VAYU vars | ✅ Done | Semua phase vars ditambahkan |
| 1.15 | Catat `SUPABASE_SERVICE_ROLE_KEY` dari Supabase Dashboard | ✅ Done | Ditambahkan ke Vercel production |
| 1.16 | Tambah VAYU env vars di **Vercel** (via CLI) | ✅ Done | 6/6: `TOMTOM_API_KEY`, `WAQI_TOKEN`, `IQAIR_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` |
| 1.17 | Update `.env.local` dengan Phase 0.5 vars (nanti) | ☐ Later | `TOMTOM_API_KEY`, `WAQI_TOKEN` |

---

## STAGE 2: Database Setup

> 📎 ERD Section 17.4, 17.10

### 2A. Supabase Dashboard Configuration

| # | Task | Status | Detail |
|---|---|---|---|
| 2.1 | Enable **PostGIS** extension | ✅ Done | Via `vayu_migration.sql` |
| 2.2 | Verifikasi **uuid-ossp** extension aktif | ✅ Done | Sudah enabled |
| 2.3 | Pastikan PostGIS functions accessible via search path | ✅ Done | `extensions` sudah di Extra search path, `postgis_version()` return 200 OK |
| 2.4 | Disable realtime untuk tabel VAYU (hemat bandwidth) | ✅ Done | Tabel VAYU dibuat via SQL migration — tidak masuk realtime publication by default |

### 2B. Run Migration SQL

| # | Task | Status | Detail |
|---|---|---|---|
| 2.5 | Buat tabel **aqi_grid** + indexes | ✅ Done | Via `vayu_migration.sql` |
| 2.6 | Buat tabel **road_segments** + indexes | ✅ Done | Via `vayu_migration.sql` |
| 2.7 | Buat tabel **ghost_paths** + index | ✅ Done | Via `vayu_migration.sql` |
| 2.8 | Buat tabel **vayu_contributions** + indexes | ✅ Done | Via `vayu_migration.sql` |
| 2.9 | Buat functions **purge_old_contributions()** + **purge_dead_tiles()** | ✅ Done | Via `vayu_migration.sql` |
| 2.10 | Buat tabel **traffic_calibration** | ✅ Done | Via `vayu_migration.sql` |
| 2.11 | Enable **RLS** untuk semua tabel VAYU | ✅ Done | Via `vayu_migration.sql` |
| 2.12 | Buat **RLS policies** (public read + service write) | ✅ Done | Via `vayu_migration.sql` |
| 2.13 | Test: query `SELECT PostGIS_version();` berhasil | ✅ Done | Verifikasi PostGIS aktif |
| 2.14 | Test: `SELECT * FROM aqi_grid LIMIT 1;` (kosong tapi no error) | ✅ Done | Verifikasi tabel exist |

---

## STAGE 3: OSM Data Processing (Multi-Region Setup) ✅ COMPLETE

> 📎 ERD Section 17.9, 5.1
> **Coverage:** Bali (seluruh pulau, 8 kabupaten) + Jawa (7 kota) + Sulawesi (6 provinsi)
> **Total: 642,528 road segments | 14 DB regions | Verified 10 Maret 2026**

### 3A. Script & Infra

| # | Task | Status | Detail |
|---|---|---|---|
| 3.1 | Buat script `vayu/jobs/process_osm.py` | ✅ Done | Adaptive tiling, REST API UPSERT, R-tree spatial index, `--region` flag + `--all` |
| 3.2 | Run `vayu_migration_002_multiregion.sql` di Supabase | ✅ Done | ALTER: drop DEFAULT 'bali', set region NOT NULL |
| 3.3 | Extract per road: way_id, geometry, highway, lanes, width, surface, maxspeed | ✅ Done | Shared logic untuk semua region |
| 3.4 | Query landuse/natural tags dalam 50m buffer per road | ✅ Done | Proxy vegetasi via R-tree |
| 3.5 | Calculate canyon_ratio dari nearby buildings | ✅ Done | building_height / road_width, R-tree optimized |
| 3.6 | Assign traffic_base_estimate per road class (OSM heuristic) | ✅ Done | 📎 ERD 4.5 |

### 3B. Region: Bali (seluruh pulau — 8 kabupaten sub-regions)

| # | Task | Status | Detail |
|---|---|---|---|
| 3.7 | Process **Bali** (8 sub-regions: Denpasar, Badung, Gianyar, Karangasem, Klungkung, Tabanan, Bangli, Jembrana) | ✅ Done | 95,284 segments — all stored as region="bali" |
| 3.8 | Verifikasi: `SELECT COUNT(*) FROM road_segments WHERE region='bali';` → 95,284 | ✅ Done | |

### 3C. Region: Jawa (7 kota)

| # | Task | Status | Detail |
|---|---|---|---|
| 3.9 | Process **Jakarta** (Jabodetabek) | ✅ Done | 139,203 segments |
| 3.10 | Process **Bandung** Raya | ✅ Done | 28,269 segments |
| 3.11 | Process **Surabaya** (Gerbangkertosusila) | ✅ Done | 28,937 segments |
| 3.12 | Process **Semarang** | ✅ Done | 18,917 segments |
| 3.13 | Process **Yogyakarta** | ✅ Done | 19,912 segments |
| 3.14 | Process **Solo** (Surakarta) | ✅ Done | 13,540 segments |
| 3.15 | Process **Malang** | ✅ Done | 12,216 segments |
| 3.16 | Verifikasi: `SELECT region, COUNT(*) FROM road_segments GROUP BY region;` | ✅ Done | Semua 7 kota Jawa ada data (260,994 total) |

### 3D. Region: Sulawesi (6 provinsi — seluruh pulau)

| # | Task | Status | Detail |
|---|---|---|---|
| 3.17 | Process **Sulawesi Selatan** (sulsel) | ✅ Done | 130,327 segments |
| 3.18 | Process **Sulawesi Barat** (sulbar) | ✅ Done | 13,942 segments |
| 3.19 | Process **Sulawesi Tengah** (sulteng) | ✅ Done | 38,448 segments |
| 3.20 | Process **Gorontalo** | ✅ Done | 17,836 segments |
| 3.21 | Process **Sulawesi Utara** (sulut) | ✅ Done | 50,252 segments |
| 3.22 | Process **Sulawesi Tenggara** (sultra) | ✅ Done | 35,445 segments |
| 3.23 | Verifikasi total: `SELECT COUNT(*) FROM road_segments;` → 642,528 | ✅ Done | 14/14 region terisi |

---

## STAGE 4: Mode A — Vercel Serverless API Endpoints

> 📎 ERD Section 3.0, 3.1 (Path A), 5.1, 5.3, 7, 8

### 4A. Core API: `/api/vayu/aqi`

| # | Task | Status | Detail |
|---|---|---|---|
| 4.1 | Buat file `api/vayu/aqi.ts` | ✅ Done | GET ?lat=&lon= — `api/vayu/aqi.ts` |
| 4.2 | Implement: lat/lon → H3 tile_id (resolution 11) | ✅ Done | `latLngToCell(lat, lon, 11)` via h3-js |
| 4.3 | Implement: cek Upstash Redis cache (`vayu:tile:{tile_id}`) | ✅ Done | TTL 900s, X-Cache: HIT-REDIS |
| 4.4 | Implement: cek Supabase `aqi_grid` table | ✅ Done | PostgREST query WHERE valid_until > now, X-Cache: HIT-SUPABASE |
| 4.5 | Implement: lazy compute jika cache miss | ✅ Done | Calls `computeDispersion()` from dispersion.ts |
| 4.6 | Implement: UPSERT result ke Supabase + Redis | ✅ Done | Via `upsert_aqi_tile` RPC + Redis SET EX 900 |
| 4.7 | Implement: return `AQIResponse` (aqi, confidence, freshness) | ✅ Done | Includes freshness label (live/recent/stale/fallback) |
| 4.8 | Implement: hit_count increment (hot spot tracking) | ✅ Done | Atomic increment via RPC ON CONFLICT |

### 4B. Dispersion Engine (Gaussian Point-Source, TypeScript)

| # | Task | Status | Detail |
|---|---|---|---|
| 4.9 | Buat module `src/lib/vayu/dispersion.ts` | ✅ Done | `src/lib/vayu/dispersion.ts` — CALINE3-simplified |
| 4.10 | Implement: lookup nearest road_segment dari Supabase | ✅ Done | Via `find_nearby_roads` RPC (PostGIS ST_DWithin) |
| 4.11 | Implement: fetch weather data dari Open-Meteo | ✅ Done | wind_speed_10m, wind_direction, temperature, humidity |
| 4.12 | Implement: cache Open-Meteo response 1 jam | ✅ Done | In-memory Map cache, 1hr TTL |
| 4.13 | Implement: emission rate Q = traffic_volume × emission_factor | ✅ Done | NOx=1.2, PM2.5=0.08, CO=7.5 g/km fleet avg |
| 4.14 | Implement: Gaussian dispersion formula (σy, σz, wind) | ✅ Done | Class D neutral σy/σz, `C=(Q/π·σy·σz·u)·2·exp(-H²/2σz²)` |
| 4.15 | Implement: apply OSM landuse vegetation modifier | ✅ Done | forest=0.70, park=0.80, industrial=1.25, commercial=1.10 |
| 4.16 | Implement: cultural temporal modifier | ✅ Done | Via `getCulturalModifier()` from cultural-calendar.ts |
| 4.17 | Implement: diurnal traffic modifier (hourly pattern) | ✅ Done | 24-hour table, peak 18:00=1.60, trough 03:00=0.08 |
| 4.18 | Implement: combine baseline (Open-Meteo) + dispersion delta | ✅ Done | Open-Meteo Air Quality API pm2.5 baseline + dispersion Δ |
| 4.19 | Implement: confidence score per layer_source | ✅ Done | Base 0.35 (Mode A), -0.10 per degraded source |

### 4C. Cultural Calendar Module

| # | Task | Status | Detail |
|---|---|---|---|
| 4.20 | Buat module `src/lib/vayu/cultural-calendar.ts` | ✅ Done | `src/lib/vayu/cultural-calendar.ts` |
| 4.21 | Implement: Nyepi detection (hardcoded 2025–2029) | ✅ Done | Bali-only, modifier=0.0 (zero traffic) |
| 4.22 | Implement: Galungan detection (modulo 210 hari) | ✅ Done | Reference 2025-01-15, 210-day wuku cycle |
| 4.23 | Implement: Lebaran estimation (hardcoded / API Kemenag) | ✅ Done | Hardcoded 2025–2029, H-3→H-1=4.2x mudik, H0→H+2=3.5x |
| 4.24 | Implement: Natal/Tahun Baru (Gregorian — trivial) | ✅ Done | Dec 24-26 + Jan 1 = 2.8x modifier |
| 4.25 | Implement: diurnal hourly traffic modifier | ✅ Done | ERD 8.2 — full 24-hour table |
| 4.26 | Return: combined modifier (0.0–2.0 multiplier) | ✅ Done | `{ event, trafficMultiplier, diurnalMultiplier, combined }` |

### 4D. Route Scoring: `/api/vayu/route-score`

| # | Task | Status | Detail |
|---|---|---|---|
| 4.27 | Buat file `api/vayu/route-score.ts` | ✅ Done | `api/vayu/route-score.ts` — POST polyline + vehicle_type |
| 4.28 | Implement: sample N titik sepanjang polyline | ✅ Done | Max 20 equidistant points |
| 4.29 | Implement: batch AQI lookup per sample point | ✅ Done | Parallel `computeDispersion()` per sample |
| 4.30 | Implement: weighted average AQI per route | ✅ Done | avg/max/min AQI + per-segment data |
| 4.31 | Implement: combined score (aqi_weight × aqi + time_weight × time) | ✅ Done | ERD 9.2: pedestrian 0.70/0.30, car 0.40/0.60, etc. |

### 4E. Cumulative Exposure: `/api/vayu/exposure`

| # | Task | Status | Detail |
|---|---|---|---|
| 4.32 | Buat file `api/vayu/exposure.ts` | ✅ Done | `api/vayu/exposure.ts` — POST polyline + vehicle_type + duration |
| 4.33 | Implement: CE formula (konsentrasi × durasi × VR × IF) | ✅ Done | `Dose = C[μg/m³] × duration × (VR/1000) × IF` per segment |
| 4.34 | Implement: parameter VR + IF per vehicle type | ✅ Done | 8 vehicle types: ped=27.5L/1.0, cyclist=50/1.0, moto_open=15/0.85, etc. |
| 4.35 | Implement: cigarette equivalence (pm25Inhaled / 253) | ✅ Done | Berkeley Earth 253 μg benchmark |
| 4.36 | Implement: healthRiskLevel classification | ✅ Done | <0.5 cig=low, <1.5=moderate, <3.0=high, ≥3.0=very_high |
| 4.37 | Implement: comparison vs cleanest route alternative | ⏳ Deferred | Requires multi-route comparison (Stage 5 frontend integration) |

### 4F. Crowdsource Contribution: `/api/vayu/contribute`

| # | Task | Status | Detail |
|---|---|---|---|
| 4.38 | Buat file `api/vayu/contribute.ts` | ✅ Done | `api/vayu/contribute.ts` — POST single contribution |
| 4.39 | Implement: validate session_id (UUID, anonymous) | ✅ Done | Regex UUID validation, NOT user ID |
| 4.40 | Implement: INSERT ke vayu_contributions | ✅ Done | PostgREST INSERT with service_role_key |
| 4.41 | Implement: rate limiting via Upstash Redis | ✅ Done | SET NX EX 600 — 1 per IP per way/geohash per 10min |

### 4G. Degradation & Circuit Breaker

| # | Task | Status | Detail |
|---|---|---|---|
| 4.42 | Buat module `src/lib/vayu/circuit-breaker.ts` | ✅ Done | `src/lib/vayu/circuit-breaker.ts` |
| 4.43 | Implement: CircuitBreaker per external service | ✅ Done | In-memory Map, MAX_FAILS=3, COOLDOWN=5min |
| 4.44 | Implement: stale data serving dengan freshness label | ✅ Done | live(<15m)/recent(15-60m)/stale(1-6h)/fallback(>6h) |
| 4.45 | Implement: fallback behavior per service down | ✅ Done | `withCircuitBreaker<T>(service, fn, fallback)` wrapper |

### 4H. Mode A/B Reconciliation Logic

| # | Task | Status | Detail |
|---|---|---|---|
| 4.46 | Implement: Mode A tidak overwrite Mode B result | ✅ Done | SQL RPC: `upsert_aqi_tile` — CASE WHEN layer_source ≥ 2 |
| 4.47 | Implement: confidence degradation gradual (expired B tile) | ✅ Done | `GREATEST(0.35, old_confidence - 0.05)` in RPC |
| 4.48 | Implement: layer_source badge di response | ✅ Done | aqi.ts returns layer_source + freshness in response |

---

## STAGE 5: Frontend Integration

> 📎 ERD Section 3.0, 7.4, 9, 13.3

| # | Task | Status | Detail |
|---|---|---|---|
| 5.1 | Replace mock AQI di `api/air-quality/index.ts` → call VAYU | ☐ Todo | Remove random mock data |
| 5.2 | Implement: AQI heatmap layer di Leaflet map | ☐ Todo | Color-coded tiles |
| 5.3 | Implement: confidence badge di UI | ☐ Todo | layer_source → "Estimasi" / "Akurat" / "ML" |
| 5.4 | Implement: freshness indicator | ☐ Todo | "Live" / "⚠️ X menit lalu" / "⚠️ Estimasi kasar" |
| 5.5 | Implement: route comparison UI (AQI per rute) | ☐ Todo | "Tercepat (AQI 85)" vs "Terbersih (AQI 52, +3 min)" |
| 5.6 | Implement: cumulative exposure result card | ☐ Todo | Total dose + cigarette equivalent + risk level |
| 5.7 | Implement: multi-vehicle selector | ☐ Todo | 📎 ERD 9.1 — pedestrian, bicycle, motorcycle, car, etc. |
| 5.8 | Implement: contributor opt-in flow (Tier 0/1/2/3) | ☐ Todo | 📎 ERD 10.2 |

---

## STAGE 6: Mode B — Python Background Engine

> 📎 ERD Section 3.1 (Path B), 5.1, 11.3, 17.6

### 6A. Core Python Modules

| # | Task | Status | Detail |
|---|---|---|---|
| 6.1 | Buat `vayu/core/caline3.py` — full CALINE3 dispersion | ☐ Todo | numpy + scipy, line-source integration |
| 6.2 | Buat `vayu/core/grid_manager.py` — H3 + UPSERT ke Supabase | ☐ Todo | h3-py + psycopg2 |
| 6.3 | Buat `vayu/core/weather.py` — Open-Meteo fetcher | ☐ Todo | httpx async |
| 6.4 | Buat `vayu/core/traffic.py` — traffic estimation | ☐ Todo | Multi-source: OSM + TomTom sampling |
| 6.5 | Buat `vayu/core/cultural_calendar.py` — modifiers | ☐ Todo | Mirror TS implementation |
| 6.6 | Buat `vayu/core/osm_processor.py` — Overpass query | ☐ Todo | Road + landuse extraction |

### 6B. Background Jobs

| # | Task | Status | Detail |
|---|---|---|---|
| 6.7 | Buat `vayu/jobs/refresh_hotspots.py` — main cron job | ☐ Todo | Query hot tiles → recompute → UPSERT |
| 6.8 | Buat `vayu/jobs/ping_supabase.py` — keep-alive | ☐ Todo | Prevent Supabase pause (tiap 6 hari) |
| 6.9 | Buat `vayu/jobs/export_parquet.py` — history export | ☐ Todo | Weekly: aqi_grid snapshot → Parquet |

### 6C. Unit Tests

| # | Task | Status | Detail |
|---|---|---|---|
| 6.10 | Buat `vayu/tests/test_caline3.py` | ☐ Todo | Validate dispersion math |
| 6.11 | Buat `vayu/tests/test_grid.py` | ☐ Todo | H3 indexing correctness |
| 6.12 | Buat `vayu/tests/test_traffic.py` | ☐ Todo | Traffic estimation logic |

---

## STAGE 7: GitHub Actions Workflows

> 📎 ERD Section 17.7, 17.7.1, 17.8

### 7A. GitHub Secrets

| # | Task | Status | Secret Name |
|---|---|---|---|
| 7.1 | Set `SUPABASE_URL` | ☐ Todo | `https://tqhdlcwiyqrnlrgjsymc.supabase.co` |
| 7.2 | Set `SUPABASE_SERVICE_ROLE_KEY` | ☐ Todo | Dari Supabase Dashboard |
| 7.3 | Set `TOMTOM_API_KEY` (Phase 0.5) | ☐ Later | Dari developer.tomtom.com |
| 7.4 | Set `OPENAQ_API_KEY` (Phase 0.5) | ☐ Later | Dari explore.openaq.org |
| 7.5 | Set `WAQI_TOKEN` (Phase 0.5) | ☐ Later | Dari aqicn.org |

### 7B. Workflow Files

| # | Task | Status | File |
|---|---|---|---|
| 7.6 | Buat `vayu-refresh.yml` (hot-spot refresh, tiap 30–60 min) | ☐ Todo | `.github/workflows/vayu-refresh.yml` |
| 7.7 | Implement: budget gate (skip jika >80% monthly limit) | ☐ Todo | Bagian dari vayu-refresh.yml |
| 7.8 | Buat `vayu-ping.yml` (Supabase keep-alive, tiap 6 hari) | ☐ Todo | `.github/workflows/vayu-ping.yml` |
| 7.9 | Buat `vayu-purge.yml` (data retention, weekly) | ☐ Todo | `.github/workflows/vayu-purge.yml` |
| 7.10 | Buat `vayu-osm-update.yml` (OSM refresh, monthly) | ☐ Todo | `.github/workflows/vayu-osm-update.yml` |

---

## STAGE 8: Testing & Validation (Pre-Launch)

| # | Task | Status | Detail |
|---|---|---|---|
| 8.1 | Test `/api/vayu/aqi` — single point query | ☐ Todo | lat=-8.6500&lon=115.2167 (Denpasar) |
| 8.2 | Test `/api/vayu/aqi` — response time < 300ms | ☐ Todo | 📎 ERD 12.1 |
| 8.3 | Test cache hit: query same tile 2× → second < 100ms | ☐ Todo | Redis cache working |
| 8.4 | Test cache miss → lazy compute → UPSERT → verify in DB | ☐ Todo | |
| 8.5 | Test `/api/vayu/route-score` — returns ranked routes | ☐ Todo | |
| 8.6 | Test `/api/vayu/exposure` — CE formula dimensional check | ☐ Todo | Output unit = μg |
| 8.7 | Test `/api/vayu/contribute` — anonymous contribution flow | ☐ Todo | |
| 8.8 | Test circuit breaker: simulate Open-Meteo down | ☐ Todo | Should serve stale data |
| 8.9 | Test Vercel timeout: single tile < 10s (Hobby plan limit) | ☐ Todo | |
| 8.10 | Test cultural calendar: Nyepi → traffic modifier ~0 | ☐ Todo | |
| 8.11 | Test Mode A/B reconciliation: B result not overwritten by A | ☐ Todo | |
| 8.12 | Run Python unit tests: `pytest vayu/tests/ -v` | ☐ Todo | |
| 8.13 | Test GitHub Actions: trigger vayu-refresh manually | ☐ Todo | Actions → Run workflow |
| 8.14 | Test GitHub Actions budget gate: verify skip logic | ☐ Todo | |
| 8.15 | Test Supabase ping workflow | ☐ Todo | |
| 8.16 | Test purge workflow: verify old data deleted | ☐ Todo | |
| 8.17 | Validate Open-Meteo response format (current API version) | ☐ Todo | |
| 8.18 | Spot-check AQI output: Denpasar, Jakarta, Makassar vs known station data | ☐ Todo | Sanity check multi-region |

---

## STAGE 9: Deploy & Go-Live

| # | Task | Status | Detail |
|---|---|---|---|
| 9.1 | Git commit semua VAYU code ke branch `develop` | ☐ Todo | |
| 9.2 | Git push → Vercel auto-deploy | ☐ Todo | |
| 9.3 | Verify VAYU endpoints live di breeva.site | ☐ Todo | |
| 9.4 | Verify Vercel env vars benar di Production | ☐ Todo | |
| 9.5 | Enable GitHub Actions workflow schedules | ☐ Todo | Setelah push `.github/workflows/` |
| 9.6 | Monitor first 24 jam: check error logs | ☐ Todo | Vercel Functions → Logs |
| 9.7 | Monitor GitHub Actions: first few runs sukses | ☐ Todo | |
| 9.8 | Monitor Supabase: DB size masih dalam limit | ☐ Todo | Target: <200MB dari 500MB |
| 9.9 | Monitor Upstash Redis: request count dalam limit | ☐ Todo | Target: <10K/hari |

---

## FUTURE STAGES (Post-MVP)

### Stage 10: Phase 0.5 — Calibration (🟡 Bulan 1–3)

> ⚠️ **OpenAQ diganti WAQI**: OpenAQ v3 server-side bug (Maret 2026), tidak bisa login/register.
> WAQI (aqicn.org) menyediakan data yang **sama atau lebih baik** untuk Indonesia — lihat catatan di bawah tabel.

| # | Task | Status | Detail |
|---|---|---|---|
| 10.1 | Integrate TomTom Traffic API (sampling calibration) | ☐ Todo | `vayu/calibration/tomtom_sampler.py` |
| 10.2 | Implement reverse NO₂ calibration dari **WAQI** (bukan OpenAQ) | ☐ Todo | `vayu/calibration/no2_reverse.py` — endpoint: `api.waqi.info` |
| 10.3 | Generate synthetic ML training data | ☐ Todo | CALINE3 vs OpenAQ residuals |
| 10.4 | Implement on-device map-matching SDK | ☐ Todo | Protomaps/PMTiles (~18MB/provinsi) |
| 10.5 | Buat `vayu/calibration/waqi_validator.py` | ☐ Todo | Ground-truth comparison (pengganti OpenAQ) |

### Stage 11: Phase 1 — Intelligence Layer (🟢 Bulan 3–6)

| # | Task | Status | Detail |
|---|---|---|---|
| 11.1 | Train XGBoost ML correction model | ☐ Todo | `vayu/ml/train_xgboost.py` |
| 11.2 | Implement ML inference layer | ☐ Todo | `vayu/ml/inference.py` |
| 11.3 | Integrate Copernicus CDSE NDVI (replace OSM proxy) | ☐ Todo | |
| 11.4 | Implement Ghost Path detection algorithm | ☐ Todo | 📎 ERD 6.3 |
| 11.5 | Build crowdsource data pipeline | ☐ Todo | |
| 11.6 | Implement cumulative exposure calculator di frontend | ☐ Todo | |

### Stage 12: Phase 2 — Self-Improving (🟢 Bulan 6–12)

| # | Task | Status | Detail |
|---|---|---|---|
| 12.1 | Implement LSTM temporal pattern model | ☐ Todo | |
| 12.2 | Build feedback loop dari user route choices | ☐ Todo | 📎 ERD 6.4 |
| 12.3 | Upgrade grid resolution: 25m → 10m (dense areas) | ☐ Todo | |
| 12.4 | Launch Verified Local Contributor system | ☐ Todo | 📎 ERD 10.2 Tier 3 |
| 12.5 | Build monthly model retraining pipeline | ☐ Todo | |

### Stage 13: Phase 3 — Regional Expansion (Sisa Indonesia)

| # | Task | Status | Detail |
|---|---|---|---|
| 13.1 | Expand coverage: Sumatera (Medan, Palembang, Padang) | ☐ Todo | |
| 13.2 | Expand coverage: Kalimantan (Balikpapan, Banjarmasin, Pontianak) | ☐ Todo | |
| 13.3 | Expand coverage: NTB + NTT (Lombok, Kupang) | ☐ Todo | |
| 13.4 | Expand coverage: Papua (Jayapura) | ☐ Todo | |
| 13.5 | Expand coverage: Semua kota kabupaten Indonesia | ☐ Todo | Full national |
| 13.6 | Multi-language API documentation | ☐ Todo | Persiapan ekspansi global |

---

## Summary Counter

| Stage | Total Items | Status |
|---|---|---|
| **Stage 0** — Akun & API Key | 14 | 11 done, 1 verify, 1 blocked, 1 todo |
| **Stage 1** — Environment Setup | 17 | 16 done, 1 later |
| **Stage 2** — Database | 14 | ✅ **14 done** |
| **Stage 3** — OSM Data | 23 | ✅ **23 done** (642,528 segments, 14 regions) |
| **Stage 4** — Mode A (API) | 48 | ✅ **47 done, 1 deferred** (4.37 → Stage 5) |
| **Stage 5** — Frontend | 8 | 8 todo |
| **Stage 6** — Mode B (Python) | 12 | 12 todo |
| **Stage 7** — GitHub Actions | 10 | 10 todo |
| **Stage 8** — Testing | 18 | 18 todo |
| **Stage 9** — Deploy | 9 | 9 todo |
| **Stages 10–13** — Post-MVP | 17 | 17 todo |
| **TOTAL** | **190** | **111 done, 1 blocked, 1 deferred, 77 todo** |

> **Critical Path (MVP):** Stage 0 → 1 → 2 → 3 → 4A+4B → 4C → 4G → 5 → 8 → 9
> Stages 4D–4F, 6, 7 bisa paralel setelah 4A+4B selesai.

---

*Checklist ini berdasarkan VAYU Engine ERD v2.2.0*
*Dibuat: Maret 2026*
