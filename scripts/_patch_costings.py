"""Patch Valhalla-C AQI per-edge cost into pedestrian/bicycle/motorscooter costings.

Mirrors the validated autocost.cc patch (6 edits). Runs in WSL against /opt/valhalla.
Idempotent (skips a file already containing aqi_weight_) and fails LOUDLY if any anchor
does not match exactly once (no silent corruption). secs (ETA) is never touched -> honest time.
NOTE: edgeid.value is a FIELD (no parens) — the old _patch_autocost.py used value() (wrong).

  wsl.exe python3 /mnt/c/Users/Tristan/Downloads/breeva/scripts/_patch_costings.py
"""
import sys

INCLUDE = '#include "baldr/rapidjson_utils.h"'
EDGEFACTOR = '  factor *= EdgeFactor(edgeid);'

FILES = {
    '/opt/valhalla/src/sif/pedestriancost.cc': {
        'range':  'constexpr ranged_default_t<float> kElevatorPenaltyRange{0, kDefaultElevatorPenalty, kMaxPenalty};',
        'member': '  float mode_factor_;',
        'ctor':   '  driveway_factor_ = costing_options.driveway_factor();',
        'parse':  '  JSON_PBF_RANGED_DEFAULT(co, kUseHillsRange, json, "/use_hills", use_hills, warnings);',
    },
    '/opt/valhalla/src/sif/bicyclecost.cc': {
        'range':  'constexpr ranged_default_t<float> kBSSPenaltyRange{0, kDefaultBssPenalty, kMaxPenalty};',
        'member': '  float speed_;',
        'ctor':   '  use_roads_ = costing_options.use_roads();',
        'parse':  '  JSON_PBF_RANGED_DEFAULT(co, kUseRoadRange, json, "/use_roads", use_roads, warnings);',
    },
    '/opt/valhalla/src/sif/motorscootercost.cc': {
        'range':  'constexpr ranged_default_t<float> kUsePrimaryRange{0, kDefaultUsePrimary, 1.0f};',
        'member': '  float road_factor_;',
        'ctor':   '  float use_primary = costing_options.use_primary();',
        'parse':  '  JSON_PBF_RANGED_DEFAULT(co, kUsePrimaryRange, json, "/use_primary", use_primary, warnings);',
    },
}

AQI_EDGECOST = (
    EDGEFACTOR + '\n\n'
    '  // Breeva Valhalla-C: native per-edge AQI cost. secs (ETA) is NOT touched -> honest time.\n'
    '  if (aqi_weight_ > 0.0f) {\n'
    '    factor *= (1.0f + aqi_weight_ * AqiOverlay::get().penalty(edgeid.value));\n'
    '  }'
)


def patch(path, a):
    s = open(path, encoding='utf-8').read()
    if 'aqi_weight_' in s:
        print(f"SKIP (already patched): {path}")
        return
    edits = [
        (INCLUDE, INCLUDE + '\n#include "sif/aqi_overlay.h"'),
        (a['range'], a['range'] + '\nconstexpr ranged_default_t<float> kAqiWeightRange{0.0f, 0.0f, 100.0f}; // Breeva Valhalla-C'),
        (a['member'], a['member'] + '\n  float aqi_weight_ = 0.0f;   // Breeva Valhalla-C: per-request AQI cost weight (0 = off)'),
        (a['ctor'], a['ctor'] + '\n  aqi_weight_ = costing_options.aqi_weight(); // Breeva Valhalla-C'),
        (a['parse'], a['parse'] + '\n  JSON_PBF_RANGED_DEFAULT(co, kAqiWeightRange, json, "/aqi_weight", aqi_weight, warnings); // Breeva Valhalla-C'),
        (EDGEFACTOR, AQI_EDGECOST),
    ]
    for old, new in edits:
        c = s.count(old)
        if c != 1:
            print(f"FAIL {path}: count={c} for {old[:72]!r}")
            sys.exit(1)
        s = s.replace(old, new, 1)
    open(path, 'w', encoding='utf-8', newline='').write(s)
    print(f"patched OK (6 edits): {path}")


for path, a in FILES.items():
    patch(path, a)
print("all costings patched")
