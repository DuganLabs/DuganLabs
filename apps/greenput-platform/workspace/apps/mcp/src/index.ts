import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp, type GreenputApp } from './server.js';

/**
 * Node entry — a thin adapter from node:http to the app's Web Standard
 * fetch handler (server.ts). The handler is the product; this file only
 * translates sockets to Requests and streams Responses back. On a
 * Cloudflare Worker, src/server.ts's handler deploys directly and this
 * file is not used.
 */
export function startNodeServer(
  app: GreenputApp,
  port: number,
): Promise<Server> {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(
          req.url ?? '/',
          `http://${req.headers.host ?? 'localhost'}`,
        );
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const body = Buffer.concat(chunks);

        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers.set(key, value);
          else if (Array.isArray(value)) headers.set(key, value.join(', '));
        }

        const method = req.method ?? 'GET';
        const request = new Request(url, {
          method,
          headers,
          body:
            method === 'GET' || method === 'HEAD' || body.length === 0
              ? undefined
              : body,
        });

        const response = await app.handleRequest(request);
        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        if (response.body) {
          const reader = response.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        }
        res.end();
      } catch {
        res.statusCode = 500;
        res.end('Internal Server Error');
      }
    })();
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  let app: GreenputApp;
  try {
    app = createApp(process.env);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? 8787);
  void startNodeServer(app, port).then(() => {
    console.log(
      `greenput-discovery MCP server listening on http://localhost:${port}/mcp (data_mode: mock)`,
    );
  });
}
