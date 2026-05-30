// Per-route SEO metadata using React 19's native document-metadata hoisting (no library needed —
// React 19 hoists <title>/<meta>/<link> rendered anywhere into <head> and dedupes title/description).
// Googlebot renders JS so it indexes these per-route; static site-level OG stays in index.html for
// non-JS social crawlers. Drop <Seo/> at the top of each PUBLIC page.

const SITE = 'https://breeva.site';

export function Seo({ title, description, path }: { title: string; description: string; path: string }) {
  const url = `${SITE}${path}`;
  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />
    </>
  );
}

/** Render inside auth-gated routes so crawlers don't index private app pages. */
export function NoIndex() {
  return <meta name="robots" content="noindex, nofollow" />;
}

export default Seo;
