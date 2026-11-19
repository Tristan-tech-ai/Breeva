"""F5-35: is the Koschmieder smoke estimate too high on FU hours because mist/fog droplets also cut visibility?

Pre-registered in .claude/loop/DECISIONS.md (19 Nov 2026 22.52 WIB) before the errors were looked at. Same data and
pairing as F5-34 (sensor <-> airport <= 60 km), production formula of scripts/field/smoke.ts (alpha 6.2 m2/g).
Rule A (production): fires on FU, or dry-low (> half the reports < 10 km, no RA/TS/DZ/SH/BR/FG, mean < 3 km).
Rule B (H1): as A, but FU hours that also report BR or FG do not fire. Hours that do not fire use CAMS at the sensor.

Usage: vayu/.venv/Scripts/python.exe -I vayu/field/analisis_asap_f535.py <segar_dir> <out.json>
"""
import json
import math
import sys

import numpy as np
import pandas as pd


ALPHA = 6.2
MI_KM = 1.609344
TEST_FROM = pd.Timestamp('2026-10-25T00:00Z')
TEST_TO = pd.Timestamp('2026-11-18T00:00Z')


def km(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def hour_table(met):
    """One row per station-hour as summariseHour in scripts/field/smoke.ts, with rule A (production) and B (H1)."""
    met = met.copy()
    met['hour'] = pd.to_datetime(met['valid'].str.slice(0, 13) + ':00', utc=True)
    wx = met['wxcodes'].fillna('').astype(str)
    met['fu'] = wx.str.contains('FU')
    met['fog'] = wx.str.contains('BR|FG', regex=True)
    met['wet'] = wx.str.contains('RA|TS|DZ|SH', regex=True)
    v = met['vsby'] * MI_KM
    met['vkm'] = v.clip(lower=0.05, upper=10)
    met['cap'] = (met['vsby'] >= 6.2).astype(float).where(met['vsby'].notna())
    met['bdry'] = (3.912 / met['vkm']) * (1 - met['relh'].clip(upper=95) / 100) ** 0.6
    met.loc[met['vsby'].isna() | met['relh'].isna(), 'bdry'] = np.nan
    met.loc[met['vsby'].isna(), 'vkm'] = np.nan
    h = met.groupby(['station', 'hour']).agg(vkm=('vkm', 'mean'), bdry=('bdry', 'mean'), cap=('cap', 'mean'), fu=('fu', 'max'), fog=('fog', 'max'), wet=('wet', 'max'), relh=('relh', 'mean')).reset_index()
    h['below'] = 1 - h['cap']
    h['drylow'] = (h['below'] > 0.5) & ~h['wet'] & ~h['fog'] & (h['vkm'] < 3)
    h['fires_A'] = h['bdry'].notna() & h['vkm'].notna() & (h['fu'] | h['drylow'])
    h['fires_B'] = h['bdry'].notna() & h['vkm'].notna() & ((h['fu'] & ~h['fog']) | h['drylow'])
    h['kosch'] = h['bdry'] / (ALPHA / 1000)
    return h


def dead_sensors(pm, threshold=0.9):
    """Sensors reading exactly 0 in at least `threshold` of their hours (dead; F5-35 found 6313205 at 1.0)."""
    zero = pm.groupby('loc_id')['pm25'].apply(lambda v: float((v == 0).mean()))
    return [int(k) for k, f in zero.items() if f >= threshold], zero


def score(df, col):
    if not len(df):
        return None
    e = df[col] - df['pm25']
    return {'n_jam': int(len(df)), 'rmse': round(float(np.sqrt((e ** 2).mean())), 2), 'bias': round(float(e.mean()), 2)}


def block(df):
    return {'A_produksi': score(df, 'est_A'), 'B_tanpa_FU_berkabut': score(df, 'est_B'), 'tanpa_koschmieder': score(df, 'pm2_5'), 'n_sensor': int(df['loc_id'].nunique())}


def main(D, OUT):
    loc = pd.read_csv(f'{D}/openaq_lokasi.csv')
    pm = pd.read_csv(f'{D}/openaq_jam.csv.gz')
    met = pd.read_csv(f'{D}/metar.csv.gz')
    cams = pd.read_csv(f'{D}/cams.csv.gz')

    stations = met.groupby('station')[['lat', 'lon']].first()
    pairs = []
    for _, l in loc.iterrows():
        d = stations.apply(lambda s: km(l.lat, l.lon, s.lat, s.lon), axis=1)
        if d.min() <= 60:
            pairs.append({'loc_id': int(l.loc_id), 'bandara': d.idxmin(), 'jarak_km': round(float(d.min()), 1), 'nama': l['name'], 'lat': l.lat, 'lon': l.lon})
    pairs = pd.DataFrame(pairs)

    h = hour_table(met)

    pm['hour'] = pd.to_datetime(pm['th'], utc=True)
    cams['hour'] = pd.to_datetime(cams['time'] + ':00Z', utc=True) if not cams['time'].str.endswith('Z').any() else pd.to_datetime(cams['time'], utc=True)
    x = pm.merge(pairs[['loc_id', 'bandara', 'jarak_km', 'nama']], on='loc_id').merge(cams[['loc_id', 'hour', 'pm2_5']], on=['loc_id', 'hour'], how='left')
    x = x.merge(h.rename(columns={'station': 'bandara'}), on=['bandara', 'hour'], how='left')
    x = x[x['pm25'].notna() & x['pm2_5'].notna()].copy()
    for f in ('fires_A', 'fires_B', 'fu', 'fog'):
        x[f] = x[f].astype("boolean").fillna(False).astype(bool)
    x['est_A'] = np.where(x['fires_A'], x['kosch'], x['pm2_5'])
    x['est_B'] = np.where(x['fires_B'], x['kosch'], x['pm2_5'])
    x['uji'] = (x['hour'] >= TEST_FROM) & (x['hour'] < TEST_TO)

    out = {'tugas': 'F5-35', 'pra_registrasi': 'breeva/.claude/loop/DECISIONS.md 19 Nov 2026 22.52 WIB', 'alpha_m2g': ALPHA,
           'jendela_uji': [str(TEST_FROM), str(TEST_TO)], 'pasangan': pairs.to_dict('records')}
    A_on = x[x['fires_A']]
    out['jam_A_menyala'] = {'uji': block(A_on[A_on['uji']]), 'latih_15_24_okt': block(A_on[~A_on['uji']])}
    out['jam_FU_berkabut'] = {'uji': block(A_on[A_on['uji'] & A_on['fu'] & A_on['fog']]), 'semua': block(A_on[A_on['fu'] & A_on['fog']])}
    out['jam_FU_tanpa_kabut'] = {'uji': block(A_on[A_on['uji'] & A_on['fu'] & ~A_on['fog']]), 'semua': block(A_on[A_on['fu'] & ~A_on['fog']])}
    per = {}
    for (lid, b), g in A_on[A_on['uji']].groupby(['loc_id', 'bandara']):
        per[f'{lid}_{b}'] = block(g)
    out['per_sensor_uji'] = per

    # part 1: the two sensors against CAMS on FU and non-FU hours, and neighbours within 25 km
    diag = {}
    for lid in (6313205, 5586536):
        g = x[x['loc_id'] == lid]
        row = {}
        for name, sel in (('jam_FU', g['fu']), ('jam_tanpa_FU', ~g['fu'])):
            s = g[sel]
            row[name] = {'n_jam': int(len(s)), 'median_sensor': round(float(s['pm25'].median()), 1) if len(s) else None,
                         'median_cams': round(float(s['pm2_5'].median()), 1) if len(s) else None,
                         'median_rasio_sensor_cams': round(float((s['pm25'] / s['pm2_5'].clip(lower=1)).median()), 2) if len(s) else None,
                         'median_koschmieder': round(float(s['kosch'].median()), 1) if len(s) and s['kosch'].notna().any() else None,
                         'median_rh': round(float(s['relh'].median()), 1) if len(s) and s['relh'].notna().any() else None}
        me = loc[loc['loc_id'] == lid].iloc[0]
        nb = [int(o.loc_id) for _, o in loc.iterrows() if o.loc_id != lid and km(me.lat, me.lon, o.lat, o.lon) <= 25]
        row['tetangga_25km'] = nb
        if nb:
            n = pm[pm['loc_id'].isin(nb)].groupby('hour')['pm25'].median().rename('tetangga')
            gg = g.merge(n, left_on='hour', right_index=True)
            row['median_rasio_sensor_tetangga'] = {k: round(float((s['pm25'] / s['tetangga'].clip(lower=1)).median()), 2) if len(s) else None for k, s in (('jam_FU', gg[gg['fu']]), ('jam_tanpa_FU', gg[~gg['fu']]))}
        diag[str(lid)] = row
    out['diagnosis_sensor'] = diag

    # production airports: how many FU+BR/FG hours (the hours rule B would drop)
    prod = {}
    for st in ('WADD', 'WIHH'):
        s = h[h['station'] == st]
        prod[st] = {'jam': int(len(s)), 'jam_FU': int(s['fu'].sum()), 'jam_FU_berkabut': int((s['fu'] & s['fog']).sum()), 'jam_A_menyala': int(s['fires_A'].sum())}
    out['produksi'] = prod

    # Sensor check (added after part 1 showed sensor 6313205 reading 0): a sensor reading exactly 0 in >= 90% of its hours is
    # dead and cannot judge anything. F5-34's comparison on dry-low hours (rule fires without FU) is redone without them.
    dead, zero = dead_sensors(pm)
    out['sensor_mati'] = {'aturan': 'membaca tepat 0 pada >= 90% jam', 'loc_id': dead, 'pecahan_nol': {str(k): round(zero[k], 3) for k in dead}}
    alive = x[~x['loc_id'].isin(dead)]
    dl = alive[alive['fires_A'] & ~alive['fu']]
    out['jam_kering_rendah_tanpa_sensor_mati'] = {'semua': block(dl), 'uji': block(dl[dl['uji']]), 'latih_15_24_okt': block(dl[~dl['uji']]),
                                                  'dengan_sensor_mati_semua': block(x[x['fires_A'] & ~x['fu']])}
    fu_alive = alive[alive['fires_A'] & alive['fu']]
    out['jam_FU_tanpa_sensor_mati'] = {'semua': block(fu_alive), 'per_sensor': {str(k): block(g) for k, g in fu_alive.groupby('loc_id')}}

    u = out['jam_A_menyala']['uji']
    ok_total = u['B_tanpa_FU_berkabut']['rmse'] <= 0.70 * u['A_produksi']['rmse']
    ok_kota = {}
    for key, b in per.items():
        if key.startswith('6313205') or key.startswith('5586536'):
            ok_kota[key] = b['B_tanpa_FU_berkabut']['rmse'] <= b['A_produksi']['rmse']
    out['keputusan'] = {'rmse_B_per_A_uji': round(u['B_tanpa_FU_berkabut']['rmse'] / u['A_produksi']['rmse'], 3), 'syarat_total_0_70': bool(ok_total),
                        'palembang_medan_tidak_memburuk': ok_kota, 'H1_diterima': bool(ok_total and ok_kota and all(ok_kota.values()))}
    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=str)
    print(json.dumps({k: out[k] for k in ('sensor_mati', 'jam_kering_rendah_tanpa_sensor_mati', 'jam_FU_tanpa_sensor_mati', 'produksi', 'keputusan')}, ensure_ascii=False, indent=1, default=str))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
