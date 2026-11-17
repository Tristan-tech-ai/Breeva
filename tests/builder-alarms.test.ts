import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// F2-20: the CloudWatch metric filters of infra/aws/breeva-builder.yaml match the log lines field-builder.ts writes.
// Text-format Lambda logs: a pattern of quoted terms matches a line that holds every term (case-sensitive).
const yaml = readFileSync('infra/aws/breeva-builder.yaml', 'utf8');
const src = readFileSync('infra/lambda/field-builder.ts', 'utf8');
const pattern = (metric: string) => {
  const m = yaml.match(new RegExp(String.raw`FilterPattern: '([^']+)'\s+MetricTransformations:\s+- \{ MetricNamespace: Breeva, MetricName: ${metric},`));
  if (!m) throw new Error(`no filter for ${metric}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};
const matches = (terms: string[], line: string) => terms.every((t) => line.includes(t));

describe('builder alarms (F2-20)', () => {
  it('the retry filter matches a retry line and not the run summary', () => {
    expect(src).toMatch(/console\.log\(JSON\.stringify\(\{ retry: i \}\)\)/);
    const retry = JSON.stringify({ retry: { host: 'air-quality-api.open-meteo.com', attempt: 1, reason: 'fetch failed (UND_ERR_CONNECT_TIMEOUT)', waitMs: 2000 } });
    const summary = JSON.stringify([{ name: 'badung_denpasar', run: '2026111718', roads: 60961 }, { name: 'kota_bogor', run: '2026111718', error: 'fetch failed' }]);
    expect(matches(pattern('BuilderRetries'), retry)).toBe(true);
    expect(matches(pattern('BuilderRetries'), summary)).toBe(false);
  });

  it('the region filter matches the per-region failure line only', () => {
    expect(src).toMatch(/console\.log\(JSON\.stringify\(\{ region_failed: r\.name, run, error: \(e as Error\)\.message \}\)\)/);
    const failed = JSON.stringify({ region_failed: 'badung_denpasar', run: '2026111717', error: 'fetch failed' });
    const summary = JSON.stringify([{ name: 'badung_denpasar', run: '2026111717', error: 'fetch failed' }]);
    expect(matches(pattern('BuilderRegionFailures'), failed)).toBe(true);
    expect(matches(pattern('BuilderRegionFailures'), summary)).toBe(false);
    expect(yaml).toMatch(/AlarmName: breeva-field-region-failed/);
    expect(yaml).toMatch(/AlarmName: breeva-field-builder-retries/);
  });
});
