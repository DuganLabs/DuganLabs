/**
 * generate-og-images.mjs — per-route Open Graph cards for greenput.com.
 *
 * Renders one 1200×630 PNG per marketing route from a single SVG template
 * (ink background, the Greenput leaf mark, the route headline in Archivo
 * Black) and writes the worker module that serves them:
 * src/worker/og-images.ts, with every PNG embedded as base64.
 *
 * Why embedded base64 instead of files under apps/marketing/assets: the
 * change pipeline for this app is text-only, so binary assets cannot ride
 * along; the worker decodes and serves the bytes at /og/<slug>.png. The
 * cards are flat colour and type, so each PNG lands well under 60 KB.
 *
 * Generation-time requirements (not app dependencies): the
 * @resvg/resvg-js package, and the Archivo Bold/Black TTFs from Google
 * Fonts in a directory named by GP_OG_FONT_DIR (default ./og-fonts).
 * Headline line breaks and sizes in CARDS below are set by hand and
 * measured against Archivo Black — if you change one, re-render and
 * check the PNG still fits the card before committing. After running,
 * format the generated module with the repo's prettier config.
 *
 * Usage: node apps/marketing/scripts/generate-og-images.mjs <repoRoot> <pngOutDir>
 * (pngOutDir receives the loose PNGs for inspection; the module is the
 * deliverable.)
 */
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FONT_DIR = process.env.GP_OG_FONT_DIR ?? './og-fonts';

// The leaf mark, verbatim from the favicon the worker serves (index.ts
// FAVICON_SVG): leaf path + vein strokes on the 1024 grid.
const LEAF = `
  <path d="M820 200 C 820 200 540 180 380 340 C 220 500 200 760 200 820 C 280 820 540 800 700 640 C 860 480 820 200 820 200 Z" fill="#4EAF7C"/>
  <path d="M780 240 L 280 800" stroke="#0F0E0C" stroke-width="28" stroke-linecap="round" fill="none"/>
  <path d="M620 280 L 460 460" stroke="#0F0E0C" stroke-width="18" stroke-linecap="round" fill="none" opacity="0.7"/>
  <path d="M460 460 L 320 600" stroke="#0F0E0C" stroke-width="18" stroke-linecap="round" fill="none" opacity="0.7"/>`;

/** slug → card. `lines` are measured to fit 1040px at `size` (see report). */
export const CARDS = [
  {
    slug: 'home',
    path: '/',
    lines: ['The Operating System', 'for Trade Contractors'],
    size: 86,
    alt: 'Greenput — the operating system for trade contractors',
  },
  {
    slug: 'features',
    path: '/features',
    lines: ['Everything You Need', 'to Run Your Business'],
    size: 86,
    alt: 'Greenput features — lead management, scheduling, invoicing and the customer portal',
  },
  {
    slug: 'pricing',
    path: '/pricing',
    lines: ['Pass-through infra.', 'Outcome-tracked', 'lead delivery.'],
    size: 78,
    alt: 'Greenput pricing — pass-through infrastructure at cost, one price per delivered lead',
  },
  {
    slug: 'about',
    path: '/about',
    lines: ['Built for the Trades,', 'by People Who', 'Respect the Work'],
    size: 78,
    alt: 'About Greenput — built for the trades, by people who respect the work',
  },
  {
    slug: 'technology',
    path: '/technology',
    lines: ['We measured it, so you', "don't have to take", 'our word for it'],
    size: 72,
    alt: 'Greenput technology — measured performance of a live reference site',
  },
  {
    slug: 'contact',
    path: '/contact',
    lines: ['Get in Touch'],
    size: 96,
    alt: 'Contact Greenput — questions, demos or partnerships',
  },
  {
    slug: 'privacy',
    path: '/privacy',
    lines: ['Privacy Policy'],
    size: 96,
    alt: 'Greenput privacy policy — what we collect on greenput.com and why',
  },
  {
    slug: 'terms',
    path: '/terms',
    lines: ['Terms of Service'],
    size: 96,
    alt: 'Greenput terms of service for greenput.com',
  },
  {
    slug: 'ai',
    path: '/ai',
    lines: ['When a customer asks', 'an AI, the AI can', 'call Greenput'],
    size: 78,
    alt: 'Greenput for AI assistants — how ChatGPT and Claude find verified contractors, prices and bookings through Greenput',
  },
  {
    slug: 'investors',
    path: '/investors',
    lines: ['For Investors', 'The Operating System', 'for Trade Contractors'],
    size: 78,
    alt: 'Greenput for investors — the operating system for trade contractors; the pre-seed round, the model and the wedge',
  },
];

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function cardSvg(card) {
  const lineHeight = Math.round(card.size * 1.06);
  const firstBaseline = 330;
  const tspans = card.lines
    .map(
      (line, i) =>
        `<tspan x="80" y="${firstBaseline + i * lineHeight}">${esc(line)}</tspan>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0F0E0C"/>
  <g transform="translate(1010,430) scale(0.42)" opacity="0.05">${LEAF}</g>
  <g transform="translate(80,58) scale(0.0898)">${LEAF}</g>
  <text x="192" y="122" font-family="Archivo" font-weight="900" font-size="41" letter-spacing="7" fill="#FFFFFF">GREENPUT</text>
  <rect x="80" y="228" width="72" height="8" fill="#4EAF7C"/>
  <text font-family="Archivo" font-weight="900" font-size="${card.size}" fill="#FFFFFF">${tspans}</text>
  <text x="80" y="560" font-family="Archivo" font-weight="700" font-size="29" fill="#A79E91">greenput.com${card.path === '/' ? '' : card.path}</text>
</svg>`;
}

const [repoRoot, pngOutDir] = process.argv.slice(2);
if (!repoRoot || !pngOutDir) {
  console.error('usage: node gen-og.mjs <repoRoot> <pngOutDir>');
  process.exit(1);
}
mkdirSync(pngOutDir, { recursive: true });

const entries = [];
for (const card of CARDS) {
  const resvg = new Resvg(cardSvg(card), {
    font: {
      fontFiles: [
        join(FONT_DIR, 'Archivo-700.ttf'),
        join(FONT_DIR, 'Archivo-900.ttf'),
      ],
      loadSystemFonts: false,
      defaultFontFamily: 'Archivo',
    },
    fitTo: { mode: 'width', value: 1200 },
  });
  const png = resvg.render().asPng();
  writeFileSync(join(pngOutDir, `${card.slug}.png`), png);
  entries.push({ ...card, base64: Buffer.from(png).toString('base64') });
  console.log(`${card.slug}.png  ${png.length} bytes`);
}

const moduleBody = `/**
 * Per-route Open Graph images, generated — do not edit the base64 by hand.
 *
 * One 1200×630 card per marketing route: ink background, the leaf mark,
 * the route's headline in Archivo. The PNGs ride inside this module as
 * base64 because the change pipeline for this app is text-only; the
 * worker decodes them and serves the bytes at /og/<slug>.png (see
 * index.ts). Regenerate with apps/marketing/scripts/generate-og-images.mjs.
 */

export interface OgImage {
  /** Base64-encoded PNG, 1200×630. */
  base64: string;
  /** og:image:alt for the route — what the card says, in words. */
  alt: string;
}

/** Route name → card. 'home' is the '/' route. */
export const OG_IMAGES: Record<string, OgImage> = {
${entries
  .map(
    (e) => `  ${e.slug}: {
    alt: '${e.alt.replace(/'/g, "\\'")}',
    base64:
      '${e.base64}',
  },`,
  )
  .join('\n')}
};
`;
writeFileSync(
  join(repoRoot, 'apps/marketing/src/worker/og-images.ts'),
  moduleBody,
);
console.log('wrote apps/marketing/src/worker/og-images.ts');
