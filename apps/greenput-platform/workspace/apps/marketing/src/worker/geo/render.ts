/**
 * Guide HTML in the v4 section vocabulary. Copy lives in guides.ts.
 * No page stylesheet of its own: the document shell loads gp4.css.
 */

import { AI_DISCLOSURE } from './entity.js';
import type { GuidePage } from './guides.js';

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const chev = '<svg aria-hidden="true"><use href="#i-chev"/></svg>';
const icon = (id: string): string =>
  `<svg aria-hidden="true"><use href="#${id}"/></svg>`;

/** The jobs-calendar crop: the week grid, with the price panel left out of frame. */
const GUIDES_HERO = `<figure><img src="/screens/scheduling-week.webp" alt="The Jobs calendar in Greenput: a week grid with six scheduled jobs placed across Monday to Friday" width="1600" height="1000" fetchpriority="high" decoding="async"></figure>`;

const GUIDE_ICONS = [
  'i-pin',
  'i-bolt',
  'i-wrench',
  'i-plug',
  'i-chart',
  'i-layers',
  'i-home',
  'i-tag',
] as const;

function hrefFor(href: string): string {
  if (href.startsWith('/') || href.startsWith('https://www.cslb.ca.gov')) {
    return href;
  }
  throw new Error(`guide link is not an allowed href: ${href}`);
}

function prose(headingId: string, heading: string, inner: string): string {
  return `<section data-density="spacious" aria-labelledby="${headingId}"><header><h2 id="${headingId}">${escapeHtml(heading)}</h2></header><article variant="flat">${inner}</article></section>`;
}

function sectionHtml(
  headingId: string,
  heading: string,
  paragraphs: string[],
  bullets: string[] | undefined,
  links: GuidePage['sections'][number]['links'],
): string {
  const paras = paragraphs
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join('\n');
  const list = bullets
    ? `<ul>\n${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('\n')}\n</ul>`
    : '';
  const linkList = links
    ? `<ul>\n${links
        .map((item) => {
          const href = hrefFor(item.href);
          const external = href.startsWith('https://');
          const rel = external ? ' rel="noopener noreferrer"' : '';
          return `<li><a href="${escapeHtml(href)}"${rel}>${escapeHtml(item.label)}</a> — ${escapeHtml(item.note)}</li>`;
        })
        .join('\n')}\n</ul>`
    : '';
  return prose(headingId, heading, `${paras}\n${list}\n${linkList}`);
}

/**
 * The index is a directory of the articles. The articles themselves stay
 * prose: this pass does not restyle them.
 */
function renderGuidesIndex(guide: GuidePage): string {
  const [start, danger, ...rest] = guide.sections;
  if (!start || !danger || rest.length > 0 || !start.links) {
    throw new Error('guides index sections changed');
  }
  const hero = `<section id="${escapeHtml(guide.route)}" data-sec="s1" data-density="spacious" aria-labelledby="${escapeHtml(guide.route)}-heading"><header><h1 id="${escapeHtml(guide.route)}-heading">${escapeHtml(guide.h1)}</h1><p>${escapeHtml(guide.directAnswer)}</p></header>${GUIDES_HERO}</section>`;
  const cards = start.links
    .map((item, index) => {
      const href = hrefFor(item.href);
      return `<li><article variant="plain">${icon(GUIDE_ICONS[index] ?? 'i-doc')}<h3><a href="${escapeHtml(href)}">${escapeHtml(item.label)}</a></h3><p> — ${escapeHtml(item.note)}</p></article></li>`;
    })
    .join('');
  const startSection = `<section data-density="spacious" aria-labelledby="${guide.route}-s0"><header><h2 id="${guide.route}-s0">${escapeHtml(start.heading)}</h2><p>${escapeHtml(start.paragraphs[0] ?? '')}</p></header><ul>${cards}</ul></section>`;
  const dangerSection = `<section data-density="spacious" aria-labelledby="${guide.route}-s1"><header><h2 id="${guide.route}-s1">${escapeHtml(danger.heading)}</h2><p>${escapeHtml(danger.paragraphs[0] ?? '')}</p></header></section>`;
  return `${hero}\n${startSection}\n${dangerSection}\n${faqBlock(guide)}\n${disclosureBlock(guide)}`;
}

function faqBlock(guide: GuidePage): string {
  if (guide.faqs.length === 0) return '';
  return `<section data-density="spacious" aria-labelledby="${guide.route}-faq"><header><h2 id="${guide.route}-faq">Frequently asked questions</h2></header>${guide.faqs
    .map(
      (item) =>
        `<details><summary>${chev}${escapeHtml(item.question)}</summary><p>${escapeHtml(item.answer)}</p></details>`,
    )
    .join('')}</section>`;
}

function disclosureBlock(guide: GuidePage): string {
  return sectionHtml(
    `${guide.route}-disclosure`,
    'If you arrived from an AI assistant',
    [AI_DISCLOSURE],
    undefined,
    undefined,
  );
}

/** Already-rendered main content for one guide. No template syntax. */
export function renderGuide(guide: GuidePage): string {
  if (guide.route === 'guides') return renderGuidesIndex(guide);
  const hero = `<section id="${escapeHtml(guide.route)}" data-sec="s1" data-density="spacious" aria-labelledby="${escapeHtml(guide.route)}-heading"><header><h1 id="${escapeHtml(guide.route)}-heading">${escapeHtml(guide.h1)}</h1><p>${escapeHtml(guide.directAnswer)}</p></header></section>`;
  const sections = guide.sections
    .map((section, index) =>
      sectionHtml(
        `${guide.route}-s${index}`,
        section.heading,
        section.paragraphs,
        section.bullets,
        section.links,
      ),
    )
    .join('\n');
  const howTo = guide.howTo
    ? prose(
        `${guide.route}-howto`,
        guide.howTo.name,
        `<p>${escapeHtml(guide.howTo.description)}</p>
<ol>
${guide.howTo.steps
  .map(
    (step) =>
      `<li><strong>${escapeHtml(step.name)}</strong> ${escapeHtml(step.text)}</li>`,
  )
  .join('\n')}
</ol>`,
      )
    : '';
  return `${hero}\n${sections}\n${howTo}\n${faqBlock(guide)}\n${disclosureBlock(guide)}`;
}
