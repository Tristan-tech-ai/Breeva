/**
 * Parameters the search proxy may forward. Anything else (including api_key/apiKey) is dropped, and values are
 * length-capped, so the proxy cannot be used as a general relay for the paid SearchAPI and Geoapify keys.
 */

const MAX_LEN = 300;

export const SEARCHAPI_PARAMS: Record<string, readonly string[]> = {
  google_maps: ['q', 'll', 'hl', 'gl', 'page'],
  google_maps_place: ['place_id', 'data_id', 'hl', 'gl'],
  google_maps_reviews: ['place_id', 'data_id', 'sort_by', 'hl', 'next_page_token'],
  google_maps_photos: ['place_id', 'data_id', 'hl', 'next_page_token'],
};

export const GEOAPIFY_PARAMS = ['categories', 'filter', 'bias', 'limit', 'lang', 'conditions'] as const;

export type ParamCheck = { ok: true; params: URLSearchParams } | { ok: false; error: string };

function collect(query: Record<string, unknown>, allowed: readonly string[]): ParamCheck {
  const out = new URLSearchParams();
  for (const k of allowed) {
    let v = query[k];
    if (Array.isArray(v)) v = v[0];
    if (v === undefined || v === '') continue;
    if (typeof v !== 'string') return { ok: false, error: `invalid ${k}` };
    if (v.length > MAX_LEN) return { ok: false, error: `${k} too long` };
    out.set(k, v);
  }
  return { ok: true, params: out };
}

export function searchApiParams(engine: string, query: Record<string, unknown>): ParamCheck {
  const allowed = SEARCHAPI_PARAMS[engine];
  if (!allowed) return { ok: false, error: 'Invalid or missing engine parameter' };
  return collect(query, allowed);
}

export function geoapifyParams(query: Record<string, unknown>): ParamCheck {
  const r = collect(query, GEOAPIFY_PARAMS);
  if (!r.ok) return r;
  const limit = r.params.get('limit');
  if (limit !== null && !(/^\d+$/.test(limit) && Number(limit) >= 1 && Number(limit) <= 100)) return { ok: false, error: 'limit must be 1 to 100' };
  if (!r.params.get('categories')) return { ok: false, error: 'categories required' };
  return r;
}
