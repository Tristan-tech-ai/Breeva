// Writes tests/fixtures/cell_small.bin and cell_small.json (the values it encodes) for the cross-language cell tests.
import { writeFileSync } from 'node:fs';
import { encodeCell, type CellValue } from './cells.js';

export const FIXTURE_VALUES: CellValue[] = [
  { pm25: 12.34, pm25_delta: 0.07, no2: 18.4, no2_delta: 2.6, confidence: 'high', ood: false, pi_half: 13.7 },
  { pm25: 274.0, pm25_delta: 20, no2: 300, no2_delta: 80, confidence: 'medium', ood: false, pi_half: 70 },
  { pm25: 0, pm25_delta: 0, no2: 0, no2_delta: 0, confidence: 'refuse', ood: true, pi_half: 0 },
  { pm25: 35.45, pm25_delta: 12.75, no2: 254.6, no2_delta: 63.75, confidence: 'low', ood: false, pi_half: 62 },
];

writeFileSync('tests/fixtures/cell_small.bin', encodeCell(FIXTURE_VALUES));
writeFileSync('tests/fixtures/cell_small.json', JSON.stringify(FIXTURE_VALUES));
console.log('cell fixture written');
