/**
 * Serves a Cloudflare Worker's `fetch` handler over a real HTTP port, in
 * process, with no wrangler and no deploy.
 *
 * Why not point the browser at staging: the accessibility and Lighthouse jobs
 * already do that, and staging reflects whatever last merged, never the
 * commit under review — so those jobs are canaries, not gates (see the long
 * comment on the `accessibility` job in .github/workflows/ci.yml). The whole
 * value of the responsive contract is that it gates *this* PR, which means it
 * has to render this PR's own worker source. Importing the handler is the
 * cheapest way to do that: Playwright transpiles the TypeScript and resolves
 * the workspace path aliases, Node 22 supplies Request/Response/crypto, and
 * apps/marketing's GET routes never touch `env`.
 */
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, normalize } from 'node:path';

/** The shape of a Worker module's default export, narrowed to what we call. */
export interface FetchHandler {
  fetch(
    request: Request,
    env: unknown,
    ctx: unknown,
  ): Promise<Response> | Response;
}

export interface WorkerServer {
  /** e.g. `http://127.0.0.1:41234` — no trailing slash. */
  origin: string;
  close(): Promise<void>;
}

/**
 * `origin` is the URL the handler sees, not the one the browser uses. Workers
 * that resolve a tenant from the hostname (apps/tenant-site) need a real
 * hostname; the browser still connects to 127.0.0.1.
 */
function assetType(file: string): string {
  if (file.endsWith('.webp')) return 'image/webp';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  if (file.endsWith('.png')) return 'image/png';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.ttf')) return 'font/ttf';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  return 'application/octet-stream';
}

export async function serveWorker(
  handler: FetchHandler,
  options: { hostname?: string; env?: unknown; assetsDir?: string } = {},
): Promise<WorkerServer> {
  const server: Server = createServer((req, res) => {
    void (async () => {
      const host = options.hostname ?? req.headers.host ?? '127.0.0.1';
      const url = `https://${host}${req.url ?? '/'}`;
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) for (const one of v) headers.append(k, one);
      }
      const method = req.method ?? 'GET';
      if (
        (method === 'GET' || method === 'HEAD') &&
        options.assetsDir &&
        (req.url ?? '').startsWith('/')
      ) {
        // Static files the Worker does not embed: product screenshots, and
        // the v4 stylesheet and Inter file. A miss falls through to fetch.
        const root = normalize(options.assetsDir);
        const file = normalize(
          join(root, (req.url ?? '').slice(1).split('?')[0] ?? ''),
        );
        if (file.startsWith(root)) {
          try {
            const buf = await readFile(file);
            res.statusCode = 200;
            res.setHeader('content-type', assetType(file));
            res.end(method === 'HEAD' ? undefined : buf);
            return;
          } catch {
            // Missing files fall through to the worker's own 404.
          }
        }
      }
      const request = new Request(url, {
        method,
        headers,
        body:
          method === 'GET' || method === 'HEAD' || chunks.length === 0
            ? undefined
            : Buffer.concat(chunks),
      });

      let response: Response;
      try {
        response = await handler.fetch(
          request,
          options.env ?? ({} as unknown),
          {
            waitUntil: () => undefined,
            passThroughOnException: () => undefined,
          },
        );
      } catch (error) {
        res.statusCode = 500;
        res.end(String(error));
        return;
      }

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        // The page is served over plain http here, so leaving this in would
        // make the browser upgrade every same-origin subresource to https and
        // silently drop the stylesheet. Nothing else about the response is
        // touched — this is the one directive that is a statement about the
        // transport rather than about the page.
        if (key.toLowerCase() === 'content-security-policy') {
          value = value.replace(/;?\s*upgrade-insecure-requests/i, '');
        }
        res.setHeader(key, value);
      });
      const body = Buffer.from(await response.arrayBuffer());
      res.end(body);
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
