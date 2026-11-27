/**
 * The two measurements the responsive contract is made of, run in the page.
 *
 * Both are deliberately expressed as properties rather than as today's pixel
 * values: "the page does not scroll sideways" and "every wrapper on the page
 * spine starts on the same x as the brand". A test that froze 24px and 88px
 * would pass a redesign that moved the gutter and still fail to notice the
 * nav and the hero disagreeing.
 */
import type { Page } from '@playwright/test';

/** Widths every route is checked at. */
export const WIDTHS = [320, 390, 768, 1280] as const;

/**
 * Extra widths worth checking on top of WIDTHS: each side of every breakpoint
 * in the two stylesheets, plus the common device widths. The 768px nav
 * overflow lived entirely between two of the four headline widths and went
 * unnoticed through two passes, which is the argument for sweeping.
 */
export const BOUNDARY_WIDTHS = [
  359, 360, 375, 412, 414, 428, 480, 639, 640, 641, 719, 720, 767, 769, 800,
  833, 834, 899, 900, 901, 959, 960, 961, 1024, 1055, 1056, 1057, 1151, 1152,
  1153, 1440,
] as const;

export interface SpineRow {
  label: string;
  contentLeft: number;
  delta: number;
}

export interface Spill {
  label: string;
  left: number;
  right: number;
  text: string;
}

export interface Measurement {
  scrollWidth: number;
  innerWidth: number;
  /** > 0 means the page itself scrolls sideways. */
  overflow: number;
  /** null when the page has no nav (e.g. the standalone proposal page). */
  brandLeft: number | null;
  /** Spine members whose content edge does not match the brand's. */
  spineDrift: SpineRow[];
  /** Boxes that stick out of the viewport and are not inside a scroll region. */
  spills: Spill[];
  /** Boxes whose own content is clipped with no way to scroll to it. */
  unreachable: Spill[];
  /** Header, toolbar, and nav rows whose children do not share a vertical center. */
  toolbarDrift: ToolbarDrift[];
}

export interface ToolbarDrift {
  organism: string;
  label: string;
  delta: number;
}

/**
 * Measures one already-loaded page.
 *
 * `spineSelector` is the selector list of the stylesheet's own page-spine
 * rule, passed in so the test asserts against the mechanism the CSS actually
 * declares rather than a second copy of the membership list.
 * `brandSelector` is the element whose left edge everything lines up on.
 */
export function measure(
  page: Page,
  spineSelector: string,
  brandSelector: string,
): Promise<Measurement> {
  return page.evaluate(
    ({ spineSelector, brandSelector }) => {
      const de = document.documentElement;
      const vw = window.innerWidth;

      const labelFor = (el: Element): string => {
        const bn = el.getAttribute('data-bn');
        return (
          el.tagName.toLowerCase() +
          (bn ? `[data-bn="${bn}"]` : '') +
          (el.id ? `#${el.id}` : '')
        );
      };

      /**
       * Wide content is allowed to be wider than the viewport as long as it
       * scrolls inside its own container — that is the house rule, and it is
       * why /technology's 848px <pre> and its comparison table are correct.
       * So anything inside a scroll region (or inside a deliberately clipped
       * one, like the visually-hidden honeypot) is not a page-level defect.
       */
      const insideScrollRegion = (el: Element): boolean => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip')
            return true;
        }
        return false;
      };

      /**
       * An ancestor that swallows overflow and offers no way to scroll to it.
       * `auto`/`scroll` stop the walk: past one of those the content is
       * reachable, which is the whole distinction between a wide table that
       * works and a wide table whose last column cannot be read.
       */
      const clippedByAnAncestor = (el: Element): boolean => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === 'hidden' || o === 'clip') return true;
          if (o === 'auto' || o === 'scroll') return false;
        }
        return false;
      };

      const contentLeft = (el: Element): number => {
        const box = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return (
          box.left +
          parseFloat(cs.paddingLeft || '0') +
          parseFloat(cs.borderLeftWidth || '0')
        );
      };

      const brand = document.querySelector(brandSelector);
      const brandLeft = brand
        ? +brand.getBoundingClientRect().left.toFixed(1)
        : null;

      const spineDrift: {
        label: string;
        contentLeft: number;
        delta: number;
      }[] = [];
      if (brandLeft !== null) {
        for (const el of document.querySelectorAll(spineSelector)) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if (el.getBoundingClientRect().width < 1) continue;
          const cl = +contentLeft(el).toFixed(1);
          const delta = +(cl - brandLeft).toFixed(1);
          // Sub-pixel rounding from a centred max-width is not drift.
          if (Math.abs(delta) > 0.5)
            spineDrift.push({ label: labelFor(el), contentLeft: cl, delta });
        }
      }

      const spills: {
        label: string;
        left: number;
        right: number;
        text: string;
      }[] = [];
      const unreachable: {
        label: string;
        left: number;
        right: number;
        text: string;
      }[] = [];
      for (const el of document.querySelectorAll('body *')) {
        const box = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ');

        if (box.width > 0 || box.height > 0) {
          // Only the right edge is checked, and only in the inline-start
          // direction these sites lay out in. A box parked at
          // `inset-inline-start: -9999px` is the standard way to hide a
          // honeypot and adds nothing to the document's scroll width; the
          // page-level scrollWidth assertion is what would catch a genuine
          // leftward escape.
          const viewportPositioned = cs.position === 'fixed';
          if (
            !viewportPositioned &&
            !insideScrollRegion(el) &&
            box.right > vw + 0.5
          ) {
            spills.push({
              label: labelFor(el),
              left: +box.left.toFixed(1),
              right: +box.right.toFixed(1),
              text: text.slice(0, 48),
            });
          }
        }

        // Content wider than its own box, no scroll mechanism of its own, and
        // an ancestor that clips: the overflow is unreachable, which is worse
        // than a scrollbar. This is the defect the proposal page's line-item
        // table had — the Total column simply could not be read at 320px.
        //
        // An element that clips *itself* is exempt: `overflow: hidden` on the
        // element is a deliberate statement, and it is how the visually-hidden
        // honeypot field on /contact is built.
        if (
          cs.overflowX === 'visible' &&
          clippedByAnAncestor(el) &&
          el.clientWidth > 0 &&
          el.scrollWidth > el.clientWidth + 1
        ) {
          unreachable.push({
            label: labelFor(el),
            left: el.clientWidth,
            right: el.scrollWidth,
            text: text.slice(0, 48),
          });
        }
      }

      const centerY = (node: Element): number => {
        const box = node.getBoundingClientRect();
        return (box.top + box.bottom) / 2;
      };

      const toolbarDrift: {
        organism: string;
        label: string;
        delta: number;
      }[] = [];
      for (const el of document.querySelectorAll(
        'header, nav, menu, [role="toolbar"]',
      )) {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const flexRow =
          (cs.display === 'flex' || cs.display === 'inline-flex') &&
          (cs.flexDirection === 'row' || cs.flexDirection === 'row-reverse');
        if (!flexRow) continue;
        const own = el.getBoundingClientRect();
        if (own.width < 1 || own.height < 1) continue;
        const kids = [...el.children].filter((child) => {
          const childStyle = getComputedStyle(child);
          if (
            childStyle.display === 'none' ||
            childStyle.visibility === 'hidden' ||
            childStyle.position === 'absolute' ||
            childStyle.position === 'fixed'
          ) {
            return false;
          }
          const box = child.getBoundingClientRect();
          return box.width >= 1 && box.height >= 1;
        });
        if (kids.length < 2) continue;
        const points: { label: string; y: number }[] = kids.map((child) => ({
          label: labelFor(child),
          y: centerY(child),
        }));
        if (el.getAttribute('data-bn') !== 'bn-tab-bar') {
          for (const mark of el.querySelectorAll('svg, img')) {
            if (mark.closest('[data-bn="bn-tab-bar"]')) continue;
            const markStyle = getComputedStyle(mark);
            if (
              markStyle.display === 'none' ||
              markStyle.visibility === 'hidden'
            )
              continue;
            const box = mark.getBoundingClientRect();
            if (box.width < 1 || box.height < 1) continue;
            points.push({ label: labelFor(mark), y: centerY(mark) });
          }
        }
        const ref = points[0]?.y ?? 0;
        for (const point of points) {
          const delta = +(point.y - ref).toFixed(2);
          if (Math.abs(delta) > 1) {
            toolbarDrift.push({
              organism: labelFor(el),
              label: point.label,
              delta,
            });
          }
        }
      }

      return {
        scrollWidth: de.scrollWidth,
        innerWidth: vw,
        overflow: de.scrollWidth - vw,
        brandLeft,
        spineDrift,
        spills,
        unreachable,
        toolbarDrift,
      };
    },
    { spineSelector, brandSelector },
  );
}

/** Human-readable failure text, so a red build says what moved and by how much. */
export function explain(route: string, width: number, m: Measurement): string {
  const lines = [`${route} @${width}px`];
  if (m.overflow > 0)
    lines.push(
      `  page scrolls sideways: scrollWidth ${m.scrollWidth} vs innerWidth ${m.innerWidth} (+${m.overflow}px)`,
    );
  for (const s of m.spills)
    lines.push(
      `  outside the viewport: ${s.label} spans ${s.left} -> ${s.right} "${s.text}"`,
    );
  for (const u of m.unreachable)
    lines.push(
      `  clipped with no scroll: ${u.label} content ${u.right} inside ${u.left} "${u.text}"`,
    );
  for (const d of m.spineDrift)
    lines.push(
      `  off the spine: ${d.label} content starts at ${d.contentLeft}, brand at ${m.brandLeft} (${d.delta > 0 ? '+' : ''}${d.delta}px)`,
    );
  for (const d of m.toolbarDrift)
    lines.push(
      `  off the toolbar center: ${d.organism} → ${d.label} ${d.delta > 0 ? '+' : ''}${d.delta}px`,
    );
  return lines.join('\n');
}
