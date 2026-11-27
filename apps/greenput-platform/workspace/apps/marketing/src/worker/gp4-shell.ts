import { operatorByline } from './geo/entity.js';
import { GP4_SPRITE } from './gp4-sprite.js';

/**
 * Header, footer, and phone tab bar for every marketing page. Investors stay
 * in the footer only. The menu is a native popover, so the links are in the
 * DOM with no script. Guide articles share the guides footer current-page.
 */

const HEADER_LINKS = [
  { href: '/features', label: 'Features', route: 'features' },
  { href: '/ai', label: 'AI Assistants', route: 'ai' },
  { href: '/pricing', label: 'Pricing', route: 'pricing' },
  { href: '/about', label: 'About', route: 'about' },
  { href: '/technology', label: 'Technology', route: 'technology' },
  { href: '/contact', label: 'Contact', route: 'contact' },
  { href: 'https://app.greenput.com/login', label: 'Sign in', route: '' },
  {
    href: 'https://app.greenput.com/onboarding',
    label: 'Get started',
    route: '',
  },
] as const;

const PRODUCT_LINKS = [
  { href: '/features', label: 'Features', route: 'features' },
  { href: '/pricing', label: 'Pricing', route: 'pricing' },
  { href: '/technology', label: 'Technology', route: 'technology' },
  { href: '/ai', label: 'AI Assistants', route: 'ai' },
  { href: '/guides', label: 'Homeowner guides', route: 'guides' },
  {
    href: 'https://app.greenput.com/onboarding',
    label: 'Get Started',
    route: '',
  },
] as const;

const COMPANY_LINKS = [
  { href: '/about', label: 'About', route: 'about' },
  { href: '/contact', label: 'Contact', route: 'contact' },
  { href: '/investors', label: 'Investors', route: 'investors' },
  {
    href: 'https://github.com/DuganLabs',
    label: 'GitHub',
    route: '',
  },
  { href: '/privacy', label: 'Privacy Policy', route: 'privacy' },
  { href: '/terms', label: 'Terms of Service', route: 'terms' },
] as const;

const TABS = [
  { href: '/', label: 'Home', route: 'home', icon: 'i-home' },
  { href: '/features', label: 'Features', route: 'features', icon: 'i-grid' },
  { href: '/pricing', label: 'Pricing', route: 'pricing', icon: 'i-tag' },
  { href: '/contact', label: 'Contact', route: 'contact', icon: 'i-mail' },
] as const;

export function gp4Density(route: string): 'spacious' | 'comfortable' {
  return route === 'contact' ? 'comfortable' : 'spacious';
}

/** Guide articles highlight Homeowner guides. Every other name is itself. */
function navRoute(route: string): string {
  return route === 'guides' || route.startsWith('guide-') ? 'guides' : route;
}

function current(route: string, name: string): string {
  return route === name ? ' aria-current="page"' : '';
}

function headerHtml(route: string): string {
  const items = HEADER_LINKS.map(
    (item) =>
      `<li><a href="${item.href}"${current(route, item.route)}>${item.label}</a></li>`,
  ).join('');
  return `<header data-density="compact">
  <a href="/" aria-label="Greenput home"><svg aria-hidden="true"><use href="#i-leaf"/></svg>Greenput</a>
  <nav aria-label="Primary">
    <button type="button" popovertarget="site-menu" popovertargetaction="toggle" aria-controls="site-menu"><svg aria-hidden="true"><use href="#i-menu"/></svg>Menu</button>
    <ul id="site-menu" popover="auto">
      ${items}
    </ul>
    <menu>
      <li><a href="https://app.greenput.com/login">Sign in</a></li>
      <li><a variant="accent" href="https://app.greenput.com/onboarding">Get started</a></li>
    </menu>
  </nav>
</header>`;
}

function footerList(
  links: ReadonlyArray<{ href: string; label: string; route: string }>,
  route: string,
): string {
  return links
    .map((item) => {
      const rel = item.href.startsWith('http')
        ? ' rel="noopener noreferrer"'
        : '';
      return `<li><a href="${item.href}"${current(route, item.route)}${rel}>${item.label}</a></li>`;
    })
    .join('');
}

function footerHtml(route: string): string {
  return `<footer data-density="comfortable">
  <section aria-label="Greenput">
    <a href="/" aria-label="Greenput home"><svg aria-hidden="true"><use href="#i-leaf"/></svg>Greenput</a>
    <p>The operating system for trade contractors.</p>
    <p>© 2026 GreenPut. ${operatorByline()}.</p>
  </section>
  <nav aria-label="Footer">
    <section aria-labelledby="f-product"><h2 id="f-product">Product</h2><ul>${footerList(PRODUCT_LINKS, route)}</ul></section>
    <section aria-labelledby="f-company"><h2 id="f-company">Company</h2><ul>${footerList(COMPANY_LINKS, route)}</ul></section>
  </nav>
</footer>`;
}

function tabbarHtml(route: string): string {
  const items = TABS.map(
    (tab) =>
      `<li><a href="${tab.href}"${current(route, tab.route)}><svg aria-hidden="true"><use href="#${tab.icon}"/></svg>${tab.label}</a></li>`,
  ).join('');
  return `<nav aria-label="Main sections" data-tabbar data-density="compact">
  <ul>
    ${items}
  </ul>
</nav>`;
}

export function gp4Shell(mainHtml: string, route: string): string {
  const currentRoute = navRoute(route);
  return `<a href="#main">Skip to content</a>
${GP4_SPRITE}
${headerHtml(currentRoute)}
<main id="main">
${mainHtml}
</main>
${footerHtml(currentRoute)}
${tabbarHtml(currentRoute)}`;
}
