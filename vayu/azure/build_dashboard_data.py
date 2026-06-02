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

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(panels, default=str), encoding="utf-8")
    print(f"wrote {OUT}")
    print(f"  roads={panels['summary']['roads']:,} regions={panels['summary']['regions']} "
          f"eda={len(panels['eda'])} hotspots={len(panels['hotspots'])} heatmap={len(panels['heatmap'])} "
          f"probe={panels['probe']}")


if __name__ == "__main__":
    main()
