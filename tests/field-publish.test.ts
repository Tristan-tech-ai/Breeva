import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ES module without types
import { DAILY, IMMUTABLE, MANIFEST, planUploads } from '../scripts/field/publish-plan.mjs';

function fakeField(cells: number[], extraCell = false) {
  const root = mkdtempSync(join(tmpdir(), 'field-'));
  const put = (p: string, s = 'x') => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), s); };
  put('v/r/manifest.json', JSON.stringify({ geometry: '2026-11', run: '2026111609', cells }));
  for (const c of cells) put(`v/r/2026111609/${c}.bin`);
  if (extraCell) put('v/r/2026111609/99.bin');
  put('v/r/2026111609/inputs.json');
  put('tiles/2026-11/r.pmtiles');
  put('harga/2026-11/client/r.bin');
  return root;
}

type Upload = { local: string; key: string; cacheControl: string; contentType: string };

describe('field upload plan', () => {
  it('maps files to the L1 keys and cache headers, manifest last, run inputs kept local', () => {
    const plan = planUploads(fakeField([0, 3]), ['r']) as Upload[];
    const keys = plan.map((u) => u.key);
    expect(keys).toEqual(['tiles/2026-11/r.pmtiles', 'v/r/2026111609/0.bin', 'v/r/2026111609/3.bin', 'harga/2026-11/r.bin', 'v/r/manifest.json']);
    expect(plan.find((u) => u.key.endsWith('.pmtiles'))!.cacheControl).toBe(IMMUTABLE);
    expect(plan.find((u) => u.key.endsWith('3.bin'))!.cacheControl).toBe(IMMUTABLE);
    expect(plan.at(-1)!.cacheControl).toBe(MANIFEST);
    expect(plan.find((u) => u.key.startsWith('harga/'))!.cacheControl).toBe(DAILY);
    expect(keys.some((k) => k.includes('inputs.json'))).toBe(false);
  });

  it('publishes the walking graph and its school points with a daily cache', () => {
    const root = fakeField([0]);
    mkdirSync(join(root, 'graphs', '2026-11'), { recursive: true });
    writeFileSync(join(root, 'graphs', '2026-11', 'r.bin'), 'g');
    writeFileSync(join(root, 'graphs', '2026-11', 'r_schools.json'), '{}');
    const plan = planUploads(root, ['r']) as Upload[];
    const sch = plan.find((u) => u.key === 'graphs/2026-11/r_schools.json')!;
    expect(sch).toMatchObject({ cacheControl: DAILY, contentType: 'application/json' });
    expect(plan.find((u) => u.key === 'graphs/2026-11/r.bin')!.cacheControl).toBe(DAILY);
    expect(plan.at(-1)!.key).toBe('v/r/manifest.json');
  });

  it('brotli-encodes the files read whole (graph, harga), never the range-read PMTiles or the hourly files (F1-53)', () => {
    const root = fakeField([0]);
    mkdirSync(join(root, 'graphs', '2026-11'), { recursive: true });
    writeFileSync(join(root, 'graphs', '2026-11', 'r.bin'), 'g');
    writeFileSync(join(root, 'graphs', '2026-11', 'r_inti.bin'), 'c');
    writeFileSync(join(root, 'graphs', '2026-11', 'r_bentuk.bin'), 's');
    const plan = planUploads(root, ['r']) as Array<Upload & { encoding?: string }>;
    const gz = plan.filter((u) => u.encoding === 'br').map((u) => u.key).sort();
    expect(gz).toEqual(['graphs/2026-11/r.bin', 'graphs/2026-11/r_bentuk.bin', 'graphs/2026-11/r_inti.bin', 'harga/2026-11/r.bin']);
    expect(plan.filter((u) => u.encoding).length).toBe(4);
    expect(plan.find((u) => u.key.endsWith('.pmtiles'))!.encoding).toBeUndefined();
  });

  it('refuses a run that does not match its manifest', () => {
    expect(() => planUploads(fakeField([0], true), ['r'])).toThrow(/does not list/);
  });

  it('the CloudFormation template creates the budget alarms before the bucket and names everything breeva-', () => {
    const t = readFileSync('infra/aws/breeva-field.yaml', 'utf8');
    expect(t).toMatch(/BudgetName: breeva-monthly-usd5[\s\S]*Amount: 5, Unit: USD/);
    expect(t).toMatch(/BudgetName: breeva-monthly-usd10[\s\S]*Amount: 10, Unit: USD/);
    expect(t).toMatch(/FieldBucket:\s+Type: AWS::S3::Bucket\s+DependsOn: \[BudgetUsd5, BudgetUsd10\]/);
    for (const n of t.matchAll(/(?:TopicName|BucketName|BudgetName|Name): (?:!Sub ')?([\w-]+)/g)) expect(n[1].startsWith('breeva-')).toBe(true);
    expect(t).toMatch(/BlockPublicPolicy: true/);
    expect((t.match(/Key: project, Value: breeva/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
