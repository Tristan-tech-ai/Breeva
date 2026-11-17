import { crc32, inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CACHE, RUN_TAG, isCellKey, reportKey, runFor, runObjects, uploadBody, type BuiltRun } from '../scripts/field/builder';
import { gunzipSync, gzipSync } from 'node:zlib';
import { BUILD_REGIONS, packKey } from '../scripts/field/regions';
import { manifestStatus, statusText } from '../src/lib/field/status';
// @ts-expect-error plain ES module without types
import { zipFiles } from '../infra/lambda/zip.mjs';

const built = (run: string): BuiltRun => ({
  run,
  cells: [{ c: 0, bytes: new Uint8Array([1]) }, { c: 3, bytes: new Uint8Array([2]) }],
  inputs: {} as BuiltRun['inputs'],
  report: { roads: 2 },
  manifest: { run, cells: [0, 3] },
});

describe('hourly field run objects', () => {
  it('names the run by its UTC hour', () => {
    expect(runFor(new Date('2026-11-16T11:05:17Z')).run).toBe('2026111611');
    expect(runFor(new Date('2026-11-16T23:59:59Z')).run).toBe('2026111623');
  });

  it('writes cells, then inputs and report under audit/, then the manifest last', () => {
    const keys = runObjects('r', built('2026111611')).map((o) => o.key);
    expect(keys).toEqual(['v/r/2026111611/0.bin', 'v/r/2026111611/3.bin', 'audit/r/2026111611/inputs.json', 'audit/r/2026111611/report.json', 'v/r/manifest.json']);
    expect(reportKey('r', '2026111611')).toBe(keys[3]);
  });

  it('marks run files for expiry and keeps the manifest short-lived in caches but untagged', () => {
    const objs = runObjects('r', built('2026111611'));
    const manifest = objs.at(-1)!;
    expect(manifest.cacheControl).toBe(CACHE.manifest);
    expect(manifest.tagging).toBeUndefined();
    for (const o of objs.slice(0, -1)) { expect(o.tagging).toBe(RUN_TAG); expect(o.cacheControl).toBe(CACHE.immutable); }
    // nothing CloudFront serves carries sensor readings
    expect(objs.filter((o) => o.key.startsWith('v/') && o.key.endsWith('.json')).map((o) => o.key)).toEqual(['v/r/manifest.json']);
  });

  it('builds every region from a pack under packs/<geometry>/', () => {
    expect(BUILD_REGIONS.map((r) => r.name)).toEqual(['badung_denpasar', 'kota_bogor']);
    expect(BUILD_REGIONS.find((r) => r.name === 'kota_bogor')!.indicative).toBe(true);
    expect(packKey(BUILD_REGIONS[0])).toBe('packs/2026-11/badung_denpasar.bin');
  });

  it('the bucket serves only the app prefixes and expires tagged runs', () => {
    const t = readFileSync('infra/aws/breeva-field.yaml', 'utf8');
    for (const p of ['v', 'tiles', 'harga', 'graphs']) expect(t).toContain(`\${FieldBucket.Arn}/${p}/*`);
    expect(t).not.toContain("'${FieldBucket.Arn}/*'");
    expect(t).toMatch(/TagFilters: \[\{ Key: kind, Value: run \}\]\s+ExpirationInDays: 7/);
  });

  it('the schedule runs hourly at :20 without retries', () => {
    const t = readFileSync('infra/aws/breeva-builder.yaml', 'utf8');
    expect(t).toContain('ScheduleExpression: cron(20 * * * ? *)');
    expect(t).toContain('MaximumRetryAttempts: 0');
    expect(t).toContain('RetentionInDays: 14');
  });

  it('alarms on builder errors and on two hours without a successful run, both to breeva-alarms', () => {
    const t = readFileSync('infra/aws/breeva-builder.yaml', 'utf8');
    expect(t).toMatch(/AlarmName: breeva-field-builder-errors[\s\S]*?MetricName: Errors[\s\S]*?Period: 3600[\s\S]*?Threshold: 1/);
    expect(t).toMatch(/AlarmName: breeva-field-stale[\s\S]*?Expression: inv - FILL\(err, 0\)[\s\S]*?EvaluationPeriods: 2[\s\S]*?TreatMissingData: breaching/);
    expect((t.match(/AlarmActions: \[!Sub 'arn:aws:sns:\$\{AWS::Region\}:\$\{AWS::AccountId\}:breeva-alarms'\]/g) ?? []).length).toBe(4); // + retries and region failures (F2-20)
    // the topic policy lets those alarms publish (a custom policy replaces the default one)
    expect(readFileSync('infra/aws/breeva-field.yaml', 'utf8')).toMatch(/Principal: \{ Service: cloudwatch.amazonaws.com \}[\s\S]*?alarm:breeva-\*/);
  });
});

describe('cell upload encoding', () => {
  it('gzips the value cells only, and the bytes come back unchanged', () => {
    const objs = runObjects('r', built('2026111611'));
    const gz = (b: Uint8Array) => new Uint8Array(gzipSync(b));
    const ups = objs.map((o) => ({ key: o.key, ...uploadBody(o, gz) }));
    expect(ups.filter((u) => u.contentEncoding === 'gzip').map((u) => u.key)).toEqual(['v/r/2026111611/0.bin', 'v/r/2026111611/3.bin']);
    expect([...gunzipSync(ups[0].body as Uint8Array)]).toEqual([1]);
    expect(isCellKey('v/r/manifest.json')).toBe(false);
    expect(isCellKey('graphs/2026-11/r.bin')).toBe(false);
    expect(isCellKey('v/badung_denpasar/2026111612/10.bin')).toBe(true);
  });
});

describe('field freshness', () => {
  const now = new Date('2026-11-16T12:30:00Z');
  it('passes a manifest computed within 75 minutes', () => {
    expect(manifestStatus({ run: '2026111612', computed_at: '2026-11-16T12:21:30Z', sensors_used: 26 }, now)).toMatchObject({ ok: true, age_min: 8.5, sensors: 26 });
  });
  it('fails a stale or malformed manifest', () => {
    expect(manifestStatus({ run: '2026111610', computed_at: '2026-11-16T10:16:00Z' }, now).ok).toBe(false);
    expect(manifestStatus({ run: '2026111612' }, now).ok).toBe(false);
    expect(manifestStatus(null, now).ok).toBe(false);
  });
  it('says in plain words how fresh the map is and what it rests on', () => {
    expect(statusText(manifestStatus({ run: 'r', computed_at: '2026-11-16T12:21:30Z', sensors_used: 26, measurement: { method: 'kriging' } }, now)))
      .toBe('Segar: dihitung 9 menit lalu · 26 sensor warga');
    expect(statusText(manifestStatus({ run: 'r', computed_at: '2026-11-16T09:00:00Z', indicative: true, measurement: { method: 'none' } }, now)))
      .toBe('Basi: dihitung 210 menit lalu · model tanpa sensor · indikatif');
    expect(statusText({ ok: false, error: 'HTTP 403' })).toBe('Manifest tidak terbaca');
  });
});

describe('lambda zip', () => {
  it('stores each file deflated with its CRC, readable back, and is deterministic', () => {
    const data = new TextEncoder().encode('export const handler = async () => 1;\n'.repeat(50));
    const z: Buffer = zipFiles([{ name: 'index.mjs', data }]);
    expect(z.readUInt32LE(0)).toBe(0x04034b50);
    const nameLen = z.readUInt16LE(26);
    const size = z.readUInt32LE(18);
    expect(z.subarray(30, 30 + nameLen).toString()).toBe('index.mjs');
    const body = inflateRawSync(z.subarray(30 + nameLen, 30 + nameLen + size));
    expect(Buffer.from(body).equals(Buffer.from(data))).toBe(true);
    expect(z.readUInt32LE(14)).toBe(crc32(data) >>> 0);
    const eocd = z.length - 22;
    expect(z.readUInt32LE(eocd)).toBe(0x06054b50);
    expect(z.readUInt16LE(eocd + 10)).toBe(1);
    expect(zipFiles([{ name: 'index.mjs', data }]).equals(z)).toBe(true);
  });
});
