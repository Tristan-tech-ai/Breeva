// Pure-JS road-color raster tile renderer (no native canvas dep — reliable on
// Vercel). Given a slippy-map tile (z/x/y) + the roads in its bbox, projects each
// road to the 256x256 tile pixel space, rasterizes anti-aliased thick colored
// lines into an RGBA buffer, and encodes a PNG via Node's zlib. The color ramp
// mirrors the client's "Total / AQI" mode so tiles match the vector layer.
import { deflateSync } from 'zlib';

export const TILE = 256;

// ─── Slippy-map tile math (Web Mercator) ────────────────────
export function tileBBox(z: number, x: number, y: number) {
  const n = 2 ** z;
  const lon = (xx: number) => (xx / n) * 360 - 180;
  const lat = (yy: number) => {
    const t = Math.PI - (2 * Math.PI * yy) / n;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t)));
  };
  return { west: lon(x), east: lon(x + 1), north: lat(y), south: lat(y + 1) };
}

// Project lon/lat → pixel within this tile (origin = tile top-left). Values can
// fall outside 0..256 (clipped by the rasterizer) so cross-tile segments connect.
function projector(z: number, x: number, y: number) {
  const n = 2 ** z;
  return (lon: number, latv: number): [number, number] => {
    const px = ((lon + 180) / 360) * n - x;
    const s = Math.sin((latv * Math.PI) / 180);
    const yWorld = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    const py = yWorld * n - y;
    return [px * TILE, py * TILE];
  };
}

// ─── PM2.5/AQI color ramp (matches RoadPollutionLayer 'total'/'aqi') ──
const AQI_STOPS: [number, number, number, number][] = [
  [0, 0x00, 0xe4, 0x00], [50, 0xff, 0xff, 0x00], [100, 0xff, 0x7e, 0x00],
  [150, 0xff, 0x00, 0x00], [200, 0x8f, 0x3f, 0x97], [300, 0x7e, 0x00, 0x23],
];
function aqiColor(aqi: number): [number, number, number] {
  if (aqi <= AQI_STOPS[0][0]) return [AQI_STOPS[0][1], AQI_STOPS[0][2], AQI_STOPS[0][3]];
  for (let i = 0; i < AQI_STOPS.length - 1; i++) {
    const a = AQI_STOPS[i], b = AQI_STOPS[i + 1];
    if (aqi < b[0]) {
      const t = (aqi - a[0]) / (b[0] - a[0] || 1);
      return [
        Math.round(a[1] + (b[1] - a[1]) * t),
        Math.round(a[2] + (b[2] - a[2]) * t),
        Math.round(a[3] + (b[3] - a[3]) * t),
      ];
    }
  }
  const l = AQI_STOPS[AQI_STOPS.length - 1];
  return [l[1], l[2], l[3]];
}

// ─── Rasterizer: alpha-blended thick line into the RGBA buffer ──
function blend(buf: Uint8Array, px: number, py: number, r: number, g: number, b: number, a: number) {
  if (px < 0 || px >= TILE || py < 0 || py >= TILE || a <= 0) return;
  const i = (py * TILE + px) * 4;
  const ia = 1 - a;
  buf[i] = Math.round(r * a + buf[i] * ia);
  buf[i + 1] = Math.round(g * a + buf[i + 1] * ia);
  buf[i + 2] = Math.round(b * a + buf[i + 2] * ia);
  buf[i + 3] = Math.round(a * 255 + buf[i + 3] * ia);
}

// Draw a round-capped thick segment by stamping a disc brush along it.
function thickSegment(
  buf: Uint8Array, x0: number, y0: number, x1: number, y1: number,
  half: number, r: number, g: number, b: number, alpha: number,
) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(len));
  const ri = Math.ceil(half);
  for (let s = 0; s <= steps; s++) {
    const cx = x0 + (dx * s) / steps, cy = y0 + (dy * s) / steps;
    for (let oy = -ri; oy <= ri; oy++) {
      for (let ox = -ri; ox <= ri; ox++) {
        const d = Math.hypot(ox, oy);
        if (d > half + 0.5) continue;
        const edge = Math.min(1, half + 0.5 - d); // soft 1px edge
        blend(buf, Math.round(cx) + ox, Math.round(cy) + oy, r, g, b, alpha * edge);
      }
    }
  }
}

export interface TileRoad {
  aqi: number;
  weight?: number;
  confidence_score?: number;
  ood_refused?: boolean;
  geometry: { coordinates: [number, number][] };
}

export function renderRoadTile(roads: TileRoad[], z: number, x: number, y: number): Buffer {
  const buf = new Uint8Array(TILE * TILE * 4); // transparent
  const project = projector(z, x, y);
  // Line width scales with zoom (matches the vector layer's zoomScale feel).
  const baseHalf = z >= 16 ? 2.2 : z >= 15 ? 1.7 : z >= 14 ? 1.3 : z >= 13 ? 1.0 : 0.8;

  for (const road of roads) {
    const c = road.geometry?.coordinates;
    if (!c || c.length < 2) continue;
    let [r, g, b] = [156, 163, 175]; // grey for OOD-refused
    if (!road.ood_refused) [r, g, b] = aqiColor(road.aqi);
    const conf = typeof road.confidence_score === 'number' ? road.confidence_score : 0.5;
    const alpha = conf > 0.7 ? 0.9 : conf > 0.4 ? 0.65 : 0.45;
    const half = baseHalf * (road.weight ? Math.max(0.6, Math.min(2, road.weight / 3)) : 1);
    let prev = project(c[0][0], c[0][1]);
    for (let i = 1; i < c.length; i++) {
      const cur = project(c[i][0], c[i][1]);
      // skip segments entirely off-tile (cheap reject with margin)
      const m = half + 2;
      if (!((prev[0] < -m && cur[0] < -m) || (prev[0] > TILE + m && cur[0] > TILE + m) ||
            (prev[1] < -m && cur[1] < -m) || (prev[1] > TILE + m && cur[1] > TILE + m))) {
        thickSegment(buf, prev[0], prev[1], cur[0], cur[1], half, r, g, b, alpha);
      }
      prev = cur;
    }
  }
  return encodePng(TILE, TILE, buf);
}

// ─── Minimal PNG encoder (RGBA, filter 0) via zlib ──────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  // filtered scanlines (filter type 0 per row)
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let yy = 0; yy < height; yy++) {
    raw[yy * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + yy * stride, stride).copy(raw, yy * (stride + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
}
