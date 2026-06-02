"""Generate the "Breeva Cloud Health" dashboard data (panels.json) from the LIVE ADX free cluster
+ App Insights probe health. az-cli auth, $0. Writes vayu/azure/dashboard/panels.json which the
static SWA dashboard consumes. Re-run (or wire to a GitHub Action) to refresh.

    vayu/.venv/Scripts/python.exe vayu/azure/build_dashboard_data.py
"""
from __future__ import annotations
import datetime
import json
import os
import subprocess
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

AZ_WBIN = r"C:\Program Files\Microsoft SDKs\Azure\CLI2\wbin"
os.environ["PATH"] = os.environ.get("PATH", "") + os.pathsep + AZ_WBIN
AZ = os.path.join(AZ_WBIN, "az.cmd")

from azure.kusto.data import KustoConnectionStringBuilder, KustoClient

CLUSTER = "https://kvc-c00cjha46ak8x8mp05.australiaeast.kusto.windows.net"
DB = "breeva_db"
OUT = Path(__file__).resolve().parent / "dashboard" / "panels.json"

# Supabase pooler — only for the tiny labeled-validation coverage fact (a cheap aggregate, no spatial op).
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[2] / ".env.local")
    POOLER = os.environ.get("SUPABASE_POOLER_URL")
except Exception:
    POOLER = None

ANOMALY_KQL = """
let cells = road_aqi | where region=='jakarta'
  | extend cell=strcat(bin(lat,0.01),'_',bin(lon,0.01))
  | summarize cavg=avg(no2_delta), csd=stdev(no2_delta), n=count() by cell;
road_aqi | where region=='jakarta'
| extend cell=strcat(bin(lat,0.01),'_',bin(lon,0.01))
| join kind=inner (cells | where n>=8) on cell
| extend z=(no2_delta-cavg)/(csd+1.0)
| where z>3 and no2_delta>50
| top 12 by z desc
| project name=coalesce(highway,'road'), no2_traffic=round(no2_delta,1), nbhd_avg=round(cavg,1), z=round(z,1), lat, lon
"""

# Monitoring-desert fairness: distance from each ~1km road-grid cell to the nearest REAL sensor
# (geo_distance_2points), banded, with the model's own confidence label per band. The equity signal —
# WHERE we can validate the model (near sensors) vs where it runs unchecked (deserts).
FAIRNESS_KQL = """
let stations = stations | where isnotnull(lat) and isnotnull(lon) | project slat=lat, slon=lon;
let grid = road_aqi | where isnotnull(lat) and isnotnull(lon)
  | summarize roads=count(), high=countif(confidence=='high'), medium=countif(confidence=='medium'),
      refuse=countif(confidence=='refuse') by glat=round(lat,2), glon=round(lon,2), region;
let banded = grid | extend k=1 | join kind=inner (stations | extend k=1) on k
  | extend d_km = geo_distance_2points(glon, glat, slon, slat)/1000.0
  | summarize nearest_km=min(d_km), roads=take_any(roads), high=take_any(high),
      medium=take_any(medium), refuse=take_any(refuse), region=take_any(region) by glat, glon;
banded
| extend band = case(nearest_km<=2.0,'monitored', nearest_km<=5.0,'intermediate','desert')
| summarize roads=sum(roads), high=sum(high), medium=sum(medium), refuse=sum(refuse), cells=count()
    by band, region
"""

client = KustoClient(KustoConnectionStringBuilder.with_az_cli_authentication(CLUSTER))


def rows(q: str) -> list[dict]:
    r = client.execute(DB, q).primary_results[0]
    cols = [c.column_name for c in r.columns]
    return [dict(zip(cols, list(row))) for row in r]


def probe_health() -> dict:
    """Valhalla cloud-probe health from workspace-based App Insights.

    breeva-insights is workspace-based, so the probe traces land in the breeva-logs
    Log-Analytics workspace -> AppTraces (query by customerId). SeverityLevel from the
    probe: 1=healthy, 2=degraded, 3=unreachable.
    GOTCHA: `last` is a RESERVED KQL keyword -> the alias must be `last_seen` (an alias
    of `last` raises SYN0002 "could not be parsed", which the bare subprocess swallowed
    as empty stdout -> the original "Expecting value" JSON error).
    """
    try:
        cid = subprocess.run([AZ, "monitor", "log-analytics", "workspace", "show", "-g", "breeva-rg",
                              "-n", "breeva-logs", "--query", "customerId", "-o", "tsv"],
                             capture_output=True, text=True, timeout=60).stdout.strip()
        if not cid:
            return {"error": "no customerId"}
        q = ("AppTraces | where TimeGenerated > ago(6h) | where Message startswith 'valhalla_probe' "
             "| summarize total=count(), healthy=countif(SeverityLevel==1), "
             "degraded=countif(SeverityLevel==2), down=countif(SeverityLevel>=3), last_seen=max(TimeGenerated)")
        p = subprocess.run([AZ, "monitor", "log-analytics", "query", "-w", cid,
                            "--analytics-query", q, "-o", "json"],
                           capture_output=True, text=True, timeout=90)
        out = (p.stdout or "").strip()
        if not out:
            return {"error": (p.stderr or "empty az output").strip()[:160]}
        arr = json.loads(out)
        rec = arr[0] if arr else {}
        return {"total": int(rec.get("total", 0) or 0), "healthy": int(rec.get("healthy", 0) or 0),
                "degraded": int(rec.get("degraded", 0) or 0), "down": int(rec.get("down", 0) or 0),
                "last": str(rec.get("last_seen", "") or "")}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:160]}


def fairness() -> dict:
    """Monitoring-desert equity (environmental justice). REAL data only: how much of the road
    network is within reach of a real sensor, the model's OWN confidence by coverage band, and how
    little of the network is independently validated by ground truth at all."""
    rws = rows(FAIRNESS_KQL)
    bands: dict = {}
    regions: dict = {}
    for r in rws:
        b = r["band"]
        reg = r.get("region") or "?"
        bd = bands.setdefault(b, {"roads": 0, "high": 0, "medium": 0, "refuse": 0, "cells": 0})
        for k in ("roads", "high", "medium", "refuse", "cells"):
            bd[k] += int(r.get(k) or 0)
        rg = regions.setdefault(reg, {"roads": 0, "desert": 0})
        rg["roads"] += int(r["roads"] or 0)
        if b == "desert":
            rg["desert"] += int(r["roads"] or 0)
    total = sum(b["roads"] for b in bands.values()) or 1
    band_list = []
    for name in ("monitored", "intermediate", "desert"):
        b = bands.get(name)
        if not b:
            continue
        rd = b["roads"] or 1
        band_list.append({"band": name, "roads": b["roads"], "pct": round(100.0 * b["roads"] / total, 1),
                          "high_pct": round(100.0 * b["high"] / rd, 1),
                          "refuse_pct": round(100.0 * b["refuse"] / rd, 1)})
    region_list = sorted(
        ({"region": k, "roads": v["roads"], "desert_pct": round(100.0 * v["desert"] / (v["roads"] or 1), 1)}
         for k, v in regions.items() if v["roads"] >= 1000),
        key=lambda x: x["desert_pct"], reverse=True)
    meta: dict = {"stations": rows("stations | count")[0]["Count"]}
    if POOLER:
        try:
            import psycopg2
            cn = psycopg2.connect(POOLER, connect_timeout=20)
            cur = cn.cursor()
            cur.execute("SELECT count(*), count(distinct osm_way_id), round(max(ground_truth_distance_km)::numeric,2) "
                        "FROM prediction_logs WHERE ground_truth_pm25 IS NOT NULL")
            n, roads_v, maxkm = cur.fetchone()
            cn.close()
            meta.update({"labeled": int(n), "roads_validated": int(roads_v), "labeled_max_km": float(maxkm or 0)})
        except Exception as e:  # noqa: BLE001
            meta["labeled_error"] = str(e)[:120]
    return {"bands": band_list, "regions": region_list, "meta": meta}


def pipeline() -> dict:
    """Live ingestion-SLA / freshness (ingest-watch): is data still flowing and are the pg_cron
    jobs healthy? REAL + live ($0). Surfaces stale stages (e.g. ground-truth labeling) and silent
    cron failures — the kind of gap that otherwise reads as 'fine' until a demo breaks."""
    if not POOLER:
        return {"error": "no SUPABASE_POOLER_URL"}
    try:
        import psycopg2
        cn = psycopg2.connect(POOLER, connect_timeout=20)
        cur = cn.cursor()
        cur.execute(
            "SELECT (SELECT count(*) FROM station_snapshots WHERE measured_at>now()-interval '24 hours'),"
            " (SELECT round((extract(epoch FROM now()-max(measured_at))/60)::numeric,0) FROM station_snapshots),"
            " (SELECT count(distinct station_uid) FROM station_snapshots WHERE measured_at>now()-interval '24 hours'),"
            " (SELECT round((extract(epoch FROM now()-max(computed_at))/3600)::numeric,1) FROM road_aqi_precomputed),"
            " (SELECT round((extract(epoch FROM now()-max(predicted_at))/86400)::numeric,1)"
            "    FROM prediction_logs WHERE ground_truth_pm25 IS NOT NULL)")
        stn_24h, stn_age_min, stn_active, road_age_h, label_age_d = cur.fetchone()
        cur.execute(
            "SELECT j.jobname, count(*) FILTER (WHERE d.status='succeeded'),"
            " count(*) FILTER (WHERE d.status!='succeeded'),"
            " round((extract(epoch FROM now()-max(d.start_time))/60)::numeric,0)"
            " FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid"
            " WHERE d.start_time>now()-interval '24 hours'"
            " GROUP BY j.jobname ORDER BY count(*) FILTER (WHERE d.status!='succeeded') DESC, 4 ASC")
        jobs = [{"job": r[0], "ok": int(r[1]), "bad": int(r[2]), "last_min": int(r[3] or 0)} for r in cur.fetchall()]
        cn.close()
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)[:160]}
    fnum = lambda v: float(v) if v is not None else 1e9  # noqa: E731
    stages = [
        {"name": "Station ingestion", "age_min": fnum(stn_age_min), "sla_min": 120,
         "age_str": f"{int(fnum(stn_age_min))} min ago", "detail": f"{int(stn_24h or 0):,} obs/24h · {int(stn_active or 0)} sensors live"},
        {"name": "Road-AQI precompute", "age_min": fnum(road_age_h) * 60, "sla_min": 390,
         "age_str": f"{fnum(road_age_h):.1f} h ago", "detail": "1.39M roads refreshed (~6h cycle)"},
        {"name": "Ground-truth labeling", "age_min": fnum(label_age_d) * 1440, "sla_min": 2880,
         "age_str": f"{fnum(label_age_d):.1f} d ago", "detail": "last validation batch (labeling paused)"},
    ]
    for s in stages:
        s["fresh"] = s["age_min"] <= s["sla_min"]
    return {"stages": stages, "jobs_total": len(jobs),
            "jobs_ok_24h": sum(j["ok"] for j in jobs), "jobs_bad_24h": sum(j["bad"] for j in jobs),
            "failing": [j for j in jobs if j["bad"] > 0][:6]}


def main() -> None:
    panels: dict = {}
    panels["summary"] = {
        "roads": rows("road_aqi | count")[0]["Count"],
        "regions": rows("road_aqi | summarize n=dcount(region)")[0]["n"],
        "generated_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
    }
    panels["region_totals"] = rows(
        "road_aqi | summarize roads=count(), avg_no2_traffic=round(avg(no2_delta),1) by region | order by roads desc")
    panels["eda"] = rows(
        "road_aqi | summarize roads=count(), avg_no2_traffic=round(avg(no2_delta),1), "
        "avg_pm25_total=round(avg(pm25),1) by highway | where roads>500 | order by avg_no2_traffic desc")
    panels["hotspots"] = rows(ANOMALY_KQL)
    panels["heatmap"] = rows(
        "road_aqi | where region=='jakarta' | summarize no2=round(avg(no2_delta),1), n=count() "
        "by lat=round(bin(lat,0.004),3), lon=round(bin(lon,0.004),3) | where n>=2 | project lat, lon, no2")
    panels["probe"] = probe_health()
    panels["fairness"] = fairness()
    panels["pipeline"] = pipeline()
    panels["stations"] = rows("stations | where isnotnull(lat) and isnotnull(lon) | project lat, lon, region")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(panels, default=str), encoding="utf-8")
    print(f"wrote {OUT}")
    fb = panels["fairness"]["bands"]
    print(f"  roads={panels['summary']['roads']:,} regions={panels['summary']['regions']} "
          f"eda={len(panels['eda'])} hotspots={len(panels['hotspots'])} heatmap={len(panels['heatmap'])} "
          f"probe={panels['probe']}")
    print(f"  fairness bands: " + " | ".join(f"{b['band']}={b['pct']}%(refuse {b['refuse_pct']}%)" for b in fb)
          + f"  meta={panels['fairness']['meta']}")
    pp = panels["pipeline"]
    print(f"  pipeline: " + (pp.get("error") or
          " | ".join(f"{s['name']}={'OK' if s['fresh'] else 'STALE'}({s['age_str']})" for s in pp.get("stages", []))
          + f"  cron {pp.get('jobs_total')}jobs ok={pp.get('jobs_ok_24h')} bad={pp.get('jobs_bad_24h')}"))


if __name__ == "__main__":
    main()
