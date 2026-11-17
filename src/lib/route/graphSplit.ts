/**
 * Split of the walking graph pack (BGR1) into a core and a shapes file (F1-56). On a slow 3G link the first walking
 * route waited for the whole 1.07 MB graph (brotli); the edge shapes (sh, sh_off, sh_pts) are 59% of it and a walking
 * route does not need them to be computed, only to be drawn. The core keeps the BGR1 container and header (the shape
 * columns left out, "parts": "inti"); the shapes file is a BSH1 container with the three shape columns.
 *
 * Container: 4-byte magic, u32 header length (little endian), JSON header, then each column at its absolute offset,
 * every offset a multiple of 8 (as vayu/field/graph.py writes it).
 */
export interface ContainerColumn { name: string; dtype: string; offset: number; count: number }
interface Header { columns: ContainerColumn[]; [k: string]: unknown }

const SIZE: Record<string, number> = { '<u1': 1, '<u2': 2, '<u4': 4, '<i4': 4 };
export const SHAPE_COLUMNS = ['sh', 'sh_off', 'sh_pts'];

export function readContainer(bytes: Uint8Array): { magic: string; header: Header; column: (name: string) => Uint8Array | undefined } {
  const magic = String.fromCharCode(...bytes.subarray(0, 4));
  const hl = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + hl))) as Header;
  const column = (name: string) => {
    const c = header.columns.find((x) => x.name === name);
    return c ? bytes.subarray(c.offset, c.offset + c.count * (SIZE[c.dtype] ?? 0)) : undefined;
  };
  return { magic, header, column };
}

const pad8 = (n: number) => (n + 7) & ~7;

/** Writes a container; the header's columns are replaced by the given ones at fresh 8-aligned offsets. */
export function writeContainer(magic: string, header: Omit<Header, 'columns'>, cols: Array<{ name: string; dtype: string; count: number; data: Uint8Array }>): Uint8Array {
  if (magic.length !== 4) throw new Error('magic must be 4 characters');
  let columns: ContainerColumn[] = cols.map((c) => ({ name: c.name, dtype: c.dtype, offset: 0, count: c.count }));
  let json = '';
  // the offsets depend on the header length, which depends on the offsets: settle in a few passes
  for (let pass = 0; pass < 4; pass++) {
    json = JSON.stringify({ ...header, columns });
    let at = pad8(8 + new TextEncoder().encode(json).length);
    const next = cols.map((c) => { const o = at; at = pad8(at + c.data.byteLength); return { name: c.name, dtype: c.dtype, offset: o, count: c.count }; });
    const same = next.every((c, k) => c.offset === columns[k].offset);
    columns = next;
    if (same) break;
  }
  json = JSON.stringify({ ...header, columns });
  const head = new TextEncoder().encode(json);
  const end = columns.length ? pad8(columns[columns.length - 1].offset + cols[cols.length - 1].data.byteLength) : pad8(8 + head.length);
  const out = new Uint8Array(end);
  out.set(new TextEncoder().encode(magic), 0);
  new DataView(out.buffer).setUint32(4, head.length, true);
  out.set(head, 8);
  if (columns.length && columns[0].offset < 8 + head.length) throw new Error('header overlaps the first column');
  cols.forEach((c, k) => out.set(c.data, columns[k].offset));
  return out;
}

/** BGR1 graph -> core (BGR1 without the shape columns) and shapes (BSH1 with them). */
export function splitGraph(bytes: Uint8Array): { core: Uint8Array; shapes: Uint8Array } {
  const { magic, header, column } = readContainer(bytes);
  if (magic !== 'BGR1') throw new Error('not a BGR1 graph');
  const take = (c: ContainerColumn) => ({ name: c.name, dtype: c.dtype, count: c.count, data: column(c.name)! });
  const coreCols = header.columns.filter((c) => !SHAPE_COLUMNS.includes(c.name)).map(take);
  const shapeCols = header.columns.filter((c) => SHAPE_COLUMNS.includes(c.name)).map(take);
  if (shapeCols.length !== SHAPE_COLUMNS.length) throw new Error('graph has no shape columns');
  const { columns: _c, ...rest } = header;
  void _c;
  const core = writeContainer('BGR1', { ...rest, parts: 'inti' }, coreCols);
  const shapes = writeContainer('BSH1', { format: 'BSH1', region: rest.region, geometry: rest.geometry, m: rest.m, shapes: rest.shapes }, shapeCols);
  return { core, shapes };
}
