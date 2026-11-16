// Attribution lines required by the data licences (docs/DATA_SOURCES.md): Open-Meteo CC BY 4.0 asks for a link,
// the Copernicus licence for its notice on modified CAMS data, the WAQI terms for credit to WAQI and the originating EPA,
// the OpenAQ terms for credit to OpenAQ and the data provider (AirGradient sensors, CC BY 4.0).

const YEAR = 2026;

export const OPEN_METEO_LINK = 'https://open-meteo.com/';
export const CAMS_NOTICE = `Contains modified Copernicus Atmosphere Monitoring Service information ${YEAR}`;
export const WAQI_NAME = 'World Air Quality Index Project';

export const OPENAQ_LINK = 'https://openaq.org/';

/** Leaflet attribution (HTML) for road colours: Open-Meteo/CAMS background, OpenAQ citizen sensors (AirGradient, CC BY 4.0). */
export const ROAD_ATTRIBUTION =
  `Data cuaca dan latar: <a href="${OPEN_METEO_LINK}" target="_blank" rel="noreferrer">Open-Meteo.com</a> (CC BY 4.0) · ${CAMS_NOTICE}`
  + ` · Sensor warga: <a href="${OPENAQ_LINK}" target="_blank" rel="noreferrer">OpenAQ</a> (AirGradient, CC BY 4.0)`;

/** Leaflet attribution (HTML) for WAQI station markers. */
export const WAQI_ATTRIBUTION = `Stasiun: <a href="https://aqicn.org/" target="_blank" rel="noreferrer">${WAQI_NAME}</a> dan EPA asal`;

/** Credit line for one WAQI reading: WAQI itself plus the originating agencies it lists. */
export function waqiCredit(attributions: Array<{ name: string }>, esc: (s: string) => string = (s) => s): string {
  const origins = attributions.map((a) => a.name).filter((n) => n && n !== WAQI_NAME);
  return [WAQI_NAME, ...origins].map(esc).join(' · ');
}
