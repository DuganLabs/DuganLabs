/**
 * Contractor micro-site pages, composed from the shared surface.
 * The facts (licence, hours, phone, quote gate) stay exactly what the
 * workspace row backs. The chrome is the same organisms as greenput.com:
 * a rail, a floating tab bar, and a column footer.
 */
import { renderBnButton } from '@basenative/platform';
import {
  HOUSE_LINE_SVG,
  renderFaqList,
  renderFloatingTabs,
  renderPageHero,
} from '@greenput/shared/design';

export interface HoursRow {
  day: string;
  times: string;
}

export interface ServiceCard {
  name: string;
  query: string;
  /**
   * The published quote flow this service maps to (service-flow.ts), or
   * null. When set, the card starts that flow directly instead of sending
   * the homeowner to the /quote picker to choose the same service again.
   */
  flow: string | null;
}

export interface QuoteCard {
  name: string;
  description: string;
}

export interface TenantChrome {
  workspaceName: string;
  trade: string;
  phone: string;
  phoneDisplay: string;
  email: string;
  logoUrl: string;
  initials: string;
  markBg: string;
  markFg: string;
  markAccent: string;
  markTreatment: string;
  markShape: string;
  markTurn: string;
  license: string;
  areaSuffix: string;
  hasQuote: boolean;
  active: 'home' | 'services' | 'about' | 'contact' | null;
}

export interface TenantPages {
  workspaceName: string;
  trade: string;
  phone: string;
  phoneDisplay: string;
  email: string;
  logoUrl: string;
  initials: string;
  markBg: string;
  markFg: string;
  markAccent: string;
  markTreatment: string;
  markShape: string;
  markTurn: string;
  license: string;
  areaSuffix: string;
  areaLabel: string;
  areaDetail: string;
  heroLead: string;
  responseNote: string;
  hasQuote: boolean;
  hasHours: boolean;
  hours: readonly HoursRow[];
  serviceTypes: readonly ServiceCard[];
  quoteFlows: readonly QuoteCard[];
  faqEntries: readonly { q: string; a: string }[];
  formStatus: string | null;
  formMessage: string;
  formField: string | null;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function button(
  label: string,
  href: string,
  variant: 'prominent' | 'bordered',
): string {
  return renderBnButton(label, { href, variant, size: 'large' });
}

function markHtml(c: {
  logoUrl: string;
  workspaceName: string;
  initials: string;
  markBg: string;
  markFg: string;
  markAccent: string;
  markTreatment: string;
  markShape: string;
  markTurn: string;
  attr: string;
}): string {
  if (c.logoUrl) {
    const width = c.attr === 'about-logo' ? '200' : '36';
    const height = c.attr === 'about-logo' ? '120' : '36';
    return `<img src="${esc(c.logoUrl)}" alt="${esc(c.workspaceName)} logo" width="${width}" height="${height}" data-bn="${c.attr}">`;
  }
  return `<span data-bn="${c.attr}" aria-hidden="true" data-bn-treatment="${esc(c.markTreatment)}" data-bn-shape="${esc(c.markShape)}" style="--gp-mark-bg:${esc(c.markBg)};--gp-mark-fg:${esc(c.markFg)};--gp-mark-accent:${esc(c.markAccent)};--gp-mark-turn:${esc(c.markTurn)}deg">${esc(c.initials)}</span>`;
}

function navAnchor(
  href: string,
  label: string,
  active: boolean,
  extra = '',
): string {
  const here = active ? ' data-bn-active="" aria-current="page"' : '';
  return `<a href="${href}"${extra}${here}>${label}</a>`;
}

export function tenantHeaderHtml(c: TenantChrome): string {
  const brandInner = c.logoUrl
    ? `<img src="${esc(c.logoUrl)}" alt="" width="36" height="36">`
    : markHtml({ ...c, attr: 'monogram' });
  const links = [
    navAnchor('/', 'Home', c.active === 'home'),
    navAnchor('/services', 'Services', c.active === 'services'),
    navAnchor('/about', 'About', c.active === 'about'),
  ];
  if (c.hasQuote) {
    links.push(navAnchor('/contact', 'Contact', c.active === 'contact'));
    links.push('<a href="/quote" data-bn="nav-cta-link">Get a price</a>');
  } else {
    links.push(
      navAnchor(
        '/contact',
        'Get a quote',
        c.active === 'contact',
        ' data-bn="nav-cta-link"',
      ),
    );
  }
  const phone = c.phone
    ? `<a href="tel:${esc(c.phone)}" aria-label="Call ${esc(c.workspaceName)} on ${esc(c.phoneDisplay)}"><span>${esc(c.phoneDisplay)}</span></a>`
    : '';
  return `<a href="#main-content" data-bn="bn-skip">Skip to content</a>
<header data-bn="bn-topbar">
  <nav data-bn="bn-rail" data-bn-column aria-label="Primary">
    <a data-bn="bn-brand" href="/" aria-label="${esc(c.workspaceName)} home">${brandInner}<span data-bn="nav-name"><strong>${esc(c.workspaceName)}</strong><small>${esc(c.trade)}</small></span></a>
    ${links.join('\n    ')}
    ${phone}
  </nav>
</header>`;
}

/** The phone capsule. A sibling of the scrollport, never inside it, so
 *  `position: fixed` stays the viewport. */
export function tenantTabsHtml(c: TenantChrome): string {
  const symbol = (body: string): string =>
    `<svg data-bn="bn-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  return renderFloatingTabs({
    id: 'site-tabs',
    label: 'Primary',
    tabs: [
      {
        label: 'Home',
        href: '/',
        current: c.active === 'home',
        symbol: symbol(
          '<path d="M4 11.5 12 4l8 7.5"/><path d="M7 10.5V20h10v-9.5"/>',
        ),
      },
      {
        label: 'Services',
        href: '/services',
        current: c.active === 'services',
        symbol: symbol(
          '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 0 5.4-5.4l-2.2 2.2-2-2z"/>',
        ),
      },
      {
        label: 'About',
        href: '/about',
        current: c.active === 'about',
        symbol: symbol(
          '<circle cx="12" cy="8" r="3"/><path d="M5 19c1.2-2.6 3.7-4 7-4s5.8 1.4 7 4"/>',
        ),
      },
      {
        label: 'Contact',
        href: '/contact',
        current: c.active === 'contact',
        symbol: symbol(
          '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
        ),
      },
    ],
  });
}

export function tenantFooterHtml(c: TenantChrome): string {
  const phone = c.phone
    ? `<a href="tel:${esc(c.phone)}" data-bn="footer-contact">${esc(c.phoneDisplay)}</a>`
    : '';
  const email = c.email
    ? `<a href="mailto:${esc(c.email)}" data-bn="footer-contact">${esc(c.email)}</a>`
    : '';
  const license = c.license
    ? `<p data-bn="footer-license">License ${esc(c.license)}</p>`
    : '';
  const quote = c.hasQuote ? '<li><a href="/quote">Get a price</a></li>' : '';
  return `<footer data-bn="bn-site-footer">
  <section data-bn-column>
    <header>
      <p><strong>${esc(c.workspaceName)}</strong></p>
      <p>${esc(c.trade)} services${esc(c.areaSuffix)}</p>
      ${phone}
      ${email}
      ${license}
    </header>
    <nav aria-label="Footer">
      <h2>Pages</h2>
      <ul>
        <li><a href="/">Home</a></li>
        <li><a href="/services">Services</a></li>
        <li><a href="/about">About</a></li>
        ${quote}
        <li><a href="/contact">Contact</a></li>
      </ul>
    </nav>
  </section>
  <p data-bn-column>Powered by <a href="https://greenput.com" rel="noopener noreferrer">Greenput</a></p>
</footer>`;
}

function callButton(p: TenantPages): string {
  if (!p.phone) return '';
  return button(`Call ${p.phoneDisplay}`, `tel:${p.phone}`, 'bordered');
}

function priceOrQuote(p: TenantPages, priced: string, plain: string): string {
  return p.hasQuote
    ? button(priced, '/quote', 'prominent')
    : button(plain, '/contact', 'prominent');
}

export function homePage(p: TenantPages): string {
  const heroLogo = p.logoUrl
    ? `<img src="${esc(p.logoUrl)}" alt="${esc(p.workspaceName)} logo" width="200" height="80" data-bn="hero-logo">`
    : '';
  const actions = [
    priceOrQuote(p, 'Get a price now', 'Get a free quote'),
    callButton(p),
  ]
    .filter(Boolean)
    .join('');
  const hero = renderPageHero({
    id: 'hero',
    kicker: `${p.trade}${p.areaSuffix}`,
    headingHtml: esc(p.workspaceName),
    lead: p.heroLead,
    actionsHtml: actions,
    note: p.responseNote,
    visualHtml: `${heroLogo}${HOUSE_LINE_SVG}`,
  });
  const licensed = p.license
    ? `<li data-bn="bn-inset-row"><strong>Licensed</strong>
          <span>Licence ${esc(p.license)}</span></li>`
    : '';
  const services =
    p.serviceTypes.length > 0
      ? `<section data-bn="bn-section" aria-labelledby="services-preview-heading"><div data-bn-column>
      <p data-bn="bn-kicker">What we do</p>
      <h2 id="services-preview-heading" data-bn="bn-large-title">${esc(p.trade)} work, start to finish</h2>
      <ul data-bn="bn-card-grid">${p.serviceTypes
        .map(
          (svc) => `<li data-bn="bn-info-card"><h3>${esc(svc.name)}</h3></li>`,
        )
        .join('')}</ul>
      ${button('See every service', '/services', 'bordered')}
    </div></section>`
      : '';
  const quotes = p.hasQuote
    ? `<section data-bn="bn-section" aria-labelledby="quote-promo-heading"><div data-bn-column>
      <p data-bn="bn-kicker">Price it yourself</p>
      <h2 id="quote-promo-heading" data-bn="bn-large-title">A real price, without waiting on us</h2>
      <p data-bn="bn-lead">Answer a few questions about the job and you get a price at the end — not a call-back, and not a number we move later. These are the jobs we can price this way today.</p>
      <ul data-bn="bn-card-grid">${p.quoteFlows
        .map(
          (flow) =>
            `<li data-bn="bn-info-card"><a href="/quote"><h3>${esc(flow.name)}</h3><p>${esc(flow.description)}</p></a></li>`,
        )
        .join('')}</ul>
      ${button('Start a price', '/quote', 'prominent')}
    </div></section>`
    : '';
  const stepOne = p.hasQuote
    ? `<li><h3>Price it yourself, or tell us</h3><p>Answer a few questions and this site prices the job on the spot. Would rather describe it in your own words? Send the form or ring us.</p></li>`
    : `<li><h3>Tell us what is going on</h3><p>Send the form or ring us. Describe the problem in your own words — you do not need the right word for it.</p></li>`;
  const ctaCopy = p.hasQuote
    ? 'Price it here in about two minutes, or tell us about it and we will come back within one business day. No obligation either way, and no call-out charge for the quote.'
    : 'Tell us about it and we will come back to you within one business day — no obligation, no call-out charge for the quote.';
  const ctaActions = p.hasQuote
    ? `${button('Get a price now', '/quote', 'prominent')}${button('Send us the details instead', '/contact', 'bordered')}${callButton(p)}`
    : `${button('Get a free quote', '/contact', 'prominent')}${callButton(p)}`;
  return `${hero}
<section data-bn="bn-section" aria-label="What you can count on"><div data-bn-column>
  <ul data-bn="bn-inset-list">
    ${licensed}
    <li data-bn="bn-inset-row"><strong>Free written quotes</strong><span>A price before any work starts</span></li>
    <li data-bn="bn-inset-row"><strong>${esc(p.areaLabel)}</strong><span>${esc(p.areaDetail)}</span></li>
    <li data-bn="bn-inset-row"><strong>A real reply</strong><span>Within one business day</span></li>
  </ul>
</div></section>
${services}
${quotes}
<section data-bn="bn-section" aria-labelledby="how-heading"><div data-bn-column>
  <p data-bn="bn-kicker">How it works</p>
  <h2 id="how-heading" data-bn="bn-large-title">Three steps, no surprises</h2>
  <ol data-bn="bn-steps">
    ${stepOne}
    <li><h3>We look and we quote</h3><p>We come out, work out what the job actually needs, and put a written price in front of you before anything starts.</p></li>
    <li><h3>We book it and do it</h3><p>You get a date and a time window. We turn up, do the work, clear up after ourselves, and you pay the price you agreed.</p></li>
  </ol>
</div></section>
<section data-bn="bn-section" aria-labelledby="quote-heading"><div data-bn-column>
  <h2 id="quote-heading" data-bn="bn-large-title">Got a job that needs doing?</h2>
  <p>${ctaCopy}</p>
  <p data-bn="bn-cluster">${ctaActions}</p>
</div></section>`;
}

export function servicesPage(p: TenantPages): string {
  const cards =
    p.serviceTypes.length > 0
      ? `<ul data-bn="bn-card-grid">${p.serviceTypes
          .map((svc) => {
            const intro = `<h2>${esc(svc.name)}</h2><p>${esc(svc.name)}, quoted in writing before the work starts.</p>`;
            // One click into the first real question: a POST, because a
            // GET (crawlers, link previews) must never create a session.
            if (p.hasQuote && svc.flow) {
              return `<li data-bn="bn-info-card">${intro}<form method="post" action="/quote/start"><input type="hidden" name="flow" value="${esc(svc.flow)}">${renderBnButton('Price this now', { type: 'submit', variant: 'bordered', size: 'large' })}</form></li>`;
            }
            const href = p.hasQuote
              ? '/quote'
              : `/contact?service=${svc.query}`;
            const label = p.hasQuote ? 'Price this now' : 'Ask about this';
            return `<li data-bn="bn-info-card">${intro}${button(label, href, 'bordered')}</li>`;
          })
          .join('')}</ul>`
      : `<p>We cover the full range of ${esc(p.trade)} work. Tell us what you need and we will tell you straight whether we are the right people for it.</p>${priceOrQuote(p, 'Get a price', 'Get in touch')}`;
  const licensed = p.license
    ? `<li data-bn="bn-info-card"><h3>Licensed</h3><p>Licence ${esc(p.license)}. Ask to see the paperwork any time.</p></li>`
    : '';
  return `${renderPageHero({
    id: 'services',
    kicker: 'Services',
    headingHtml: `What ${esc(p.workspaceName)} does`,
    lead: `${p.trade} work for homes${p.areaSuffix}. If what you need is not on the list, ask — it is usually still a yes.`,
  })}
<section data-bn="bn-section"><div data-bn-column>${cards}</div></section>
<section data-bn="bn-section" aria-labelledby="areas-heading"><div data-bn-column>
  <p data-bn="bn-kicker">The deal</p>
  <h2 id="areas-heading" data-bn="bn-large-title">What you get either way</h2>
  <ul data-bn="bn-card-grid">
    ${licensed}
    <li data-bn="bn-info-card"><h3>Free written quotes</h3><p>You see the price before anything starts. If the job changes on the day, we tell you before we carry on.</p></li>
    <li data-bn="bn-info-card"><h3>We stand behind it</h3><p>If something we did is not right, tell us and we come back and put it right.</p></li>
  </ul>
</div></section>`;
}

export function aboutPage(p: TenantPages): string {
  const portrait = p.logoUrl
    ? `<img src="${esc(p.logoUrl)}" alt="${esc(p.workspaceName)} logo" width="200" height="120" data-bn="about-logo">`
    : markHtml({ ...p, attr: 'about-monogram' });
  const hours = p.hasHours
    ? `<section data-bn="hours" aria-labelledby="hours-heading"><div data-bn-column><h2 id="hours-heading" data-bn="bn-large-title">Hours</h2>${p.hours.map((row) => `<div data-bn="hours-row"><dt>${esc(row.day)}</dt><dd>${esc(row.times)}</dd></div>`).join('')}</div></section>`
    : '';
  return `${renderPageHero({
    id: 'about',
    kicker: 'About',
    headingHtml: esc(p.workspaceName),
    lead: `${p.trade} work for homes${p.areaSuffix}.`,
  })}
<section data-bn="bn-section"><div data-bn-column>
  ${portrait}
  <p data-bn="bn-kicker">${esc(p.trade)}</p>
  <h2 data-bn="bn-large-title">Plain answers and work that lasts</h2>
  <p>We do ${esc(p.trade)} work on homes${esc(p.areaSuffix)}. Most of it is the unglamorous kind: the thing that stopped working, the bit of the house that was never done properly, the upgrade you have been putting off.</p>
  <p>We will tell you what the job actually needs — including when it needs less than you thought. You get a written price before anything starts, a time window we keep to, and a tidy house when we leave.</p>
  ${button('Get a free quote', '/contact', 'prominent')}
  <ul data-bn="bn-card-grid">
    <li data-bn="bn-info-card"><h3>Straight answers</h3><p>If it is not our kind of job, or not worth doing, we say so before you spend anything.</p></li>
    <li data-bn="bn-info-card"><h3>Written quotes</h3><p>A price on paper before the first tool comes out — and we stick to it.</p></li>
    <li data-bn="bn-info-card"><h3>Times we keep</h3><p>A window, not a whole day. If we are running late you hear it from us first.</p></li>
  </ul>
</div></section>
${hours}
<section data-bn="bn-section" aria-labelledby="faq-heading"><div data-bn-column>
  <h2 id="faq-heading" data-bn="bn-large-title">Frequently Asked Questions</h2>
  ${renderFaqList(p.faqEntries.map((faq) => ({ question: faq.q, answer: faq.a })))}
</div></section>`;
}

export function contactPage(p: TenantPages): string {
  const invalid = (name: string): string =>
    p.formField === name ? ' aria-invalid="true"' : '';
  const hidden = p.formMessage ? '' : ' hidden';
  const status = p.formStatus ? ` data-bn-status="${esc(p.formStatus)}"` : '';
  const options = p.serviceTypes
    .map((svc) => `<option value="${esc(svc.name)}">${esc(svc.name)}</option>`)
    .join('');
  const nudge = p.hasQuote
    ? `<section data-bn="bn-section" aria-labelledby="quote-nudge-heading"><div data-bn-column>
      <h2 id="quote-nudge-heading" data-bn="bn-large-title">Want the price now?</h2>
      <p>For the jobs we price instantly, answering a few questions gets you a real range in about two minutes — no waiting on a call-back. The form below is still here if you would rather just describe it.</p>
      ${button('Get a price', '/quote', 'prominent')}
    </div></section>`
    : '';
  const phone = p.phone
    ? `<a href="tel:${esc(p.phone)}" data-bn="contact-detail-item"><span><strong>Rather talk?</strong>${esc(p.phoneDisplay)}</span></a>`
    : '';
  const email = p.email
    ? `<a href="mailto:${esc(p.email)}"><span><strong>Email instead</strong>${esc(p.email)}</span></a>`
    : '';
  const license = p.license
    ? `<div data-bn="contact-note"><strong>Licence ${esc(p.license)}</strong><p>Happy to show the paperwork before we start.</p></div>`
    : '';
  const next = p.hasQuote
    ? '<p>That is this form. <a href="/quote">The instant price</a> skips the wait for the jobs we can price from your answers alone.</p>'
    : '';
  return `${renderPageHero({
    id: 'contact',
    kicker: 'Free quote',
    headingHtml: 'Tell us about the job',
    lead: 'A few details is plenty. We will read it, work out what it needs, and come back to you within one business day.',
  })}
${nudge}
<section data-bn="bn-section"><div data-bn-column data-bn-narrow>
  <div id="form-message" data-bn="form-message" role="alert" aria-live="polite"${status}${hidden}>${esc(p.formMessage)}</div>
  <form id="lead-form" data-bn="lead-form" method="post" action="/leads" novalidate>
    <div data-bn="bn-field-row">
      <label data-bn="bn-field"><span>First name</span><input type="text" name="firstName" required autocomplete="given-name" placeholder="Jane" aria-required="true"${invalid('firstName')}></label>
      <label data-bn="bn-field"><span>Last name</span><input type="text" name="lastName" required autocomplete="family-name" placeholder="Smith" aria-required="true"${invalid('lastName')}></label>
    </div>
    <div data-bn="bn-field-row">
      <label data-bn="bn-field"><span>Email</span><input type="email" name="email" autocomplete="email" placeholder="jane@example.com"${invalid('email')}></label>
      <label data-bn="bn-field"><span>Phone</span><input type="tel" name="phone" autocomplete="tel" placeholder="(555) 123-4567"${invalid('phone')}></label>
    </div>
    <p data-bn="bn-note">Give us whichever one you would rather be contacted on.</p>
    <label data-bn="bn-field"><span>What do you need?</span><select name="serviceType" autocomplete="off"${invalid('serviceType')}><option value="">Choose the closest thing…</option>${options}<option value="Other">Something else / not sure</option></select></label>
    <label data-bn="bn-field"><span>Anything else we should know?</span><textarea name="notes" rows="4" placeholder="When it started, what you have tried, when suits you…"${invalid('notes')}></textarea></label>
    <div data-bn="hp-field" aria-hidden="true"><label>Website <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
    <label data-bn="bn-field"><span><input type="checkbox" name="consent" value="yes"> I agree that this business may contact me about my request by phone, text message, and email. Message and data rates may apply. Reply STOP to opt out of texts. Consent is not a condition of purchase.</span></label>
    <label data-bn="bn-field"><span><input type="checkbox" name="consentReroute" value="yes"> If this business cannot take my job, Greenput may share my request with another local business that can. (Optional — off unless you tick it.)</span></label>
    <button type="submit" data-bn="bn-button" data-variant="prominent" data-size="large">Send it to ${esc(p.workspaceName)}</button>
    <p data-bn="bn-note">This goes straight to ${esc(p.workspaceName)} and is used to answer your question. Nothing is sold on.</p>
  </form>
  <aside>
    <h2>What happens next</h2>
    <ol data-bn="bn-steps">
      <li>We read it — a person, not a robot.</li>
      <li>We come back within one business day, by whichever way you asked.</li>
      <li>If it needs a look, we book a time that suits you and quote in writing.</li>
    </ol>
    ${next}
    ${phone}
    ${email}
    ${license}
  </aside>
</div></section>`;
}

function documentIndexPage(
  p: TenantPages,
  kind: 'proposal' | 'invoice',
): string {
  const title = kind === 'proposal' ? 'Proposal' : 'Invoice';
  const heading =
    kind === 'proposal' ? 'Open the proposal link' : 'Open the invoice link';
  const lead =
    kind === 'proposal'
      ? `A proposal from ${p.workspaceName} opens from the link they sent. The address has the proposal on the end of it.`
      : `An invoice from ${p.workspaceName} opens from the link they sent. The address has the invoice on the end of it.`;
  const second = p.hasQuote
    ? button('Get a price', '/quote', 'bordered')
    : button('Get in touch', '/contact', 'bordered');
  return `<section data-bn="bn-section" aria-labelledby="${kind}-heading"><div data-bn-column>
    <p data-bn="bn-kicker">${title}</p>
    <h1 id="${kind}-heading" data-bn="bn-large-title">${heading}</h1>
    <p data-bn="bn-lead">${esc(lead)}</p>
    <p data-bn="bn-cluster">${button('Back to home', '/', 'prominent')}${second}</p>
  </div></section>`;
}

export function proposalIndexPage(p: TenantPages): string {
  return documentIndexPage(p, 'proposal');
}

export function invoiceIndexPage(p: TenantPages): string {
  return documentIndexPage(p, 'invoice');
}

export function notFoundPage(p: TenantPages): string {
  const second = p.hasQuote
    ? button('Get a price', '/quote', 'bordered')
    : button('Get in touch', '/contact', 'bordered');
  return `<section data-bn="not-found" aria-labelledby="not-found-heading"><div data-bn-column>
    <p data-bn="bn-kicker" aria-hidden="true">404</p>
    <h1 id="not-found-heading" data-bn="bn-large-title">That page has moved on</h1>
    <p data-bn="bn-lead">The link is out of date or the page is gone. Everything else still works.</p>
    <p data-bn="bn-cluster">${button('Back to home', '/', 'prominent')}${second}</p>
  </div></section>`;
}
