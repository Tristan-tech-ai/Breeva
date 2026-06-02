# Breeva

Breeva is a location-aware environmental intelligence platform. It brings together clean-air pedestrian navigation, per-road air quality mapping, cumulative exposure tracking, and a server-authoritative eco rewards economy in a single progressive web app.

The system is not a single SPA with a thin backend. It is a multi-part platform: a React and Vite client, a Vercel serverless API layer, a Supabase backend, a self-hosted routing engine with an air-quality cost overlay, a Python environmental-modeling workspace called VAYU, and a zero-cost cloud intelligence layer on Azure.

This document is the engineering entry point for the whole workspace.

## What This Repository Contains

- A React client that handles map interaction, search, routing UI, exposure tracking, profile features, the rewards economy, and account flows.
- A Vercel serverless layer that exposes Breeva APIs for point and road AQI, route scoring, exposure, crowd contributions, emails, merchant verification, search proxying, and walk completion.
- A Supabase backend for auth, relational data, storage, RPCs, scheduled jobs, realtime, and row-level security.
- A self-hosted Valhalla routing fork with a per-edge air-quality cost, reached over a secure tunnel, with OpenRouteService as an automatic fallback.
- A Python workspace named VAYU for road ingestion, dispersion modeling, calibration, model training, satellite enrichment, and offline data processing.
- A zero-cost Azure intelligence layer for spatiotemporal analytics, engine observability, model accountability, and a public health dashboard.

## Core Product Capabilities

- Clean-route navigation that ranks routes by real traffic-related air pollution exposure, not by a relabeled fastest path.
- Per-road air quality mapping at road-segment resolution, with an explicit confidence label on every road.
- Point AQI and cumulative exposure estimation for a location, a walk, or a planned route.
- Exposure tracking that reports how much avoidable traffic pollution a cleaner route saves.
- Search across geocoded places, Google Maps results through a server proxy, and points of interest.
- A real EcoPoints economy with adaptive quests, levels and experience, achievements, and multi-scope leaderboards.
- Merchant discovery, merchant onboarding, reward redemption, and merchant-side verification.
- Crowdsourced air-quality contribution flows that feed the VAYU pipeline.

## The Clean-Route Engine

Breeva treats clean routing as an exposure problem rather than a cosmetic relabeling of the fastest path.

### Traffic-related air pollution as the routing signal

Routes are scored, ranked, and displayed using the same quantity: traffic-related air pollution exposure, dominated by nitrogen dioxide. Nitrogen dioxide is used as the lead pollutant because it separates road classes strongly. A motorway carries far more traffic-source nitrogen dioxide than a quiet residential street, while ambient fine particulate matter tends to be spatially flat across a city. A model that ranked only on ambient particulate matter would find every candidate route nearly identical and could not tell a clean street from a busy one.

Breeva follows a single consistency principle: it routes by, ranks by, and shows the user the same exposure quantity. The route presented as cleanest is genuinely the lowest-exposure option, and the savings shown on the card are the savings the engine actually optimized for.

### Honest travel time

Only the routing cost is shifted toward cleaner edges. The reported duration is the real travel time, never inflated to make a clean route look more attractive. When a distinct cleaner option does not meaningfully exist, the engine collapses the choices instead of inventing a difference.

### Self-hosted routing with a fallback

The primary router is a self-hosted Valhalla fork with a per-edge air-quality cost overlay, reached over a Cloudflare tunnel. OpenRouteService remains as an automatic fallback. The route-score API reports the engine that actually served each response, so a silent fallback is never misreported as the primary engine. All travel modes are covered, including walking, cycling, driving, and motorcycle.

## The VAYU Air-Quality Engine

VAYU is the air-quality intelligence behind Breeva. It produces air quality at the sharpest practical resolution, the road segment, rather than coarse area grids.

The current engine combines several layers:

- A CALINE4 Gaussian line-source dispersion model. Each receptor sums contributions from the nearby road segments around it, not only its own line source, which removes a self-only under-prediction bias.
- A physical-prior background field for the regional baseline.
- A Gaussian-process residual correction and per-region calibration.
- A gradient-boosted residual model loaded at request time from a model registry.

Results are precomputed for roughly 1.4 million road segments and served from a cache, with live computation as a fallback for uncovered areas. Every road carries a confidence label, expressed as high, medium, or refuse, so the client can communicate certainty honestly instead of implying false precision. Feature flags control the active path, including the v2 engine, multi-source dispersion, and the precompute serving mode.

VAYU has two runtime modes. A TypeScript mode runs inside the Vercel serverless functions for real-time, user-facing requests. A Python mode in the `vayu/` workspace handles batch processing, model training, satellite ingestion, and calibration.

## The Zero-Cost Azure Intelligence Layer

Breeva runs a deliberately zero-cost cloud intelligence layer on Azure, assembled from always-free and scale-to-zero services rather than burnable credit. The thesis is that the free tier can be an architecture, not a coupon. Heavy and always-on compute stays local, and only the components that benefit from the cloud run there, each chosen to stay at zero ongoing cost.

The layer has five real components.

### Spatiotemporal analytics engine

An Azure Data Explorer free cluster holds the per-road air quality records and answers KQL geospatial and anomaly queries in seconds. It powers hotspot detection, regional exploration, and the fairness analysis below across the full road network at once.

### Engine observability

An Azure Function on the Consumption plan probes the self-hosted routing engine through the public API on a fixed schedule. It emits availability, latency, and the actually-serving engine to Application Insights, so a degradation, a slow response, or a silent fallback raises a signal. The probe also validates the route-score honesty fix end to end.

### Public health dashboard

A Static Web App named Breeva Cloud Health renders the live analytics, pipeline health, and model-accountability panels on a single public page.

### Responsible-AI fairness

A monitoring-desert equity analysis built entirely from real data. It measures where the model can be checked against ground truth versus where it runs unvalidated. Around 12 percent of roads sit within 2 km of a monitoring sensor, which is the only zone with ground truth, while more than half of the network lies in monitoring deserts beyond 5 km of any sensor. The model self-reports lower confidence in exactly those areas, and entire regions have effectively no usable coverage. This is an honest accountability and environmental-justice signal, computed with KQL geospatial functions and no synthetic data.

### Ingestion observability

A live ingestion-SLA and pipeline-freshness monitor reads station ingestion, the precompute cycle, labeling freshness, and pg_cron job health. It surfaces stale stages and silent job failures, applying the same down, slow, or silent-failure pattern as the routing probe to the data plane.

## Technology Stack

### Frontend

- React with TypeScript
- Vite with a Rolldown-based build
- Zustand for application state
- React Query for server state
- React Router for navigation
- Leaflet and React Leaflet for map rendering
- Leaflet VectorGrid for vector road tiles
- Framer Motion for transitions and interaction polish
- Recharts for charts
- A service worker and IndexedDB for progressive web app and offline support

### Backend and Hosting

- Vercel serverless functions
- Supabase Postgres with PostGIS, pgRouting, pg_cron, pg_net, and realtime
- Upstash Redis for caching, quota tracking, and rate limiting

### Routing and Environmental Services

- Self-hosted Valhalla fork with an air-quality cost overlay, primary router
- OpenRouteService for fallback directions and geocoding
- Open-Meteo for baseline air quality and weather
- WAQI and IQAir for station data and calibration
- Copernicus CDSE for optional satellite enrichment
- Overpass and OSM data for road and environmental context
- Geoapify for points of interest, behind a server proxy
- SearchAPI.io as a Google Maps results proxy
- Google Gemini for road classification and corrective intelligence
- Resend for transactional email

### Cloud Intelligence

- Azure Data Explorer free cluster for spatiotemporal analytics
- Azure Functions for the routing probe
- Azure Application Insights and Log Analytics for telemetry
- Azure Static Web Apps for the public health dashboard

### Python Workspace

- Dispersion modeling, calibration, and spatial processing
- Model training and validation for residual and graph models
- Azure ingestion and dashboard generation utilities
- A test suite under `vayu/tests`

## Repository Structure

```text
breeva/
  api/                       Vercel serverless functions
    auth/                    Auth callbacks and email sending
    merchants/               Merchant verification endpoints
    searchapi/               Google Maps and POI proxy
    vayu/                    AQI, route scoring, exposure, tiles, AI classification
    walks/                   Walk completion and reward awarding
  public/                    Static assets including the service worker
  src/                       React application
    components/              UI, auth, map, layout, and feature components
    hooks/                   Custom hooks
    lib/                     Frontend service clients and helpers
    pages/                   Route-level screens
    stores/                  Zustand stores
    types/                   Shared frontend types
  supabase/                  Schema, migrations, and the seed system
    seed/                    TypeScript seed runner and factories
  vayu/                      Python workspace for environmental intelligence
    calibration/             WAQI, TomTom, and satellite calibration jobs
    core/                    Shared modeling utilities
    jobs/                    OSM processing and batch entry points
    ml/                      Training, validation, drift, and retraining
    azure/                   Azure ingestion and dashboard generation
    tests/                   Python tests
  scripts/                   Operational scripts, including Azure provisioning and KQL
  eve/                       Internal architecture and investigation documents
```

## Frontend Application Overview

The route map is defined in `src/App.tsx` and lazily loads most pages outside the login and home critical path.

Main screens include the landing page and login flow, auth callback and onboarding, the home map experience, the exposure view, profile and walk history, settings, achievements, transactions, rewards and merchant flows, saved places, eco impact, year in review, contribution flows, quests, and the leaderboard, along with about, help, terms, and privacy pages.

The main orchestration for map experience lives in `src/stores/mapStore.ts`, which handles geolocation and location watching, search aggregation, destination selection and reverse geocoding, clean-route calculation with fallback, AQI fetching, and route selection state.

## Backend API Overview

### Auth

- `api/auth/callback.ts` bridges the OAuth callback flow.
- `api/auth/email.ts` sends verification, reset, and welcome emails through Resend.

### Merchants

- `api/merchants/verify.ts` performs merchant-side reward verification with service-role access.

### Walks

- `api/walks/complete.ts` completes a walk, awards points through guarded RPCs, updates achievements, and returns the resulting state.

### Search

- `api/searchapi/index.ts` proxies approved search engines and the Geoapify POI provider so their keys never reach the client.

### VAYU

- `api/vayu/aqi.ts` returns point AQI with Redis caching and the v2 engine path.
- `api/vayu/road-aqi.ts` returns road-segment air quality for map overlays and also serves raster and vector road tiles.
- `api/vayu/route-score.ts` orchestrates clean routing, road matching, exposure scoring, and route ranking, and reports the serving engine.
- `api/vayu/exposure.ts` computes cumulative exposure and avoidable traffic dose along a route.
- `api/vayu/grid-aqi.ts` provides grid-level AQI aggregation.
- `api/vayu/contribute.ts` stores crowdsourced contributions with rate limiting.
- `api/vayu/gemini-classify.ts` runs batch road classification and temporal correction used by scheduled jobs.

## Request and Data Flow

### Clean route

1. The map store collects origin, destination, and travel mode.
2. The client requests a Breeva clean route from the route-score API.
3. The serverless function requests candidates from the self-hosted Valhalla engine, falling back to OpenRouteService if needed, and pulls road context from Supabase RPCs.
4. Each candidate is scored on traffic-related exposure using per-road air quality, and routes are ranked as cleanest, balanced, and fastest where a meaningful difference exists.
5. The response includes the serving engine and the exposure savings, and the client renders the routes and overlays.

### Road AQI overlay

1. The map requests road AQI for the current bounds, or fetches road tiles directly.
2. The serverless function serves precomputed per-road values, with live dispersion as a fallback for uncovered areas.
3. Results are cached and rendered as colored roads on the map.

### Walk completion

1. The client posts a completed walk to the walk API.
2. The endpoint authenticates the caller against Supabase.
3. Server-side RPCs update walk records, points, achievements, and exposure.
4. Updated user stats return to the client.

## Supabase Data Model

The base schema lives in `supabase/schema.sql`, and VAYU and gamification migrations extend it.

Identity and activity tables cover users, settings, saved places, walks, and the exposure ledger.

The rewards economy covers merchants, rewards, redemptions, point transactions, quests, achievements, and their per-user progress tables, along with weekly and regional leaderboard tables.

The air-quality and machine-learning tables cover road segments, precomputed per-road AQI, prediction logs with attached ground truth, monitoring-station snapshots, graph model predictions, a model registry, drift alerts, and crowdsourced reports.

The schema also defines indexes for core access patterns, row-level security policies for client-safe reads and writes, PostGIS and pgRouting support for spatial routing, and utility RPCs for points handling and walk completion. Scheduled work runs through pg_cron and pg_net rather than platform cron.

## Gamification and the Rewards Economy

The rewards system is a real, server-authoritative economy rather than seeded placeholders. Points are granted only through server-side RPCs locked to the service role, and the client requests grants through guarded claim functions, so points cannot be minted from the browser.

The system includes adaptive quests, levels and experience, achievements, and leaderboards at multiple scopes. Alongside the global leaderboard, regional boards rank users by desa, kabupaten, provinsi, and national level, with region assignment derived from walk location.

## Seeding and Demo Data

The repository includes a TypeScript seed system under `supabase/seed`. It can rebuild demo datasets for local or staging environments, covering users and profiles, merchants and rewards, walks and reports, redemptions and transactions, settings and saved places, achievements and quests, and leaderboard rows.

Available scripts:

```bash
pnpm seed
pnpm seed:fresh
pnpm seed:users
pnpm seed:merchants
pnpm seed:walks
```

The seed runner uses service-role credentials.

## VAYU Python Workspace

The `vayu/` directory is the offline and analytical side of the air-quality system.

- `jobs/` handles OSM ingestion and batch entry points.
- `calibration/` calibrates traffic and air quality against external providers.
- `ml/` covers training, validation, drift monitoring, retraining, and graph models.
- `core/` holds shared dispersion and utility logic.
- `azure/` holds the Azure ingestion and dashboard generation utilities.
- `tests/` is the Python validation layer.

Typical Python setup:

```powershell
cd vayu
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Environment Variables

The canonical example lives in `.env.example`.

### Frontend-exposed variables

These are embedded into the client build through Vite and use the `VITE_` prefix.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_OPENROUTESERVICE_API_KEY`

### Server-side variables

- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_POOLER_URL` for direct Postgres access in batch jobs
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `SEARCHAPI_KEYS` as a rotating key pool
- `GEOAPIFY_API_KEY` injected by the search proxy
- `WAQI_TOKENS` as a rotating token pool
- `IQAIR_API_KEY`
- `GEMINI_API_KEY`
- `RESEND_API_KEY`
- `VALHALLA_BASE_URL` and `VALHALLA_AUTH_TOKEN` for the self-hosted router
- `USE_V2_ENGINE` and the related engine and air-quality cost flags
- `CDSE_CLIENT_ID` and `CDSE_CLIENT_SECRET` for optional satellite enrichment
- `TOMTOM_API_KEY` for optional traffic calibration
- A cron secret where protected scheduled execution applies

### Notes

- Geoapify POI discovery is server-side only. The key is injected by the search proxy and never bundled in the client.
- Engine flags such as `USE_V2_ENGINE` must be set in every environment scope that serves the site, because a flag read as unset silently downgrades the engine path.
- Open-Meteo does not require an API key.
- The Azure intelligence layer authenticates through the Azure CLI and a separate free analytics cluster, so it does not add secrets to the application.

## Local Development

### Prerequisites

- Node.js 20 or newer
- pnpm
- Python 3.11 or newer for the `vayu/` workspace
- A Supabase project with the schema applied

### Frontend and API

```bash
pnpm install
pnpm dev
```

### Build and lint

```bash
pnpm build
pnpm lint
```

### Seed demo data

```bash
pnpm seed
```

For a reset:

```bash
pnpm seed:fresh
```

## Deployment

The project is configured for Vercel in `vercel.json`. Static frontend output goes to `dist/`, non-API routes rewrite to `index.html`, asset files use immutable cache headers, and non-asset routes use no-cache headers.

Important deployment characteristics:

- The production domain is served through a manually managed alias to a Vercel deployment. After a build is ready, the alias is pointed at the new deployment.
- The route-score API reports the engine that actually served a response, so production can verify that the self-hosted router, not the fallback, is serving.
- Scheduled work runs through Supabase pg_cron and pg_net, which call selected endpoints on a schedule and record run history in the database.
- The self-hosted routing engine runs locally and is reached over a Cloudflare tunnel, with OpenRouteService as a fallback if it is unavailable.
- The Breeva Cloud Health dashboard deploys to Azure Static Web Apps and reads live data from the analytics cluster and telemetry.

### Vercel environment setup

Set the variables listed in `.env.example` in the Vercel project settings. Production needs the Supabase, Redis, search proxy, email, and routing variables at minimum. Environmental intelligence features improve when the optional provider credentials are also configured. Server-side variables must be scoped to the environment that actually serves the production domain, otherwise the functions read them as empty.

## Operational Notes

### Engine honesty

The route-score response carries the serving engine in its metadata. This makes a silent fallback to OpenRouteService visible to monitoring and to the demo, instead of being misreported as the self-hosted engine.

### Lazy chunk recovery

The app uses lazy-loaded route chunks. A stale tab can request an old chunk hash after a new deployment. The app includes a one-time auto-reload recovery path.

### Leaderboard expectations

Leaderboard data falls back to the latest available week when the current week has no rows, so demo data still renders.

### Mixed data access

The project intentionally uses both direct browser-side Supabase access for user-safe operations and serverless functions with service-role access for protected, aggregated, or provider-integrated workflows. That split is part of the design.

## Suggested Reading Order

1. `src/App.tsx`
2. `src/stores/mapStore.ts`
3. `src/lib/api.ts`
4. `src/lib/supabase.ts`
5. `api/vayu/route-score.ts`
6. `api/vayu/road-aqi.ts`
7. `api/vayu/aqi.ts`
8. `api/vayu/exposure.ts`
9. `supabase/schema.sql`
10. `vayu/README.md`

## Scope of This Document

This README focuses on repository comprehension, onboarding, and system boundaries. For deeper design history and investigations, the `eve/` directory holds internal analytical documents.
