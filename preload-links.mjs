// Preload tags for a prerendered route (F1-51). /peta loads its page and its map lazily, one level after the other:
// entry -> ExploreMapPage -> LeafletMap. On a slow 3G link (2 s per request) that chain alone took until 17.9 s before
// the map code ran (lambat3g_urutan_2026-11-18.json). Listing the files in the route's HTML starts them all at once.

/**
 * The static-import closure of the given source modules in the Vite build manifest (.vite/manifest.json): JS chunks in
 * dependency order and their CSS, minus files the HTML already loads. Dynamic imports are not followed. Throws when a
 * source is missing from the manifest, so a renamed page fails the build instead of silently losing its preloads.
 */
export function preloadFiles(manifest, sources, already = new Set()) {
  const js = [];
  const css = [];
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const e = manifest[key];
    if (!e) throw new Error(`[preload] ${key} is not in the build manifest`);
    for (const k of e.imports ?? []) visit(k);
    if (!already.has(e.file) && !js.includes(e.file)) js.push(e.file);
    for (const c of e.css ?? []) if (!already.has(c) && !css.includes(c)) css.push(c);
  };
  for (const s of sources) visit(s);
  return { js, css };
}

/** Files under /assets/ that an HTML document already references. */
export function referencedAssets(html) {
  return new Set([...html.matchAll(/["'(]\/(assets\/[^"'()\s]+)/g)].map((m) => m[1]));
}

/**
 * Link tags: modulepreload for JS, preload as style for CSS (not a stylesheet: that would block the first paint), and
 * preload as script for classic scripts the page injects itself (no crossorigin, like the script tag it will match).
 */
export function preloadTags({ js, css }, scripts = []) {
  return [
    ...js.map((f) => `<link rel="modulepreload" crossorigin href="/${f}">`),
    ...css.map((f) => `<link rel="preload" as="style" crossorigin href="/${f}">`),
    ...scripts.map((s) => `<link rel="preload" as="script" href="${s}">`),
  ].join('\n    ');
}

/**
 * For the SPA shell (index.html, served for every app route): an inline script that adds the preload links of the
 * page being opened, only for the paths listed (X-W7: on /home the map code arrived through three lazy levels, the
 * last at 18.5 s on slow 3G, lambat3g_home_2026-11-18.json). Other routes download nothing extra.
 * byPath: { '/home': { js, css, scripts } }.
 */
export function appPreloadScript(byPath) {
  const P = JSON.stringify(byPath);
  return `<script>(function(){try{var P=${P},l=P[location.pathname];if(!l)return;var h=document.head,e,i;`
    + `function add(rel,as,href,co){e=document.createElement('link');e.rel=rel;if(as)e.as=as;if(co)e.crossOrigin='';e.href=href;h.appendChild(e)}`
    + `for(i=0;i<l.js.length;i++)add('modulepreload','','/'+l.js[i],1);for(i=0;i<l.css.length;i++)add('preload','style','/'+l.css[i],1);`
    + `for(i=0;i<l.scripts.length;i++)add('preload','script',l.scripts[i],0)}catch(_){}})();</script>`;
}
