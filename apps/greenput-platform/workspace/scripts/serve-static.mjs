#!/usr/bin/env node
/**
 * Minimal static file server with SPA fallback.
 * Used in CI for E2E tests instead of `npx serve`.
 *
 * Usage: node scripts/serve-static.mjs [distDir] [port]
 */

import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, extname } from 'path';

const DIST_DIR = process.argv[2] || 'dist/apps/platform/browser';
const PORT = parseInt(process.argv[3] || '4200', 10);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

const server = createServer((req, res) => {
  const urlPath = (req.url ?? '/').split('?')[0];
  const filePath = join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath);

  try {
    const ext = extname(filePath);
    const content = readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] ?? 'application/octet-stream',
    });
    res.end(content);
  } catch {
    // SPA fallback — return index.html for any non-file path
    try {
      const content = readFileSync(join(DIST_DIR, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(content);
    } catch (err) {
      res.writeHead(500);
      res.end('Server error');
    }
  }
});

server.listen(PORT, () => {
  console.log(`Static server running at http://localhost:${PORT}`);
  console.log(`Serving: ${DIST_DIR}`);
});
