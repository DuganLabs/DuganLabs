/**
 * Keep `?slug=` on a *.workers.dev preview, so the preview can be clicked
 * through.
 *
 * On a workers.dev host there is no subdomain to read the tenant from, so
 * index.ts takes it from `?slug=` (GP-023). Every page, though, links and
 * posts to bare same-site paths ("/services", "/quote/start"), and every
 * quote redirect is a bare "/quote/s/<id>" — so the first click on staging
 * dropped the slug and landed on the "Tenant Site Preview" page. This adds
 * the slug back on the way out: to same-site `href`/`action` attributes in
 * HTML, and to a same-site `Location`. Static assets are left alone; they
 * are served before tenant resolution and their URLs are cache keys.
 *
 * Only ever called for a workers.dev host with `?slug=` (see index.ts), so a
 * real tenant hostname never sees a slug in its links.
 */
const ASSET_PATH =
  /^\/(css|js|fonts|img|images|favicon|brand|robots\.txt|sitemap\.xml)\b/;

export function withSlug(path: string, slug: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) return path;
  if (ASSET_PATH.test(path)) return path;
  const hashAt = path.indexOf('#');
  const base = hashAt === -1 ? path : path.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : path.slice(hashAt);
  if (/[?&]slug=/.test(base)) return path;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}slug=${encodeURIComponent(slug)}${hash}`;
}

export async function carryPreviewSlug(
  res: Response,
  slug: string,
): Promise<Response> {
  const location = res.headers.get('Location');
  const isHtml = (res.headers.get('Content-Type') ?? '').includes('text/html');
  if (!isHtml && !(location && location.startsWith('/'))) return res;

  const headers = new Headers(res.headers);
  if (location) headers.set('Location', withSlug(location, slug));
  if (!isHtml) {
    return new Response(res.body, { status: res.status, headers });
  }
  headers.delete('Content-Length');
  const html = (await res.text()).replace(
    /(\s(?:href|action))="(\/[^"]*)"/g,
    (_m, attr: string, path: string) =>
      `${attr}="${withSlug(path, slug).replace(/&(?!amp;)/g, '&amp;')}"`,
  );
  return new Response(html, { status: res.status, headers });
}
