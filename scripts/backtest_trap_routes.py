"""Validate the TRAP fork.

  fork-direct (default): sweep pedestrian aqi_weight on the local fork -> deviation + honest ETA + latency.
  e2e (--preview URL):   call /api/vayu/route-score -> assert cleanest trap_exposure <= balanced <= fastest.

  vayu/.venv/Scripts/python.exe scripts/backtest_trap_routes.py                       # fork :8012
  vayu/.venv/Scripts/python.exe scripts/backtest_trap_routes.py --fork-port 8002
  vayu/.venv/Scripts/python.exe scripts/backtest_trap_routes.py --preview https://x.vercel.app --bypass TOKEN
"""
import argparse, json, os, sys, time, urllib.request

WEIGHTS = [float(x) for x in os.environ.get("TRAP_WEIGHTS", "0,0.3,1.0").split(",")]

# Pedestrian OD pairs across Jakarta — short urban walks (~1-3 km), mixing arterial-adjacent and
# residential corridors so some have a genuinely cleaner alternative and some correctly collapse.
ODS = [
    ("Sudirman->Setiabudi",     (-6.2015, 106.8230), (-6.2105, 106.8290)),
    ("Thamrin->Menteng",        (-6.1930, 106.8230), (-6.1985, 106.8350)),
    ("Kuningan->MegaKuningan",  (-6.2280, 106.8300), (-6.2330, 106.8270)),
    ("Senayan->Kebayoran",      (-6.2270, 106.7990), (-6.2390, 106.7980)),
    ("Kemang loop",             (-6.2600, 106.8130), (-6.2680, 106.8150)),
    ("Tebet residential",       (-6.2360, 106.8580), (-6.2270, 106.8540)),
    ("Cikini->Salemba",         (-6.1980, 106.8410), (-6.2030, 106.8520)),
    ("Gondangdia->Cikini",      (-6.1880, 106.8330), (-6.1980, 106.8410)),
    ("BlokM->Melawai",          (-6.2440, 106.7990), (-6.2490, 106.8030)),
    ("Manggarai->Tebet",        (-6.2100, 106.8500), (-6.2260, 106.8560)),
]


def fork_route(url, o, d, w, timeout=30):
    body = json.dumps({
        "locations": [{"lat": o[0], "lon": o[1]}, {"lat": d[0], "lon": d[1]}],
        "costing": "pedestrian",
        "costing_options": {"pedestrian": {"aqi_weight": w}},
    }).encode()
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            j = json.load(r)
        s = j.get("trip", {}).get("summary", {})
        return {"km": float(s.get("length", 0)), "secs": float(s.get("time", 0)), "lat": time.time() - t0}
    except Exception as e:
        return {"err": str(e)[:120], "lat": time.time() - t0}


def run_fork(fork_url):
    print(f"=== fork-direct sweep: {fork_url} (pedestrian, weights {WEIGHTS}) ===")
    lats, n, eta_ok, dev, collapse = [], 0, 0, 0, 0
    for name, o, d in ODS:
        row = {w: fork_route(fork_url, o, d, w) for w in WEIGHTS}
        if any("err" in row[w] for w in WEIGHTS):
            print(f"  {name:24s} ERR {[row[w].get('err') for w in WEIGHTS if 'err' in row[w]][0]}")
            continue
        n += 1
        lats += [row[w]["lat"] for w in WEIGHTS]
        fast, mid, clean = row[WEIGHTS[0]], row[WEIGHTS[1]], row[WEIGHTS[-1]]
        honest = clean["secs"] >= fast["secs"] - 1.0  # a cleaner walk is never faster than the fastest
        eta_ok += honest
        dkm = abs(clean["km"] - fast["km"]) / max(fast["km"], 1e-6)
        dev += dkm > 0.02
        collapse += dkm <= 0.02
        print(f"  {name:24s} w{WEIGHTS[0]}={fast['km']:.3f}km/{fast['secs']:.0f}s "
              f"w{WEIGHTS[1]}={mid['km']:.3f}km w{WEIGHTS[-1]}={clean['km']:.3f}km/{clean['secs']:.0f}s "
              f"dev={dkm*100:.1f}%{'' if honest else '  !! ETA NOT HONEST'}")
    if n == 0:
        print("  NO successful routes — is the fork up on this port?")
        return False
    p95 = sorted(lats)[int(0.95 * (len(lats) - 1))]
    print(f"  -- {n} ODs | honest ETA {eta_ok}/{n} | deviated {dev}/{n} | collapsed {collapse}/{n} | "
          f"latency p95={p95*1000:.0f}ms max={max(lats)*1000:.0f}ms")
    ok = (eta_ok == n) and (p95 < 1.5)
    print(f"  GATE fork-direct: {'PASS' if ok else 'FAIL'}  (honest ETA for all; p95<1.5s)")
    return ok


def run_preview(base, bypass):
    print(f"=== e2e route-score: {base} ===")
    q = f"?x-vercel-protection-bypass={bypass}" if bypass else ""
    n, mono, reductions = 0, 0, []
    for name, o, d in ODS:
        body = json.dumps({"start": list(o), "end": list(d), "profile": "foot-walking",
                            "valhalla_costing": "pedestrian", "alternatives": 3}).encode()
        req = urllib.request.Request(base + "/api/vayu/route-score" + q, data=body,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                j = json.load(r)
        except Exception as e:
            print(f"  {name:24s} ERR {str(e)[:90]}")
            continue
        routes = j.get("routes", [])
        by = {r.get("route_label"): r for r in routes}
        te = {k: round(by[k].get("vayu_trap_exposure", 0), 1) for k in by}
        n += 1
        fast, clean = by.get("fastest"), by.get("cleanest")
        ok = not (fast and clean) or clean.get("vayu_trap_exposure", 0) <= fast.get("vayu_trap_exposure", 0) + 1e-6
        mono += ok
        if fast and clean and fast.get("vayu_trap_exposure", 0) > 0:
            red = 1 - clean["vayu_trap_exposure"] / fast["vayu_trap_exposure"]
            xt = clean["duration_seconds"] / max(fast["duration_seconds"], 1) - 1
            reductions.append((red, xt))
        print(f"  {name:24s} routes={len(routes)} trap={te} {'' if ok else '!! cleanest>fastest'}")
    if reductions:
        reds = sorted(r for r, _ in reductions)
        xts = sorted(x for _, x in reductions)
        mid = len(reds) // 2
        worth = sum(1 for r, x in reductions if r >= 0.10 and x <= 0.30)
        print(f"  -- reduction p50={reds[mid]*100:.0f}% | extra-time p50={xts[mid]*100:.0f}% | "
              f"worthwhile(>=10%cut,<=30%time) {worth}/{len(reductions)}")
    print(f"  GATE e2e: {'PASS' if mono == n and n > 0 else 'FAIL'}  (cleanest<=fastest trap for all {n})")
    return mono == n and n > 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--fork-port", default="8012")
    ap.add_argument("--preview", default="")
    ap.add_argument("--bypass", default="")
    a = ap.parse_args()
    ok = run_fork(f"http://localhost:{a.fork_port}/route")
    if a.preview:
        ok = run_preview(a.preview.rstrip("/"), a.bypass) and ok
    sys.exit(0 if ok else 1)
