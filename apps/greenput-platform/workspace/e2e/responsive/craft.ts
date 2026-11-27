/**
 * Layout measurements shared by the marketing and tenant visual contracts.
 * Thresholds live here once: a route fails the same way on both sites.
 */
import type { Page } from '@playwright/test';

export interface LabelReading {
  text: string;
  lines: number;
  delta: number;
  scrollWidth: number;
  clientWidth: number;
  textAlign: string;
  textTransform: string;
  letterSpacing: string;
  whiteSpace: string;
}

export async function readCraft(
  page: Page,
  width: number,
  cover: 'home' | 'all' = 'home',
): Promise<string[]> {
  return page.evaluate(
    ({ viewport, cover }) => {
      const failures: string[] = [];
      const gp4 = document.documentElement.getAttribute('data-gp4') === '1';
      const controls = document.querySelectorAll(
        '[data-bn="bn-button"], [data-bn="bn-tab"], [data-bn="bn-brand"], [data-bn="bn-rail"] > a',
      );
      for (const el of controls) {
        const line = getComputedStyle(el).textDecorationLine;
        if (line !== 'none') {
          const name = el.getAttribute('data-bn') ?? 'link';
          const text = (el.textContent ?? '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 40);
          failures.push(
            `underline ${name} "${text}" text-decoration-line=${line}`,
          );
        }
      }

      if (
        viewport === 320 ||
        viewport === 375 ||
        viewport === 390 ||
        viewport === 768
      ) {
        const header = document.querySelector('header');
        if (!header) {
          failures.push('header missing');
        } else {
          const height = header.getBoundingClientRect().height;
          // The v4 header is the approved compact row (logo, menu, actions),
          // taller than the design-system top bar's 64px cap.
          const cap = gp4 ? 96 : 64;
          if (height > cap)
            failures.push(`header height ${height.toFixed(1)} > ${cap}`);
          for (const link of header.querySelectorAll('a')) {
            if (getComputedStyle(link).display === 'none') continue;
            const label = link.querySelector('b, strong') ?? link;
            const range = document.createRange();
            range.selectNodeContents(label);
            const lines = [...range.getClientRects()].filter(
              (rect) => rect.width > 0,
            );
            const first = lines[0];
            const wrapped =
              !!first && lines.some((rect) => rect.top >= first.bottom - 1);
            if (wrapped) {
              failures.push(
                `nav wrap "${(label.textContent ?? '').trim()}" lines=${lines.length}`,
              );
            }
          }
        }
        const shown = [
          ...document.querySelectorAll(
            '[data-bn="bn-rail"] > a:not([data-bn="bn-brand"])',
          ),
        ].filter((link) => getComputedStyle(link).display !== 'none');
        if (shown.length) {
          failures.push(
            `rail visible: ${shown.map((link) => (link.textContent ?? '').trim()).join(', ')}`,
          );
        }
        const tabs = gp4
          ? document.querySelector('nav[data-tabbar]')
          : document.querySelector('[data-bn="bn-tab-bar"]');
        // v4 shows the phone tab bar only through 760px. At 768 the header
        // menu is the nav, which is the approved breakpoint.
        const tabRequired = gp4 ? viewport <= 760 : true;
        if (
          tabRequired &&
          (!tabs || getComputedStyle(tabs).display === 'none')
        ) {
          failures.push(
            gp4
              ? 'v4 tab bar hidden on a phone width'
              : 'tab bar hidden below 1024',
          );
        }
        if (cover === 'all' || location.pathname === '/') {
          const bar = tabs?.getBoundingClientRect();
          if (bar) {
            const covered = [
              ...document.querySelectorAll(
                '#main-content > section:first-child h1, #main-content > section:first-child h2, #main-content > section:first-child h3, #main-content > section:first-child p, #main-content > section:first-child li, #main-content > section:first-child small',
              ),
            ].filter((el) => {
              if (el.closest('[data-bn="bn-tab-bar"]')) return false;
              let top = el.getBoundingClientRect().top;
              let bottom = el.getBoundingClientRect().bottom;
              const width = el.getBoundingClientRect().width;
              if (width === 0 || bottom - top === 0) return false;
              let node = el.parentElement;
              while (node) {
                const style = getComputedStyle(node);
                const clips =
                  style.overflowY === 'auto' ||
                  style.overflowY === 'scroll' ||
                  style.overflowY === 'hidden' ||
                  style.overflowY === 'clip';
                if (clips) {
                  const clip = node.getBoundingClientRect();
                  top = Math.max(top, clip.top);
                  bottom = Math.min(bottom, clip.bottom);
                }
                node = node.parentElement;
              }
              if (bottom - top < 1) return false;
              if (bottom < 0 || top > window.innerHeight) return false;
              return bottom > bar.top + 4 && top < bar.bottom - 4;
            });
            if (covered.length) {
              failures.push(
                `tab covers ${covered.length} text nodes, first "${(covered[0]?.textContent ?? '').trim().slice(0, 32)}"`,
              );
            }
          }
        }
      }

      for (const grid of document.querySelectorAll('[data-bn="bn-metrics"]')) {
        const items = [...grid.children].filter((el) => {
          const box = el.getBoundingClientRect();
          return getComputedStyle(el).display !== 'none' && box.height > 0;
        });
        if (items.length < 2) continue;
        const rows = new Map<number, number>();
        for (const el of items) {
          const top = Math.round(el.getBoundingClientRect().top);
          const key =
            [...rows.keys()].find((row) => Math.abs(row - top) <= 2) ?? top;
          rows.set(key, (rows.get(key) ?? 0) + 1);
        }
        const counts = [...rows.values()];
        const first = counts[0] ?? 0;
        const last = counts[counts.length - 1] ?? 0;
        if (counts.length > 1 && last === 1 && first > 1) {
          failures.push(
            `metric orphan first=${first} last=${last} n=${items.length}`,
          );
        }
      }

      for (const badge of document.querySelectorAll('[data-bn="bn-badge"]')) {
        const row = badge.closest('[data-bn="bn-inset-row"]');
        if (!row) continue;
        const label = row.querySelector('p, strong');
        if (!label) {
          failures.push('badge missing its inset row label');
          continue;
        }
        const badgeBox = badge.getBoundingClientRect();
        const labelBox = label.getBoundingClientRect();
        const rowBox = row.getBoundingClientRect();
        const badgeMid = (badgeBox.top + badgeBox.bottom) / 2;
        const labelMid = (labelBox.top + labelBox.bottom) / 2;
        const name = (label.textContent ?? '').trim();
        if (Math.abs(badgeMid - labelMid) > 4) {
          failures.push(
            `badge off line "${name}" delta=${Math.abs(badgeMid - labelMid).toFixed(1)}`,
          );
        }
        if (rowBox.right - badgeBox.right > 16) {
          failures.push(
            `badge not trailing "${name}" gap=${(rowBox.right - badgeBox.right).toFixed(1)}`,
          );
        }
        if (badgeBox.left < labelBox.right - 1) {
          failures.push(`badge overlaps "${name}"`);
        }
      }

      for (const tile of document.querySelectorAll(
        '[data-bn="bn-icon-tile"]',
      )) {
        if (getComputedStyle(tile).display === 'none') continue;
        const box = tile.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        if (
          box.width < 29 ||
          box.width > 40 ||
          box.height < 29 ||
          box.height > 40
        ) {
          failures.push(
            `icon tile ${box.width.toFixed(1)}×${box.height.toFixed(1)} outside 29–40`,
          );
        }
      }

      const leadSample = document.querySelector('[data-bn="bn-lead"]');
      const bodySample = document.querySelector(
        '#main-content [data-bn-column] > p:not([data-bn="bn-lead"]):not([data-bn="bn-note"]):not([data-bn="bn-kicker"]):not([data-bn="bn-cluster"])',
      );
      if (leadSample && bodySample) {
        const leadStyle = getComputedStyle(leadSample);
        const bodyStyle = getComputedStyle(bodySample);
        const leadSize = parseFloat(leadStyle.fontSize);
        const bodySize = parseFloat(bodyStyle.fontSize);
        const leadLine = parseFloat(leadStyle.lineHeight);
        const bodyLine = parseFloat(bodyStyle.lineHeight);
        if (leadSize + 0.5 < bodySize || leadLine + 0.5 < bodyLine) {
          failures.push(
            `lead ${leadSize.toFixed(1)}/${leadLine.toFixed(1)} < body ${bodySize.toFixed(1)}/${bodyLine.toFixed(1)}`,
          );
        }
      }

      const title = document.querySelector('[data-bn="bn-large-title"]');
      if (title) {
        const weight = getComputedStyle(title).fontWeight;
        const numeric = weight === 'bold' ? 700 : Number(weight);
        if (!(numeric >= 700)) failures.push(`large title weight ${weight}`);
        if ((title.textContent ?? '').includes('Operating System')) {
          const range = document.createRange();
          range.selectNodeContents(title);
          const lines = [...range.getClientRects()].filter(
            (rect) => rect.width > 1,
          ).length;
          if (lines > 2) failures.push(`hero title lines ${lines}`);
        }
      }
      const dash = document.querySelector('aside[data-bn="bn-panel"]');
      if (dash) {
        const kicker = dash.querySelector('[data-bn="bn-kicker"]');
        const metric = dash.querySelector('[data-bn="bn-metrics"]');
        const row = dash.querySelector('[data-bn="bn-inset-row"]');
        if (kicker && metric && row) {
          const panelBox = dash.getBoundingClientRect();
          const kickerBox = kicker.getBoundingClientRect();
          const metricBox = metric.getBoundingClientRect();
          const rowBox = row.getBoundingClientRect();
          const labelInset = kickerBox.top - panelBox.top;
          if (labelInset < 20) {
            failures.push(`dashboard label inset ${labelInset.toFixed(1)}`);
          }
          if (
            Math.abs(metricBox.left - rowBox.left) > 1 ||
            Math.abs(metricBox.right - rowBox.right) > 1
          ) {
            failures.push(
              `stat/list inset ${metricBox.left.toFixed(1)}-${metricBox.right.toFixed(1)} vs ${rowBox.left.toFixed(1)}-${rowBox.right.toFixed(1)}`,
            );
          }
        }
      }
      const wash = getComputedStyle(document.body, '::before').backgroundImage;
      const glows =
        !wash || wash === 'none'
          ? 0
          : (wash.match(/radial-gradient/g) ?? []).length;
      if (glows > 1) failures.push(`viewport glows ${glows}`);
      const hero = document.querySelector('#hero');
      if (hero) {
        const disc = getComputedStyle(hero, '::after');
        const discSize = Number.parseFloat(disc.width);
        if (disc.content !== 'none' && discSize > 96) {
          failures.push(`page disc ${discSize.toFixed(0)}px`);
        }
      }
      const panel = document.querySelector(
        '[data-bn="bn-panel"], [data-bn="bn-info-card"]',
      );
      if (panel) {
        const clipped = getComputedStyle(panel).overflow;
        const image = getComputedStyle(panel).backgroundImage;
        const disc = getComputedStyle(panel, '::after').content;
        if (clipped !== 'hidden')
          failures.push(`card not clipped (${clipped})`);
        if (image !== 'none') failures.push(`card wash ${image.slice(0, 60)}`);
        if (disc !== 'none') failures.push('card disc is a second surface');
      }
      const currentTab = document.querySelector(
        '[data-bn="bn-tab"][aria-current="page"]',
      );
      if (
        currentTab &&
        getComputedStyle(currentTab, '::before').content !== 'none'
      ) {
        failures.push('tab selection is a pill on the capsule');
      }
      const topbar = document.querySelector('[data-bn="bn-topbar"]');
      if (topbar) {
        const barStyle = getComputedStyle(topbar);
        const blur = barStyle.backdropFilter;
        const bg = barStyle.backgroundColor;
        const slash = bg.match(/\/\s*([0-9.]+)/);
        const channels = bg
          .replace(/^rgba?\(/, '')
          .replace(/\)$/, '')
          .split(',')
          .map((part) => Number(part.trim()));
        const alpha = slash
          ? Number(slash[1])
          : channels.length === 4
            ? (channels[3] ?? 1)
            : 1;
        if (!blur || blur === 'none' || !blur.includes('blur'))
          failures.push(`topbar blur ${blur}`);
        if (!(alpha < 1)) failures.push(`topbar opaque ${bg}`);
        if (parseFloat(barStyle.borderBottomWidth) > 0)
          failures.push(`topbar rule ${barStyle.borderBottomWidth}`);
        if (barStyle.boxShadow === 'none')
          failures.push('topbar has no elevation');
        if (barStyle.backgroundImage !== 'none')
          failures.push('topbar paints its own wash');
      }
      const capsule = document.querySelector(
        '[data-bn="bn-tab-bar"][data-placement="floating"]',
      );
      if (
        capsule &&
        !getComputedStyle(capsule).backdropFilter.includes('blur')
      ) {
        failures.push(
          `capsule blur ${getComputedStyle(capsule).backdropFilter}`,
        );
      }

      const portal = [...document.querySelectorAll('h3')].find(
        (node) => (node.textContent ?? '').trim() === 'Customer Portal',
      );
      if (portal && !gp4) {
        const badge = portal.parentElement?.querySelector(
          '[data-bn="bn-badge"]',
        );
        const badgeText = (badge?.textContent ?? '').trim();
        if (badgeText !== 'Coming soon') {
          failures.push(`portal badge "${badgeText}"`);
        } else if (badge) {
          const titleBox = portal.getBoundingClientRect();
          const badgeBox = badge.getBoundingClientRect();
          const delta = Math.abs(
            (titleBox.top + titleBox.bottom) / 2 -
              (badgeBox.top + badgeBox.bottom) / 2,
          );
          if (delta > 8)
            failures.push(`portal badge off the title by ${delta.toFixed(1)}`);
        }
      }
      if (/·\s*Coming soon/.test(document.body.textContent ?? '')) {
        failures.push('coming soon still uses a middle dot');
      }

      const sampleRow = document.querySelector('[data-bn="bn-inset-row"]');
      if (sampleRow) {
        const rowStyle = getComputedStyle(sampleRow);
        const list = sampleRow.parentElement;
        const listStyle = getComputedStyle(list ?? sampleRow);
        const inPanel = !!list?.closest('[data-bn="bn-panel"]');
        if (rowStyle.borderRadius !== '0px') {
          failures.push(`inset row radius ${rowStyle.borderRadius}`);
        }
        if (rowStyle.boxShadow !== 'none') {
          failures.push('inset row has its own shadow');
        }
        if (inPanel) {
          const radius = parseFloat(listStyle.borderTopLeftRadius);
          const border = parseFloat(listStyle.borderTopWidth);
          if (radius > 0.5)
            failures.push(`inset list inside a panel has radius ${radius}`);
          if (border > 0)
            failures.push(`inset list inside a panel has a border ${border}`);
          if (listStyle.backgroundColor !== 'rgba(0, 0, 0, 0)')
            failures.push(
              `inset list inside a panel paints ${listStyle.backgroundColor}`,
            );
        } else if (parseFloat(listStyle.borderRadius) < 8) {
          failures.push('inset list is not one rounded group');
        }
      }

      if (topbar) {
        const rootStyle = getComputedStyle(document.documentElement);
        const barToken = rootStyle.getPropertyValue('--gp-toolbar-h').trim();
        const controlToken = rootStyle
          .getPropertyValue('--gp-toolbar-control')
          .trim();
        const measureToken = (value: string): number => {
          const probe = document.createElement('div');
          probe.style.position = 'absolute';
          probe.style.height = value || '0px';
          document.body.appendChild(probe);
          const height = probe.getBoundingClientRect().height;
          probe.remove();
          return height;
        };
        const barHeight = measureToken(barToken);
        const controlHeight = measureToken(controlToken);
        const actual = topbar.getBoundingClientRect().height;
        if (Math.abs(actual - barHeight) > 1)
          failures.push(
            `toolbar height ${actual.toFixed(1)} vs token ${barHeight.toFixed(1)}`,
          );
        if (viewport >= 1024) {
          for (const button of topbar.querySelectorAll(
            '[data-bn="bn-button"]',
          )) {
            const buttonHeight = button.getBoundingClientRect().height;
            if (Math.abs(buttonHeight - controlHeight) > 1)
              failures.push(
                `toolbar button ${buttonHeight.toFixed(1)} vs ${controlHeight.toFixed(1)}`,
              );
          }
        }
      }

      const contentButtons = [
        ...document.querySelectorAll('[data-bn="bn-button"]'),
      ].filter((node) => {
        if (node.closest('[data-bn="bn-topbar"]')) return false;
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });
      if (contentButtons.length > 0) {
        const control = (() => {
          const probe = document.createElement('div');
          probe.style.position = 'absolute';
          probe.style.blockSize = 'var(--gp-control-h)';
          document.body.appendChild(probe);
          const px = probe.getBoundingClientRect().height;
          probe.remove();
          return px;
        })();
        const radii = new Set<string>();
        for (const button of contentButtons) {
          const height = button.getBoundingClientRect().height;
          if (Math.abs(height - control) > 1)
            failures.push(
              `content button ${height.toFixed(1)} vs ${control.toFixed(1)}`,
            );
          radii.add(getComputedStyle(button).borderRadius);
        }
        if (radii.size > 1)
          failures.push(`content button radii ${[...radii].join(' / ')}`);
      }

      const nestedMetric = document.querySelector(
        '[data-bn="bn-panel"] [data-bn="bn-metric"], [data-bn="bn-info-card"] [data-bn="bn-metric"]',
      );
      if (nestedMetric) {
        const metricStyle = getComputedStyle(nestedMetric);
        if (metricStyle.backgroundColor !== 'rgba(0, 0, 0, 0)')
          failures.push(`metric tile fill ${metricStyle.backgroundColor}`);
        if (parseFloat(metricStyle.borderTopLeftRadius) > 0.5)
          failures.push(
            `metric tile radius ${metricStyle.borderTopLeftRadius}`,
          );
      }

      const countBadge = document.querySelector(
        '[data-bn="bn-inset-row"] [data-bn="bn-badge"]',
      );
      if (countBadge) {
        const fill = getComputedStyle(countBadge).backgroundColor;
        const channels = fill
          .replace(/^rgba?\(/, '')
          .replace(/\)$/, '')
          .split(',')
          .map((part) => Number(part.trim()));
        const red = channels[0] ?? 0;
        const green = channels[1] ?? 0;
        const blue = channels[2] ?? 0;
        if (green > red + 24 && green > blue + 24)
          failures.push(`badge fill is green ${fill}`);
      }

      const noteSample = document.querySelector('[data-bn="bn-note"]');
      const sectionTitle = document.querySelector('#main-content h2');
      if (leadSample && noteSample) {
        const noteSize = parseFloat(getComputedStyle(noteSample).fontSize);
        const leadSizeNow = parseFloat(getComputedStyle(leadSample).fontSize);
        if (noteSize + 0.5 >= leadSizeNow)
          failures.push(
            `note ${noteSize.toFixed(1)} is not under lead ${leadSizeNow.toFixed(1)}`,
          );
      }
      if (leadSample && sectionTitle) {
        const titleSize = parseFloat(getComputedStyle(sectionTitle).fontSize);
        const leadSizeNow = parseFloat(getComputedStyle(leadSample).fontSize);
        if (titleSize + 0.5 < leadSizeNow)
          failures.push(
            `section title ${titleSize.toFixed(1)} under lead ${leadSizeNow.toFixed(1)}`,
          );
      }

      if (viewport >= 1024) {
        const buttons = [
          ...document.querySelectorAll(
            '[data-bn="bn-rail"] [data-bn="bn-button"]',
          ),
        ];
        const sign = buttons.find(
          (node) => (node.textContent ?? '').trim() === 'Sign In',
        );
        const start = buttons.find(
          (node) => (node.textContent ?? '').trim() === 'Get Started',
        );
        if (sign && start) {
          const signStyle = getComputedStyle(sign);
          const startStyle = getComputedStyle(start);
          if (signStyle.borderRadius !== startStyle.borderRadius) {
            failures.push(
              `capsule radius ${signStyle.borderRadius} vs ${startStyle.borderRadius}`,
            );
          }
          if (signStyle.fontWeight !== startStyle.fontWeight) {
            failures.push(
              `capsule weight ${signStyle.fontWeight} vs ${startStyle.fontWeight}`,
            );
          }
          const signRadius = parseFloat(signStyle.borderTopLeftRadius);
          const signHeight = sign.getBoundingClientRect().height;
          if (!(signRadius >= signHeight / 2 - 1)) {
            failures.push(
              `sign in radius ${signRadius} on height ${signHeight.toFixed(1)}`,
            );
          }
        }
      }

      const stackOf = (name: string): number => {
        const probe = document.createElement('div');
        probe.style.position = 'absolute';
        probe.style.blockSize = `var(${name})`;
        document.body.appendChild(probe);
        const px = probe.getBoundingClientRect().height;
        probe.remove();
        return px;
      };
      // v4 pages do not load the design-system stack tokens. Later gap
      // checks still need a number, so they use the same floors.
      let titleMin = 48;
      let actionMin = 24;
      let contentMin = 16;
      let sectionMin = viewport >= 768 ? 64 : 40;
      if (!gp4) {
        titleMin = stackOf('--gp-stack-title');
        actionMin = stackOf('--gp-stack-actions');
        contentMin = stackOf('--gp-stack-content');
        sectionMin = stackOf('--gp-stack-section');
        if (
          titleMin < 12 ||
          actionMin < 20 ||
          contentMin < 24 ||
          sectionMin < (viewport >= 768 ? 64 : 40)
        ) {
          failures.push(
            `stack tokens ${titleMin}/${actionMin}/${contentMin}/${sectionMin}`,
          );
        }
      }
      const stacks = document.querySelectorAll(
        '[data-bn-column]:not([data-bn="bn-split"]), [data-bn="bn-section"] header, [data-bn="bn-split"] > header',
      );
      for (const stack of stacks) {
        const kids = [...stack.children].filter((node) => {
          const box = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          if (style.position === 'absolute' || style.visibility === 'hidden')
            return false;
          return box.width > 8 && box.height > 8;
        });
        for (let i = 0; i < kids.length - 1; i += 1) {
          const prev = kids[i];
          const next = kids[i + 1];
          if (!prev || !next) continue;
          const prevBox = prev.getBoundingClientRect();
          const nextBox = next.getBoundingClientRect();
          if (nextBox.top < prevBox.bottom - 2) continue;
          // Inline links that wrap (the footer legal line) are line boxes,
          // not a stack. Their leftover leading is not a section gap.
          const prevDisplay = getComputedStyle(prev).display;
          const nextDisplay = getComputedStyle(next).display;
          if (
            prevDisplay === 'inline' ||
            prevDisplay === 'inline-block' ||
            nextDisplay === 'inline' ||
            nextDisplay === 'inline-block'
          ) {
            continue;
          }
          const gap = nextBox.top - prevBox.bottom;
          if (stack.parentElement?.getAttribute('data-bn') === 'bn-info-card')
            continue;
          const prevLead = prev.getAttribute('data-bn') === 'bn-lead';
          const nextLead = next.getAttribute('data-bn') === 'bn-lead';
          const prevKicker = prev.getAttribute('data-bn') === 'bn-kicker';
          const nextAction =
            next.getAttribute('data-bn') === 'bn-cluster' ||
            next.getAttribute('data-bn') === 'bn-button';
          const prevTitle =
            prev.getAttribute('data-bn') === 'bn-large-title' ||
            prev.tagName === 'H1' ||
            prev.tagName === 'H2';
          const nextTitle =
            next.getAttribute('data-bn') === 'bn-large-title' ||
            next.tagName === 'H1' ||
            next.tagName === 'H2';
          let min = contentMin;
          if ((prevTitle && nextLead) || (prevKicker && nextTitle))
            min = titleMin;
          else if (prevLead && nextAction) min = actionMin;
          if (gap + 1 < min) {
            const label = (prev.textContent ?? '')
              .trim()
              .replace(/\s+/g, ' ')
              .slice(0, 32);
            failures.push(
              `stack gap ${gap.toFixed(1)} < ${min} after "${label}"`,
            );
          }
        }
      }
      const sections = [
        ...document.querySelectorAll('#main-content > section'),
      ];
      const contentBox = (
        section: Element,
        edge: 'first' | 'last',
      ): DOMRect | null => {
        const nodes = [
          ...section.querySelectorAll('h1,h2,h3,p,li,a,button'),
        ].filter((node) => {
          if (node.closest('[data-bn="bn-tab-bar"]')) return false;
          const box = node.getBoundingClientRect();
          return (
            box.width > 0 &&
            box.height > 0 &&
            (node.textContent ?? '').trim().length > 0
          );
        });
        const picked = edge === 'first' ? nodes[0] : nodes[nodes.length - 1];
        return picked ? picked.getBoundingClientRect() : null;
      };
      for (let i = 0; i < sections.length - 1; i += 1) {
        const above = contentBox(sections[i] ?? sections[0], 'last');
        const below = contentBox(sections[i + 1] ?? sections[0], 'first');
        if (!above || !below) continue;
        const gap = below.top - above.bottom;
        if (gap + 1 < sectionMin) {
          failures.push(`section gap ${gap.toFixed(1)} < ${sectionMin}`);
        }
      }

      const bands: Array<{ top: number; bottom: number }> = [];
      for (const node of document.querySelectorAll(
        'h1,h2,h3,p,li,dt,dd,blockquote,td,th,img,button,a,label',
      )) {
        if (node.closest('[data-bn="bn-topbar"], [data-bn="bn-tab-bar"]'))
          continue;
        const box = node.getBoundingClientRect();
        if (box.width < 8 || box.height < 8) continue;
        if (
          node.tagName !== 'IMG' &&
          (node.textContent ?? '').trim().length === 0
        )
          continue;
        const top = box.top + window.scrollY;
        const bottom = box.bottom + window.scrollY;
        if (bottom < 0 || top > window.innerHeight * 2) continue;
        bands.push({ top, bottom });
      }
      bands.sort((a, b) => a.top - b.top);
      const merged: Array<{ top: number; bottom: number }> = [];
      for (const band of bands) {
        const last = merged[merged.length - 1];
        if (last && band.top <= last.bottom + 8)
          last.bottom = Math.max(last.bottom, band.bottom);
        else merged.push({ ...band });
      }
      const hole = Math.max(window.innerHeight * 0.4, sectionMin + 48);
      for (let i = 0; i < merged.length - 1; i += 1) {
        const gap = (merged[i + 1]?.top ?? 0) - (merged[i]?.bottom ?? 0);
        if (gap > hole)
          failures.push(
            `empty band ${gap.toFixed(0)}px in the first two screens`,
          );
      }

      for (const grid of document.querySelectorAll(
        '[data-bn="bn-card-grid"], [data-bn="bn-metrics"]',
      )) {
        const items = [...grid.children].filter(
          (node) => node.getBoundingClientRect().width > 0,
        );
        if (items.length < 2) continue;
        const grouped: Array<{ top: number; count: number }> = [];
        for (const item of items) {
          const top = item.getBoundingClientRect().top;
          const group = grouped.find((entry) => Math.abs(entry.top - top) < 4);
          if (group) group.count += 1;
          else grouped.push({ top, count: 1 });
        }
        const counts = grouped.map((entry) => entry.count);
        const first = counts[0] ?? 1;
        const uneven =
          counts.length > 1 && counts.some((count) => count !== first);
        const width = grid.getBoundingClientRect().width;
        const maxCols = Math.max(1, Math.floor((width + 12) / (200 + 12)));
        let divisor = 0;
        for (let columns = maxCols; columns >= 2; columns -= 1) {
          if (items.length % columns === 0) {
            divisor = columns;
            break;
          }
        }
        if (uneven && divisor > 0) {
          failures.push(
            `card orphan rows ${counts.join('+')} of ${items.length}`,
          );
        }
        if (grid.getAttribute('data-bn') === 'bn-card-grid') {
          const count = items.length;
          let expect = 1;
          if (width >= 640 && (count === 3 || count === 6)) expect = 3;
          else if (
            width >= 544 &&
            (count === 2 || count === 4 || count === 6 || count === 8)
          ) {
            expect = 2;
          }
          if (first < expect) {
            failures.push(
              `card columns ${first} < balanced ${expect} for ${count}`,
            );
          }
        }
      }

      if (/<bn-[a-z0-9-]+/i.test(document.body.innerHTML)) {
        failures.push('custom element in rendered markup');
      }
      return failures;
    },
    { viewport: width, cover },
  );
}

export async function readLabels(page: Page): Promise<LabelReading[]> {
  return page.locator('[data-bn="bn-metric"] small').evaluateAll((nodes) =>
    nodes.map((el) => {
      const cs = getComputedStyle(el);
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter(
        (rect) => rect.width > 0,
      );
      const box = el.getBoundingClientRect();
      const textMid =
        rects.length === 0 ? box.left : (rects[0].left + rects[0].right) / 2;
      const boxMid = (box.left + box.right) / 2;
      return {
        text: (el.textContent ?? '').trim(),
        lines: rects.length,
        delta: Math.abs(textMid - boxMid),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        textAlign: cs.textAlign,
        textTransform: cs.textTransform,
        letterSpacing: cs.letterSpacing,
        whiteSpace: cs.whiteSpace,
      };
    }),
  );
}
