# Cold-Start Protocol: Add a New City to Breeva

> Operator runbook untuk membawa kota baru (contoh: balikpapan, denpasar-extended, sleman, dll) ke pipeline GraphSAGE production-ready dalam ≤ 30 hari kalender.
>
> Referenced from: `eve/TIER_3_4_DATA_TRAINING_PLAYBOOK.md` §7.4

## Pre-flight

- [ ] Region name confirmed (lowercase snake-case, contoh: `balikpapan`, NOT `Balikpapan`)
- [ ] OSM bounding box known (south, west, north, east WGS84 decimal degrees)
- [ ] User has explicitly authorized expansion (datathon scope tetap 10 kota Tier 1 — new region butuh override)

## T-30: Day 0 — OSM ingest

```bash
python vayu/jobs/process_osm.py --region balikpapan
```

Verify:
```sql
SELECT region, COUNT(*) AS n_segments
FROM road_segments WHERE region = 'balikpapan';
-- Expect: 30,000 – 60,000 segments untuk mid-sized Indonesian city
```

If < 5000 segments → bbox terlalu kecil, expand and re-ingest.

## T-29: Day 1 — Build graph + GAE pretrain

```bash
# Add region to graph builder
# Edit scripts/build_gcn_graph_all_regions.mjs REGIONS array
# Add 'balikpapan'

node scripts/build_gcn_graph_all_regions.mjs
```

Verify (after run completes):
```sql
SELECT region, COUNT(*) FROM gcn_graph_nodes WHERE region = 'balikpapan';
-- Should match road_segments count from T-30
```

```bash
# Self-supervised GAE pretraining — no labels needed
python vayu/ml/pretrain_gae.py --region balikpapan --epochs 30
# → D:/breeva-ml-models/gae/gae_balikpapan_v*.pt
```

## T-28: Day 2 — Activate ground-truth ingestion

1. **Add region bbox to WAQI poller**:
   ```python
   # Edit vayu/jobs/snapshot_stations.py REGION_BBOXES dict
   'balikpapan': (-1.30, 116.75, -1.10, 116.95),  # (south, west, north, east)
   ```

2. **Boost prediction_log sampling rate for cold-start window**:
   ```sql
   -- Apply only to balikpapan: 1.0 = log every prediction
   INSERT INTO region_config_per_road (osm_way_id, prediction_log_sample_rate_override, set_at)
   SELECT n.osm_way_id, 1.0, NOW()
   FROM gcn_graph_nodes n
   WHERE n.region = 'balikpapan'
   ON CONFLICT (osm_way_id) DO UPDATE SET
     prediction_log_sample_rate_override = 1.0, set_at = NOW();
   ```

3. **Run Sentinel-5P backfill immediately** (skip 5-7 day wait):
   ```bash
   python vayu/jobs/attach_sentinel_ground_truth.py --radius-km 5 --window-hours 24
   ```

## T-25: Day 5 — First retrain attempt

```sql
SELECT region, COUNT(*) AS labels
FROM prediction_logs
WHERE ground_truth_pm25 IS NOT NULL AND region = 'balikpapan';
-- Target: ≥ 200 labels before first training
```

If labels < 200 after Day 5:
- Check WAQI poller job state (Get-ScheduledTask)
- Increase Sentinel radius: `attach_sentinel_ground_truth.py --radius-km 10`
- Investigate: does prediction_logs even have rows for balikpapan? (road-aqi.ts being hit?)

When ready:
```bash
python vayu/ml/train_gcn.py \
  --warm-start D:/breeva-ml-models/gae/gae_balikpapan_v*.pt \
  --epochs 40
```

Expected first-run MAE: **15-20 μg/m³** (poor — normal for sparse-label region).

## T-15: Day 15 — Continuous improvement check

```bash
python vayu/ml/validate_gcn.py --model-path D:/breeva-ml-models/gcn/best.pt
# Look at by_region.balikpapan
```

Target: MAE < 12 μg/m³ after 15 days. If still > 12:

1. **Active learning boost**: `python vayu/jobs/active_learning_sampler.py --top-pct 0.10 --boost-mult 3.0`
2. **Per-region training**: train balikpapan-only model, register in `ml_model_registry` with `region='balikpapan'`
3. **Investigate physics mismatch**: balikpapan is coastal (sea breeze) + oil refinery influence — may need per-region calibration multipliers in `caline3_region_params`

## T-0: Day 30 — Acceptance criteria

- [ ] Per-region MAE < 10 μg/m³ on val set
- [ ] PI95 coverage 0.90–0.97 (slightly relaxed vs 0.93–0.97 for mature regions)
- [ ] ≥ 500 labels accumulated total
- [ ] Drift monitor not raising alerts for region
- [ ] gcn_road_predictions cache hit > 80% for region's road_segments
- [ ] Reduce prediction_log sample rate back to baseline:
      `DELETE FROM region_config_per_road WHERE osm_way_id IN (SELECT osm_way_id FROM gcn_graph_nodes WHERE region = 'balikpapan');`

## Rollback

If region performs catastrophically (MAE > 25 sustained 7 days):

```sql
-- Disable GCN for this region; fall back to Tier 2 XGBoost only
UPDATE ml_model_registry
SET active = FALSE
WHERE model_name = 'gcn_road' AND region = 'balikpapan';

-- road-aqi.ts will naturally degrade to no-gcn for these osm_way_id
-- since fetchGcnDeltasBatch returns empty for missing entries
```

Investigate root cause (often: spatial calibration off, traffic_base_estimate wrong for local road types, or missing TomTom coverage) before re-enabling.
