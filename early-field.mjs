// Early field requests for /peta (F1-54). The page's JavaScript is done after about 13 s on a slow 3G link, and only
// then did the region manifest and the PMTiles header start (2 s of latency each, in a row with what follows). A small
// inline script in peta.html starts both with the HTML instead; the app takes them once (source.ts, __fieldEarly) and
// falls back to its own requests when they fail.
// F1-57: a route link (?rute=) starts the region's core walking graph instead, the biggest file of a first route; it is
// cacheable (max-age 1 day), so the route worker's own request for the same URL is served from that download.

/**
 * Field regions (name, geometry and bounds [[south, west], [north, east]]) as written in src/lib/field/source.ts, so the
 * inline script and the app cannot disagree (tests/early-field.test.ts compares the result with FIELD_REGIONS).
 */
export function parseRegions(sourceText) {
  const out = [];
  const num = String.raw`(-?\d+(?:\.\d+)?)`;
  const re = new RegExp(String.raw`\{\s*name:\s*'([a-z_]+)',\s*label:\s*'[^']*',\s*geometry:\s*'([0-9a-z-]+)',\s*bounds:\s*\[\[${num},\s*${num}\],\s*\[${num},\s*${num}\]\]`, 'g');
  for (const m of sourceText.matchAll(re)) out.push({ name: m[1], geometry: m[2], bounds: [[Number(m[3]), Number(m[4])], [Number(m[5]), Number(m[6])]] });
  return out;
}

/**
 * The inline script, or '' when the build has no CDN field base (a local build serves /field from the dev server).
 * mode 'peta' (peta.html): the region the page opens in exactly as ExploreMapPage does (?wilayah, else the first
 * region). mode 'app' (index.html, every SPA route): only on / (as /peta) and /home, where the region follows
 * chooseStartRegion (?wilayah, the region last used on this device, Kota Bogor for a WIB phone, else the first);
 * any other path asks for nothing. School links ask for nothing. A route link on /peta (mode 'peta') asks only for the
 * core walking graph of the region holding both ends, chosen as WalkRouteLayer does (the first region whose bounds hold
 * the start, and only when they also hold the end); the map field waits for the route there anyway (F1-53). The header
 * request mirrors pmtiles FetchSource: bytes 0-16383, a weak ETag dropped.
 */
export function earlyFieldScript(base, regions, mode = 'peta') {
  if (!/^https:\/\/[^\s"'<>]+$/.test(base || '') || !regions.length) return '';
  const R = JSON.stringify(regions);
  const B = JSON.stringify(base.replace(/\/$/, ''));
  const pick = mode === 'app'
    ? `var p=location.pathname,s=null,z='';if(p==='/'){r=f(w)||R[0]}else if(p==='/home'){try{s=localStorage.getItem('breeva_field_region')}catch(_){}`
      + `try{z=Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch(_){}r=f(w)||f(s)||((z==='Asia/Jakarta'||z==='Asia/Pontianak')?f('kota_bogor'):null)||R[0]}else return;`
    : `r=f(w)||R[0];`;
  const route = mode === 'peta'
    ? `if(q.has('rute')){var u=(q.get('rute')||'').split('~'),P=[];for(var i=0;i<u.length;i++){var c=u[i].split(','),la=+c[0],ln=+c[1];`
      + `if(c.length===2&&c[0]!==''&&c[1]!==''&&isFinite(la)&&isFinite(ln))P.push([la,ln])}if(u.length!==2||P.length!==2)return;`
      + `var n=function(g,p){return g[0][0]<=p[0]&&p[0]<=g[1][0]&&g[0][1]<=p[1]&&p[1]<=g[1][1]};`
      + `for(var j=0;j<R.length;j++)if(n(R[j].bounds,P[0])){if(n(R[j].bounds,P[1]))fetch(b+'/graphs/'+R[j].geometry+'/'+R[j].name+'_inti.bin').catch(function(){});return}return}`
    : `if(q.has('rute'))return;`;
  return `<script>(function(){try{var q=new URLSearchParams(location.search),R=${R},b=${B};${route}if(q.has('sekolah'))return;`
    + `var w=q.get('wilayah'),r=null;function f(n){for(var i=0;i<R.length;i++)if(R[i].name===n)return R[i];return null}${pick}`
    + `var m=fetch(b+'/v/'+r.name+'/manifest.json',{cache:'no-cache'}).then(function(x){if(!x.ok)throw new Error('manifest '+x.status);return x.json()});`
    + `var h=fetch(b+'/tiles/'+r.geometry+'/'+r.name+'.pmtiles',{headers:{range:'bytes=0-16383'}}).then(function(x){if(x.status!==206)throw new Error('header '+x.status);`
    + `var e=x.headers.get('ETag');if(e&&e.indexOf('W/')===0)e=null;return x.arrayBuffer().then(function(d){return{data:d,etag:e||undefined,`
    + `cacheControl:x.headers.get('Cache-Control')||undefined,expires:x.headers.get('Expires')||undefined}})});`
    + `m.catch(function(){});h.catch(function(){});window.__fieldEarly={base:b,name:r.name,manifest:m,header:h}}catch(_){}})();</script>`;
}

/**
 * Puts a snippet at the start of <head>, right after <meta charset> (which must stay in the first 1024 bytes).
 * An inline script placed after a stylesheet waits for that stylesheet before it runs and holds the parser: on slow
 * 3G the early requests then started only after index.css (10.2 s) and the prerendered text appeared at the same time
 * (F1-56, 18 Nov). Throws when there is no charset meta to anchor to.
 */
export function atHeadStart(html, snippet) {
  const m = html.match(/<meta charset="[^"]*"\s*\/?>/i);
  if (!m) throw new Error('[prerender] no <meta charset> in the template');
  const at = m.index + m[0].length;
  return `${html.slice(0, at)}\n    ${snippet}${html.slice(at)}`;
}
