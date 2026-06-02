# Breeva FLAGSHIP — Azure Function (Consumption, $0) that CLOUD-OBSERVES the self-hosted local
# Valhalla engine through breeva.site's public API, and emits availability + latency + the
# actual-engine signal to Application Insights. A KQL/metric alert fires on down / slow / silent
# ORS-fallback. "Cloud-observing a self-hosted engine, correctly, for $0."
#
# stdlib-only (urllib) => no pip build => reliable zip deploy. App Insights capture is automatic:
# the Functions host forwards `logging` records (incl. custom_dimensions) when the app is linked to
# Application Insights (APPLICATIONINSIGHTS_CONNECTION_STRING set at create time).
import json
import logging
import time
import urllib.request

import azure.functions as func

app = func.FunctionApp()

PROBE_URL = "https://breeva.site/api/vayu/route-score"
# A fixed Jakarta pedestrian OD that exercises the Valhalla path + AQI scoring.
PROBE_BODY = json.dumps({
    "start": [-6.2440, 106.7990], "end": [-6.2490, 106.8030],
    "profile": "foot-walking", "valhalla_costing": "pedestrian", "alternatives": 3,
}).encode()
SLOW_MS = 6000  # >6s ~ the ORS-fallback timeout boundary in route-score.ts


@app.timer_trigger(schedule="0 */15 * * * *", arg_name="timer", run_on_startup=True)
def valhalla_probe(timer: func.TimerRequest) -> None:
    t0 = time.time()
    dims = {"probe": "valhalla_health"}
    try:
        req = urllib.request.Request(PROBE_URL, data=PROBE_BODY,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            http = r.status
            body = json.load(r)
        ms = int((time.time() - t0) * 1000)
        meta = body.get("meta", {}) or {}
        engine = meta.get("engine")
        err = meta.get("error")
        routes = len(body.get("routes", []) or [])
        # Healthy = HTTP 200, Valhalla actually served (not a silent ORS fallback), no error,
        # at least one route, and within the slow threshold.
        ok = (http == 200 and engine == "valhalla" and not err and routes >= 1 and ms <= SLOW_MS)
        dims.update({"ok": ok, "http": http, "engine": engine or "none", "latency_ms": ms,
                     "routes": routes, "fallback": engine == "ors", "slow": ms > SLOW_MS,
                     "err": err or ""})
        # Encode metrics in the MESSAGE (the only field Functions' AI integration reliably captures);
        # KQL parses the JSON. SeverityLevel also encodes health (info=ok, warning=degraded).
        (logging.info if ok else logging.warning)("valhalla_probe " + json.dumps(dims))
    except Exception as e:  # noqa: BLE001 — any failure (timeout, DNS, 5xx) = engine unreachable
        ms = int((time.time() - t0) * 1000)
        dims.update({"ok": False, "engine": "unreachable", "latency_ms": ms, "fallback": False,
                     "slow": ms > SLOW_MS, "err": str(e)[:300]})
        logging.error("valhalla_probe " + json.dumps(dims))
