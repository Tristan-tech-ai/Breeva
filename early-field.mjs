// Early field requests for /peta (F1-54). The page's JavaScript is done after about 13 s on a slow 3G link, and only
// then did the region manifest and the PMTiles header start (2 s of latency each, in a row with what follows). A small
// inline script in peta.html starts both with the HTML instead; the app takes them once (source.ts, __fieldEarly) and
// falls back to its own requests when they fail.

/**
 * Field regions (name and geometry) as written in src/lib/field/source.ts, so the inline script and the app cannot
 * disagree (tests/early-field.test.ts compares the result with FIELD_REGIONS).
 */
export function parseRegions(sourceText) {
  const out = [];
  for (const m of sourceText.matchAll(/\{\s*name:\s*'([a-z_]+)',\s*label:\s*'[^']*',\s*geometry:\s*'([0-9a-z-]+)'/g)) out.push({ name: m[1], geometry: m[2] });
  return out;
}

/**
 * The inline script, or '' when the build has no CDN field base (a local build serves /field from the dev server).
 * mode 'peta' (peta.html): the region the page opens in exactly as ExploreMapPage does (?wilayah, else the first
 * region). mode 'app' (index.html, every SPA route): only on / (as /peta) and /home, where the region follows
 * chooseStartRegion (?wilayah, the region last used on this device, Kota Bogor for a WIB phone, else the first);
 * any other path asks for nothing. Route and school links ask for nothing (their region and bandwidth belong to the
 * route). The header request mirrors pmtiles FetchSource: bytes 0-16383, a weak ETag dropped.
 */
export function earlyFieldScript(base, regions, mode = 'peta') {
  if (!/^https:\/\/[^\s"'<>]+$/.test(base || '') || !regions.length) return '';
  const R = JSON.stringify(regions);
  const B = JSON.stringify(base.replace(/\/$/, ''));
  const pick = mode === 'app'
    ? `var p=location.pathname,s=null,z='';if(p==='/'){r=f(w)||R[0]}else if(p==='/home'){try{s=localStorage.getItem('breeva_field_region')}catch(_){}`
      + `try{z=Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch(_){}r=f(w)||f(s)||((z==='Asia/Jakarta'||z==='Asia/Pontianak')?f('kota_bogor'):null)||R[0]}else return;`
    : `r=f(w)||R[0];`;
  return `<script>(function(){try{var q=new URLSearchParams(location.search);if(q.has('rute')||q.has('sekolah'))return;`
    + `var R=${R},w=q.get('wilayah'),r=null;function f(n){for(var i=0;i<R.length;i++)if(R[i].name===n)return R[i];return null}${pick}var b=${B};`
    + `var m=fetch(b+'/v/'+r.name+'/manifest.json',{cache:'no-cache'}).then(function(x){if(!x.ok)throw new Error('manifest '+x.status);return x.json()});`
    + `var h=fetch(b+'/tiles/'+r.geometry+'/'+r.name+'.pmtiles',{headers:{range:'bytes=0-16383'}}).then(function(x){if(x.status!==206)throw new Error('header '+x.status);`
    + `var e=x.headers.get('ETag');if(e&&e.indexOf('W/')===0)e=null;return x.arrayBuffer().then(function(d){return{data:d,etag:e||undefined,`
    + `cacheControl:x.headers.get('Cache-Control')||undefined,expires:x.headers.get('Expires')||undefined}})});`
    + `m.catch(function(){});h.catch(function(){});window.__fieldEarly={base:b,name:r.name,manifest:m,header:h}}catch(_){}})();</script>`;
}
