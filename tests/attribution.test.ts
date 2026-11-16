import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CAMS_NOTICE, ROAD_ATTRIBUTION, WAQI_ATTRIBUTION, waqiCredit } from '../src/lib/attribution';

describe('data attribution', () => {
  it('road colours credit Open-Meteo with a link and carry the Copernicus notice', () => {
    expect(ROAD_ATTRIBUTION).toMatch(/href="https:\/\/open-meteo\.com\/"/);
    expect(ROAD_ATTRIBUTION).toContain('Contains modified Copernicus Atmosphere Monitoring Service information');
    expect(CAMS_NOTICE).toMatch(/2026$/);
  });

  it('road colours credit OpenAQ and the sensor provider, since the field krigs citizen sensors', () => {
    expect(ROAD_ATTRIBUTION).toMatch(/href="https:\/\/openaq\.org\/"/);
    expect(ROAD_ATTRIBUTION).toContain('AirGradient, CC BY 4.0');
  });

  it('every WAQI reading credits WAQI and the originating agencies', () => {
    expect(waqiCredit([{ name: 'World Air Quality Index Project' }, { name: 'BMKG' }])).toBe('World Air Quality Index Project · BMKG');
    expect(waqiCredit([])).toBe('World Air Quality Index Project');
    expect(WAQI_ATTRIBUTION).toMatch(/World Air Quality Index Project/);
  });

  it('the map shows the notices while the layers are on, and /prioritas and the AQI card name their sources', () => {
    const map = readFileSync('src/components/map/LeafletMap.tsx', 'utf8');
    expect(map).toMatch(/useMapAttribution\(map, ROAD_ATTRIBUTION, !!showAQIOverlay\)/);
    expect(map).toMatch(/useMapAttribution\(map, WAQI_ATTRIBUTION, !!showAQIStations\)/);
    expect(readFileSync('src/pages/PrioritasPage.tsx', 'utf8')).toMatch(/OPEN_METEO_LINK[\s\S]*CAMS_NOTICE/);
    expect(readFileSync('src/components/features/AQICard.tsx', 'utf8')).toMatch(/WAQI_NAME/);
    expect(readFileSync('src/components/map/AQIStationLayer.tsx', 'utf8')).not.toMatch(/filter\(\(a\) => a\.name !== 'World Air Quality Index Project'\)/);
  });
});
