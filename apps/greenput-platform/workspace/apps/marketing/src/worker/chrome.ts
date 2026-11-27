import { renderBnButton } from '@basenative/platform';
import { greenputMark, renderFloatingTabs } from '@greenput/shared/design';
import { operatorByline } from './geo/entity.js';

/**
 * Retired marketing chrome. No HTML response composes this anymore: every
 * marketing document uses the v4 shell in gp4-shell.ts (header, footer, and
 * the phone tab bar). This file stays so the shared-surface contract can
 * still see the floating tab bar it used to publish. /investors stays out
 * of this header.
 */

const NAV_ITEMS = [
  { label: 'Features', href: '/features', route: 'features' },
  { label: 'AI Assistants', href: '/ai', route: 'ai' },
  { label: 'Pricing', href: '/pricing', route: 'pricing' },
  { label: 'About', href: '/about', route: 'about' },
  { label: 'Technology', href: '/technology', route: 'technology' },
  { label: 'Contact', href: '/contact', route: 'contact' },
] as const;

const tabSymbol = (body: string): string =>
  `<svg data-bn="bn-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const TAB_ITEMS = [
  {
    label: 'Home',
    href: '/',
    route: 'home',
    symbol: tabSymbol(
      '<path d="M4 11.5 12 4l8 7.5"/><path d="M7 10.5V20h10v-9.5"/>',
    ),
  },
  {
    label: 'Features',
    href: '/features',
    route: 'features',
    symbol: tabSymbol(
      '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
    ),
  },
  {
    label: 'Pricing',
    href: '/pricing',
    route: 'pricing',
    symbol: tabSymbol(
      '<path d="M12 3v18"/><path d="M16.5 7.5c0-1.8-2-3-4.5-3S7.5 5.7 7.5 7.5 9.5 10.3 12 10.3s4.5 1.2 4.5 3-2 3-4.5 3-4.5-1.2-4.5-3"/>',
    ),
  },
  {
    label: 'Contact',
    href: '/contact',
    route: 'contact',
    symbol: tabSymbol(
      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
    ),
  },
] as const;

function current(route: string | undefined, name: string): boolean {
  return (
    route === name || (name === 'home' && (route === 'home' || route === ''))
  );
}

export function siteHeaderHtml(activeRoute?: string): string {
  const links = NAV_ITEMS.map((item) => {
    const here = item.route === activeRoute ? ' aria-current="page"' : '';
    return `<a href="${item.href}"${here}>${item.label}</a>`;
  }).join('');
  const signIn = renderBnButton('Sign In', {
    href: 'https://app.greenput.com/login',
    variant: 'bordered',
    size: 'small',
  });
  const start = renderBnButton('Get Started', {
    href: 'https://app.greenput.com/onboarding',
    variant: 'prominent',
    size: 'small',
  });
  const tabs = renderFloatingTabs({
    id: 'site-tabs',
    label: 'Primary',
    tabs: TAB_ITEMS.map((item) => ({
      label: item.label,
      href: item.href,
      current: current(activeRoute, item.route),
      symbol: item.symbol,
    })),
  });
  return `<a href="#main-content" data-bn="bn-skip">Skip to content</a>
<header data-bn="bn-topbar">
  <nav data-bn="bn-rail" data-bn-column aria-label="Primary">
    <a data-bn="bn-brand" href="/" aria-label="Greenput home">${greenputMark({ size: 26 })}<b>Greenput</b></a>
    ${links}
    ${signIn}
    ${start}
  </nav>
</header>
${tabs}`;
}

export function siteFooterHtml(): string {
  return `<footer data-bn="bn-site-footer">
  <section data-bn-column>
    <header>
      <p>${greenputMark({ size: 24 })} <strong>Greenput</strong></p>
      <p>The operating system for trade contractors.</p>
    </header>
    <nav aria-label="Footer product navigation">
      <h2>Product</h2>
      <ul>
        <li><a href="/features">Features</a></li>
        <li><a href="/pricing">Pricing</a></li>
        <li><a href="/technology">Technology</a></li>
        <li><a href="/ai">AI Assistants</a></li>
        <li><a href="/guides">Homeowner guides</a></li>
        <li><a href="https://app.greenput.com/onboarding">Get Started</a></li>
      </ul>
    </nav>
    <nav aria-label="Footer company navigation">
      <h2>Company</h2>
      <ul>
        <li><a href="/about">About</a></li>
        <li><a href="/contact">Contact</a></li>
        <li><a href="/investors">Investors</a></li>
        <li><a href="https://github.com/DuganLabs" rel="noopener noreferrer">GitHub</a></li>
      </ul>
    </nav>
  </section>
  <p data-bn-column>© 2026 GreenPut. ${operatorByline()}. <a href="/privacy">Privacy Policy</a> <a href="/terms">Terms of Service</a></p>
</footer>`;
}

export function siteShellHtml(mainHtml: string, activeRoute?: string): string {
  return `${siteHeaderHtml(activeRoute)}
<section data-bn="bn-page">
<main id="main-content">
${mainHtml}
</main>
${siteFooterHtml()}
</section>`;
}
