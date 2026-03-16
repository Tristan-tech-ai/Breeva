# Breeva

Breeva is a location-aware web application focused on clean-air navigation, eco walking rewards, merchant redemption, and air quality intelligence. The repository combines a React + Vite frontend, Vercel serverless APIs, Supabase as the application backend, and a Python workspace called VAYU for advanced environmental modeling and calibration.

This README is intended to be the engineering entry point for the whole workspace.

## What This Repository Contains

Breeva is not a single SPA with a thin backend. It is a multi-part system:

- A React client that handles map interaction, search, routing UI, profile features, rewards, and account flows.
- A Vercel serverless layer that exposes Breeva-specific APIs for AQI, route scoring, crowd contributions, emails, merchant verification, search proxying, and walk completion.
- A Supabase backend for auth, relational data, storage, RPCs, and row-level security.
- A Python workspace named VAYU for road ingestion, calibration, model retraining, satellite enrichment, and offline data processing.

## Core Product Capabilities

- Clean-route navigation with route differentiation and pollution-aware scoring.
- Road-level AQI visualization over the map.
- Point AQI and exposure estimation for a user location or path.
- Search across geocoded places, Google Maps search results via proxy, and POIs.
- EcoPoints, quests, achievements, and weekly leaderboard.
- Merchant discovery, merchant onboarding, reward redemption, and merchant-side verification.
- Crowdsourced air-quality contribution flows feeding the VAYU ecosystem.

## High-Level Architecture

### Client

- React 19 + TypeScript.
- Vite with Rolldown-based build.
- Zustand for app state.
- React Router for navigation.
- Leaflet and React Leaflet for map rendering.
- Framer Motion for transitions and interaction polish.

### Application Backend

- Vercel serverless functions under `api/`.
- Supabase JS in the browser for auth and many CRUD operations.
- Direct HTTP calls from serverless functions to Supabase REST and RPC endpoints when service-role access is required.

### Environmental Intelligence Layer

- VAYU serverless endpoints provide point AQI, road AQI, route scoring, and exposure estimation.
- VAYU Python workspace ingests OSM road data, calibrates traffic heuristics, validates against third-party AQI providers, and runs analytical or ML jobs.

### Data Layer

- Supabase Postgres stores users, walks, rewards, merchants, reports, quests, achievements, transactions, weekly leaderboard rows, and VAYU tables.
- Upstash Redis is used for caching, quota tracking, and rate limiting in serverless APIs.

## Technology Stack

### Frontend

- React
- TypeScript
- Vite
- Zustand
- React Router
- Leaflet
- React Leaflet
- Framer Motion
- Recharts

### Backend and Hosting

- Vercel
- Supabase
- Upstash Redis

### Environmental and Mapping Services

- OpenRouteService for directions and geocoding
- Open-Meteo for baseline air quality and weather
- WAQI for station data and calibration bias
- IQAir for optional cross-validation
- Copernicus CDSE for optional satellite NO2 and NDVI enrichment
- Overpass API for OSM-derived environmental and road context
- Geoapify for POI discovery
- SearchAPI.io as a Google Maps results proxy
- Google Gemini for route reasoning, road classification, and corrective intelligence
- Resend for transactional emails

### Python Workspace

- Requests and HTTPX based data jobs
- Spatial processing for OSM and environmental calibration
- Test suite under `vayu/tests`

## Repository Structure

```text
breeva/
├── api/                       Vercel serverless functions
│   ├── auth/                  Auth callbacks and email sending
│   ├── merchants/             Merchant verification endpoints
│   ├── searchapi/             Google Maps proxy through SearchAPI.io
│   ├── vayu/                  AQI, route scoring, exposure, AI classification
│   └── walks/                 Walk completion and reward awarding
├── public/                    Static assets including service worker
├── src/                       React application
│   ├── components/            UI, auth, map, layout, feature components
│   ├── hooks/                 Custom hooks
│   ├── lib/                   Frontend service clients and helpers
│   ├── pages/                 Route-level screens
│   ├── stores/                Zustand stores
│   └── types/                 Shared frontend types
├── supabase/                  Schema, migrations, and seed system
│   ├── seed/                  TypeScript seed runner and factories
│   └── *.sql                  Base schema and VAYU migrations
├── vayu/                      Python workspace for environmental intelligence
│   ├── calibration/           WAQI, TomTom, NDVI, and related calibration jobs
│   ├── core/                  Shared Python modeling utilities
│   ├── jobs/                  OSM processing and batch entry points
│   ├── ml/                    Feedback loops, retraining, ghost paths, upgrades
│   └── tests/                 Python tests
└── eve/                       Internal architecture and investigation documents
```

## Frontend Application Overview

The frontend route map is defined in `src/App.tsx` and lazily loads most pages outside the login and home critical path.

Main screens include:

- Landing page and login flow
- Auth callback and onboarding
- Home map experience
- Profile, walk history, settings, achievements, transactions
- Rewards and merchant flows
- Saved places
- Eco impact and year in review
- Contribute and contribution history
- Quests and leaderboard
- About, help, terms, privacy

The main orchestration for map UX lives in `src/stores/mapStore.ts`. It handles:

- Geolocation and location watching
- Search aggregation across SearchAPI and ORS geocoding
- Destination selection and reverse geocoding
- Clean-route calculation and fallback routing
- AQI fetching and route selection state

## Backend API Overview

### Auth APIs

- `api/auth/callback.ts`
  Redirect bridge for OAuth callback flow.

- `api/auth/email.ts`
  Sends verification, password reset, and welcome emails through Resend.

### Merchant APIs

- `api/merchants/verify.ts`
  Merchant-side reward verification with Supabase service-role access.

### Walk APIs

- `api/walks/complete.ts`
  Completes a walk, awards points, updates achievements, and returns resulting state.

### Search API

- `api/searchapi/index.ts`
  Proxies approved SearchAPI.io engines to keep the key out of the client.

### VAYU APIs

- `api/vayu/aqi.ts`
  Point AQI endpoint with Redis caching and road-aware dispersion fallback logic.

- `api/vayu/grid-aqi.ts`
  Grid-level AQI computation and caching.

- `api/vayu/road-aqi.ts`
  Returns pollution data for road segments in a bounding box for map overlays.

- `api/vayu/route-score.ts`
  Clean-route orchestration, road matching, AQI scoring, and route ranking.

- `api/vayu/exposure.ts`
  Computes cumulative PM2.5 exposure along a route.

- `api/vayu/contribute.ts`
  Stores crowdsource contributions with Redis-backed rate limiting.

- `api/vayu/gemini-classify.ts`
  Batch road micro-classification, temporal correction, and error-analysis endpoint used by cron jobs.

## Request and Data Flow

### User-Facing Route Flow

1. The map store collects origin, destination, and transport mode.
2. The frontend prefers Breeva clean-route via `/api/vayu/route-score`.
3. The serverless function fetches ORS candidates, road context from Supabase RPCs, baseline AQI from Open-Meteo, and optional satellite or WAQI corrections.
4. The response returns distinct routes labeled as cleanest, balanced, and fastest where possible.
5. The client renders the route, supporting scores, and map overlays.

### Road AQI Overlay Flow

1. The map requests `/api/vayu/road-aqi` with bbox bounds.
2. The serverless function queries road segments from Supabase.
3. AQI is estimated per road using dispersion logic, calibration factors, and optional external validation.
4. The result is cached in Redis and rendered by the frontend overlay layer.

### Walk Completion Flow

1. The client posts a completed walk to `/api/walks/complete`.
2. The endpoint authenticates the caller against Supabase.
3. Supabase RPCs update walk records, points, and achievements.
4. The updated user stats are returned to the client.

## Supabase Data Model

The base schema lives in `supabase/schema.sql`.

Primary application tables include:

- `users`
- `walks`
- `merchants`
- `rewards`
- `redeemed_rewards`
- `air_quality_reports`
- `quests`
- `user_quests`
- `achievements`
- `user_achievements`
- `points_transactions`
- `leaderboard_weekly`

The schema also defines:

- indexes for core access patterns
- RLS policies for client-safe reads and writes
- utility RPCs such as EcoPoints handling and walk completion

VAYU-specific migrations extend the database for road segments, routing RPCs, graph topology, and scoring support.

## Seeding and Demo Data

The repo includes a TypeScript seed system under `supabase/seed`.

Seed coverage includes:

- auth users and user profiles
- merchants and rewards
- walks and reports
- redemptions and points transactions
- settings and saved places
- achievements and quest data
- weekly leaderboard rows

Available scripts:

```bash
pnpm seed
pnpm seed:fresh
pnpm seed:users
pnpm seed:merchants
pnpm seed:walks
```

The seed runner uses service-role credentials and can rebuild demo datasets for local or staging environments.

## VAYU Python Workspace

The `vayu/` directory is the offline and analytical side of Breeva's air-quality system.

Main areas:

- `jobs/`
  OSM ingestion and batch entry points.

- `calibration/`
  Traffic and air-quality calibration against TomTom, WAQI, and satellite-derived vegetation.

- `ml/`
  Feedback loops, retraining, ghost path inference, contributor systems, and grid upgrades.

- `core/`
  Shared traffic, dispersion, and utility logic.

- `tests/`
  Python validation layer.

Typical Python setup:

```powershell
cd vayu
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## External Services Used by This Workspace

### Required or Commonly Used

- Supabase
- Vercel
- OpenRouteService
- Open-Meteo
- Upstash Redis
- SearchAPI.io
- Geoapify
- Resend

### Optional or Feature-Dependent

- Google Gemini
- WAQI
- IQAir
- Copernicus CDSE
- TomTom

Not every feature requires every provider. Many advanced environmental enhancements degrade gracefully when optional credentials are absent.

## Environment Variables

The canonical example lives in `.env.example`.

### Frontend-Exposed Variables

These are embedded into the client build through Vite and must use the `VITE_` prefix.

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_GOOGLE_CLIENT_ID`
- `VITE_OPENROUTESERVICE_API_KEY`
- `VITE_GEMINI_API_KEY`
- `VITE_GEOAPIFY_API_KEY`

### Server-Side Variables

- `SUPABASE_SERVICE_ROLE_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `WAQI_TOKEN`
- `IQAIR_API_KEY`
- `CDSE_CLIENT_ID`
- `CDSE_CLIENT_SECRET`
- `TOMTOM_API_KEY`
- `SEARCHAPI_KEY`
- `RESEND_API_KEY`
- `CRON_SECRET` where applicable for protected scheduled execution

### Notes

- `VITE_GEOAPIFY_API_KEY` is now expected from env rather than being hardcoded.
- Some code paths support both `SUPABASE_URL` and `VITE_SUPABASE_URL`, but server-side code should prefer non-public server variables when available.
- Open-Meteo does not require an API key.

## Local Development

### Prerequisites

- Node.js 20 or newer recommended
- pnpm
- Python 3.11 or newer for the `vayu/` workspace
- Supabase project with schema applied

### Frontend and API Development

```bash
pnpm install
pnpm dev
```

### Build and Lint

```bash
pnpm build
pnpm lint
```

### Seed Demo Data

```bash
pnpm seed
```

For a reset:

```bash
pnpm seed:fresh
```

## Deployment

The project is configured for Vercel in `vercel.json`.

Important deployment characteristics:

- Static frontend output goes to `dist/`.
- Non-API routes rewrite to `index.html`.
- Asset files are served with immutable cache headers.
- Non-asset routes are served with no-cache headers.
- Scheduled jobs trigger selected VAYU endpoints for road AQI warm-up and Gemini classification workflows.

### Vercel Environment Setup

Set the same variables listed in `.env.example` in the Vercel project settings.

At minimum, production usually needs:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `VITE_OPENROUTESERVICE_API_KEY`
- `VITE_GEOAPIFY_API_KEY`
- `SEARCHAPI_KEY`
- `RESEND_API_KEY`
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

Environmental intelligence features improve when these are also configured:

- `WAQI_TOKEN`
- `GEMINI_API_KEY`
- `IQAIR_API_KEY`
- `CDSE_CLIENT_ID`
- `CDSE_CLIENT_SECRET`

## Operational Notes and Gotchas

### Lazy Chunk 404 After Deploy

The app uses lazy-loaded route chunks. A stale open tab can request an old chunk hash after a new deployment, leading to `Failed to fetch dynamically imported module`. The app includes a one-time auto-reload recovery path in `src/App.tsx`.

### Leaderboard Data Expectations

Leaderboard data is stored in `leaderboard_weekly`. The frontend falls back to the latest available seeded week if the current week has no rows.

### Service Worker Scope

The service worker in `public/sw.js` is lightweight and mainly supports notifications and a minimal offline shell. It is not a full asset precache strategy.

### Mixed Data Access Pattern

The project intentionally uses both:

- direct browser-side Supabase access for user-safe operations
- serverless functions with service-role access for protected, aggregated, or provider-integrated workflows

That split is part of the design, not accidental duplication.

## Suggested Reading Order for New Engineers

1. `src/App.tsx`
2. `src/stores/mapStore.ts`
3. `src/lib/api.ts`
4. `src/lib/supabase.ts`
5. `api/vayu/aqi.ts`
6. `api/vayu/road-aqi.ts`
7. `api/vayu/route-score.ts`
8. `supabase/schema.sql`
9. `supabase/seed/index.ts`
10. `vayu/README.md`

## Current README Scope

This document is focused on repository comprehension, onboarding, and system boundaries. For deeper investigation and design history, the `eve/` directory contains internal analytical documents such as technical architecture and implementation investigations.
