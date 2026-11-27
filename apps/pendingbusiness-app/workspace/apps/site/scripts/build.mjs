import { build } from 'esbuild';
import { mkdir, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineFavicon } from '@basenative/favicon';
import { renderPartials } from './partials.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(here, '../../..');
const srcDir = resolve(here, '../src');
const outDir = resolve(root, 'dist/site');

await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [
    resolve(srcDir, 'main.ts'),
    resolve(srcDir, 'settings.ts'),
    resolve(srcDir, 'account.ts'),
    resolve(srcDir, 'login.ts'),
    resolve(srcDir, 'welcome.ts'),
  ],
  outdir: outDir,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  platform: 'browser',
  minify: true,
  sourcemap: true,
  logLevel: 'info',
});

// Separate CSS build: styles.css now `@import`s '@basenative/components/css'
// (see the comment at the top of that file), so it needs esbuild's bundler
// to resolve/inline the node_modules import — a plain copyFile can't. Kept
// as its own `build()` call (rather than added to the entryPoints above) so
// a CSS-specific failure is unambiguous and unrelated to the JS bundle.
await build({
  entryPoints: [resolve(srcDir, 'styles.css')],
  outdir: outDir,
  bundle: true,
  minify: true,
  sourcemap: true,
  logLevel: 'info',
});

async function copyTree(from, to) {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) await copyTree(src, dst);
    else await copyFile(src, dst);
  }
}

// Pages are rendered, not copied: each `<!--bn:name-->` marker is replaced
// with the matching fragment from scripts/partials.mjs, which builds it with
// @basenative/components' renderInput / renderSelect / renderButton. A page
// with no marker comes through byte-identical, so this stays a substitution
// step rather than a template engine.
for (const page of [
  'index.html',
  'app.html',
  'settings.html',
  'account.html',
  'login.html',
  'welcome.html',
]) {
  const html = await readFile(resolve(srcDir, page), 'utf8');
  await writeFile(resolve(outDir, page), renderPartials(html, page), 'utf8');
}
// styles.css is emitted by the esbuild CSS build above, not copied — it now
// has an `@import` that only esbuild's bundler can resolve.

const favicon = defineFavicon('pendingbusiness');
await writeFile(resolve(outDir, 'favicon.svg'), favicon.svg, 'utf8');
await writeFile(resolve(outDir, 'apple-touch-icon.svg'), favicon.apple, 'utf8');
await writeFile(resolve(outDir, 'maskable.svg'), favicon.maskable, 'utf8');

// SVG-only manifest. `@basenative/favicon`'s `manifest()` helper hardcodes
// PNG icon entries (apple-touch-icon.png, icon-192.png, icon-512.png,
// maskable.png) but `defineFavicon` only emits SVGs — so the package's
// manifest would 404 every icon. Track upstream; until then, we synthesize
// a manifest pointed at the SVGs we actually deploy.
const manifest = {
  name: 'PendingBusiness',
  short_name: 'PendingBiz',
  description: 'Treasury operating system for one — float, debt, tax.',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  theme_color: '#0F0E0C',
  background_color: '#0F0E0C',
  icons: [
    { src: '/favicon.svg', type: 'image/svg+xml', sizes: 'any', purpose: 'any' },
    { src: '/apple-touch-icon.svg', type: 'image/svg+xml', sizes: 'any', purpose: 'any' },
    { src: '/maskable.svg', type: 'image/svg+xml', sizes: 'any', purpose: 'maskable' },
  ],
};
await writeFile(resolve(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

try {
  await copyTree(resolve(srcDir, 'public'), outDir);
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

console.log(`built -> ${outDir}`);
