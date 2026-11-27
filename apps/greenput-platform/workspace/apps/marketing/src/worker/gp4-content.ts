import {
  aiContext,
  featuresContext,
  investorsContext,
  pricingContext,
  type PricingPlan,
} from './page-data.js';
import { OPERATOR_LEGAL_NAME, operatorByline } from './geo/entity.js';

/**
 * The marketing routes that PR #276 left on the old shell, restated in the
 * v4 section vocabulary (section / article / header / menu). Copy is the
 * copy those pages already served. Icons are the shared sprite.
 */

const check = '<svg aria-hidden="true"><use href="#i-check"/></svg>';
const chev = '<svg aria-hidden="true"><use href="#i-chev"/></svg>';
const minus = '<svg aria-hidden="true"><use href="#i-minus"/></svg>';

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function icon(id: string): string {
  return `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
}

/** A real capture from /screens. Alt text is the one /features already publishes for that file. */
function shot(
  id: string,
  priority: 'high' | 'lazy',
  file = `${id}.webp`,
): string {
  const feature = featuresContext.features.find((item) => item.id === id);
  if (!feature) throw new Error(`unknown screen ${id}`);
  const loading =
    priority === 'high' ? 'fetchpriority="high"' : 'loading="lazy"';
  return `<img src="/screens/${file}" alt="${esc(feature.screenshotAlt)}" width="1600" height="1000" ${loading} decoding="async">`;
}

function hero(options: {
  id: string;
  headingId: string;
  title: string;
  lead: string;
  extra?: string;
  /** Inner HTML of the hero figure: one img, or nested figures for the composite. */
  figure?: string;
}): string {
  const visual = options.figure ? `<figure>${options.figure}</figure>` : '';
  return `<section id="${options.id}" data-sec="s1" data-density="spacious" aria-labelledby="${options.headingId}"><header><h1 id="${options.headingId}">${options.title}</h1><p>${options.lead}</p>${options.extra ?? ''}</header>${visual}</section>`;
}

function prose(id: string, heading: string, body: string): string {
  return `<section data-density="spacious" aria-labelledby="${id}"><header><h2 id="${id}">${heading}</h2></header><article variant="flat">${body}</article></section>`;
}

function passage(body: string): string {
  return `<section data-density="spacious"><article variant="flat">${body}</article></section>`;
}

function cta(
  id: string,
  heading: string,
  paragraphs: string[],
  menu: string,
): string {
  const copy = paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('');
  return `<section data-density="spacious" aria-labelledby="${id}"><header><h2 id="${id}">${heading}</h2>${copy}<menu>${menu}</menu></header></section>`;
}

function faq(
  id: string,
  heading: string,
  items: ReadonlyArray<{ question: string; answer: string }>,
): string {
  const rows = items
    .map(
      (item) =>
        `<details><summary>${chev}${esc(item.question)}</summary><p>${esc(item.answer)}</p></details>`,
    )
    .join('');
  return `<section data-density="spacious" aria-labelledby="${id}"><header><h2 id="${id}">${heading}</h2></header>${rows}</section>`;
}

function planArticle(plan: PricingPlan): string {
  const items = plan.features
    .map((feature) => `<li>${check}${esc(feature)}</li>`)
    .join('');
  const variant = plan.featured ? 'featured' : 'raised';
  const featured = plan.featured ? ' data-featured' : '';
  const kicker = plan.featured ? '<p>Core revenue model</p>' : '';
  const button = plan.featured ? 'primary' : 'secondary';
  return `<article variant="${variant}"${featured}>${kicker}<h3>${esc(plan.name)}</h3><p>${esc(plan.priceLabel)}</p><p>${esc(plan.tagline)}</p><ul>${items}</ul><menu><li><a variant="${button}" href="${esc(plan.ctaHref)}">${esc(plan.cta)}</a></li></menu></article>`;
}

const pricingPlans = pricingContext.plans.map(planArticle).join('');

const verticalIcons = ['i-bolt', 'i-wrench', 'i-home'] as const;

const verticalRates = pricingContext.verticalRates
  .map((band, index) => {
    const items = band.verticals
      .map((vertical) => `<li>${esc(vertical)}</li>`)
      .join('');
    return `<li><article variant="plain">${icon(verticalIcons[index] ?? 'i-tag')}<h3>${esc(band.category)}</h3><ul>${items}</ul></article></li>`;
  })
  .join('');

export const pricingTemplate = `${hero({
  id: 'pricing',
  headingId: 'pricing-heading',
  title: 'Prepaid SMS. Outcome-tracked lead delivery.',
  lead: 'No subscription tiers. No "free" trial that converts to a monthly bill. Outbound SMS is paid from a prepaid balance that tops up from your card, and you pay a per-lead rate, set by vertical and service, for leads we deliver into your open schedule slots.',
  figure: shot('scheduling', 'high', 'scheduling-week.webp'),
})}
<section data-density="spacious" aria-labelledby="pricing-plans"><header><h2 id="pricing-plans">Pricing plans</h2></header>${pricingPlans}</section>
<section data-density="spacious" aria-labelledby="vertical-rates-heading"><header><h2 id="vertical-rates-heading">Rates by vertical and service</h2><p>Lead pricing is set per vertical and per service, not a flat rate — a solar install lead and a drain-cleaning lead aren’t worth the same to your business. We share the exact rate sheet during onboarding.</p></header><ul>${verticalRates}</ul></section>
${faq('faq-heading', 'Frequently Asked Questions', pricingContext.faqs)}`;

export const privacyTemplate = `${hero({
  id: 'privacy',
  headingId: 'privacy-heading',
  title: 'Privacy Policy',
  lead: 'Last updated October 22, 2026.',
})}
${passage(`<p>Greenput ("we", "us") builds CRM and marketing automation software for trade contractors. This policy covers what we collect on greenput.com and why — it does not cover the contractor-facing app, which is governed by each contractor’s own customer agreement.</p>`)}
${prose(
  'privacy-collect',
  'What we collect',
  '<p>When you submit the contact form, we collect your name, email address, company, trade, and message. We log the referring page and IP address of that submission to prevent spam. We do not use tracking cookies or third-party advertising pixels on this site.</p>',
)}
${prose(
  'privacy-use',
  'How we use it',
  `<p>We use contact form submissions to respond to your inquiry and, if you become a customer, to set up your workspace. We never sell your information. We share it only in these ways:</p>
<ul>
<li><strong>Infrastructure providers</strong> — with the services required to run Greenput (for example Cloudflare for hosting, and our email and SMS providers), only to operate the platform and respond to you.</li>
<li><strong>The contractor you choose</strong> — when you book or request a job, your name, phone number, service address, and job details go to that contractor, and only that contractor.</li>
<li><strong>A second contractor, only with your separate permission</strong> — if the shop you chose cannot take the job, Greenput may offer to pass your request to another verified contractor in the network. That happens only if you grant it, field by field, at the time. You receive a receipt showing exactly what was shared, with whom, and why — and you can revoke the grant.</li>
</ul>
<p>Every share under the last two bullets is recorded. You can ask us at any time what was shared, with whom, and under which grant.</p>`,
)}
${prose(
  'privacy-retention',
  'How long we keep it',
  '<p>We keep contact submissions for as long as needed to respond to you, or for the life of your account plus a reasonable period afterward if you become a customer.</p>',
)}
${prose(
  'privacy-rights',
  'Your rights',
  '<p>Use the <a href="/contact">contact form</a> at any time to access, correct, or delete the information we hold about you.</p>',
)}
${prose(
  'privacy-texts',
  'Text messages',
  `<p>GreenPut, operated by ${OPERATOR_LEGAL_NAME}, texts a mobile number only for two kinds of messages: one-time login and verification codes, and notifications about leads. Message frequency varies. Message and data rates may apply. Reply STOP to opt out and HELP for help. Consent to receive texts is not a condition of any purchase. We do not sell mobile numbers, and we do not share them with third parties for their own marketing.</p>`,
)}
${prose(
  'privacy-contact',
  'Contact us',
  `<p>Questions about this policy? <a href="/contact">Contact us</a>. ${operatorByline()}.</p>`,
)}`;

export const termsTemplate = `${hero({
  id: 'terms',
  headingId: 'terms-heading',
  title: 'Terms of Service',
  lead: 'Last updated October 22, 2026.',
})}
${passage(
  '<p>These terms cover your use of greenput.com, the marketing site. They’re short because the site itself only does two things: describes Greenput and takes contact form submissions.</p>',
)}
${prose(
  'terms-using',
  'Using this site',
  '<p>You may browse greenput.com and submit the contact form to reach us. Please don’t use the contact form to submit anything unlawful, abusive, or intended to disrupt the site.</p>',
)}
${prose(
  'terms-warranty',
  'No warranty',
  '<p>This site and its content are provided "as is". We do our best to keep information accurate, but pricing, feature descriptions, and availability can change without notice.</p>',
)}
${prose(
  'terms-product',
  'The Greenput product',
  '<p>If you become a Greenput customer, your use of the platform itself (app.greenput.com) is governed by a separate customer agreement provided during onboarding — these terms only cover the marketing site.</p>',
)}
${prose(
  'terms-changes',
  'Changes',
  '<p>We may update these terms as the site evolves. The date at the top of this page reflects the last update.</p>',
)}
${prose(
  'terms-texts',
  'Text messages',
  `<p>${operatorByline()}. If you give GreenPut a mobile number, we may text you one-time login and verification codes and notifications about leads. Message frequency varies. Message and data rates may apply. Reply STOP to cancel and HELP for help. Consent to receive text messages is not a condition of purchase or of using the site. Mobile numbers are not shared with third parties for their marketing.</p>`,
)}
${prose(
  'terms-contact',
  'Contact us',
  '<p>Questions about these terms? <a href="/contact">Contact us</a>.</p>',
)}`;

export const technologyTemplate = `${hero({
  id: 'technology',
  headingId: 'technology-heading',
  title: 'We measured it, so you don’t have to take our word for it',
  lead: 'Every number on this page comes from a Lighthouse report our own CI produces automatically — on the same reference site you can visit right now.',
  extra:
    '<menu><li><a href="{{ demoUrl }}" variant="accent" rel="noopener noreferrer">View the Live Reference Site</a></li></menu>',
  figure: shot('portal', 'high'),
})}
<section data-density="spacious"><figure>${shot('portal', 'lazy')}</figure><article variant="flat"><p>This is <strong>Rivertown Electric</strong> — a fictional residential electrician built entirely on the same tenant-site platform every Greenput contractor gets. It’s clearly labelled as a demo and kept out of search results (see Methodology below for why), but the HTML, CSS, and server it runs on are exactly what a paying customer’s site runs on.</p>
<p>We ran it — and two publicly available alternatives contractors are commonly sold today — through Google Lighthouse, on both mobile and desktop, on {{ measuredOn }}.</p></article></section>
<section data-density="spacious" aria-labelledby="tech-scores-heading"><header><h2 id="tech-scores-heading">Lighthouse scores (mobile)</h2></header>
<ul>
<template @for="site of sites; track site.id">
<li><article variant="plain" :data-featured="site.isGreenput ? '' : null"><h3>{{ site.name }}</h3>
<ul data-bn="bn-metrics">
<li data-bn="bn-metric"><strong>{{ site.mobile.performance }}</strong><small>Performance</small></li>
<li data-bn="bn-metric"><strong>{{ site.mobile.accessibility }}</strong><small>Accessibility</small></li>
<li data-bn="bn-metric"><strong>{{ site.mobile.bestPractices }}</strong><small>Best practices</small></li>
<li data-bn="bn-metric"><strong>{{ site.mobile.seo }}</strong><small>SEO</small></li>
</ul>
<p>{{ site.pageWeightKb }} KB · {{ site.requests }} requests · {{ site.lcpMobileMs }}ms LCP</p>
</article></li>
</template>
</ul>
<p>* Greenput’s SEO score excludes Lighthouse’s "is-crawlable" check — the demo tenant is deliberately noindexed so it never competes with a real customer in search results. A real Greenput tenant site is not noindexed. See Methodology.</p>
</section>
<section data-density="spacious" aria-labelledby="tech-table-heading"><header><h2 id="tech-table-heading">The full comparison</h2></header>
<figure tabindex="0" role="region" aria-labelledby="tech-table-heading">
<table>
<thead>
<tr>
<th scope="col">Site</th>
<th scope="col">Perf. (mobile / desktop)</th>
<th scope="col">Access. (mobile / desktop)</th>
<th scope="col">Best Practices (mobile / desktop)</th>
<th scope="col">SEO (mobile / desktop)</th>
<th scope="col">LCP (mobile)</th>
<th scope="col">Page weight</th>
<th scope="col">Requests</th>
</tr>
</thead>
<tbody>
<template @for="site of sites; track site.id">
<tr :data-featured="site.isGreenput ? '' : null">
<th scope="row">{{ site.name }}</th>
<td>{{ site.mobile.performance }} / {{ site.desktop.performance }}</td>
<td>{{ site.mobile.accessibility }} / {{ site.desktop.accessibility }}</td>
<td>{{ site.mobile.bestPractices }} / {{ site.desktop.bestPractices }}</td>
<td>{{ site.mobile.seo }} / {{ site.desktop.seo }}</td>
<td>{{ site.lcpMobileMs }}ms</td>
<td>{{ site.pageWeightKb }} KB</td>
<td>{{ site.requests }}</td>
</tr>
</template>
</tbody>
</table>
</figure>
</section>
<section data-density="spacious" aria-labelledby="tech-produces"><header><h2 id="tech-produces">What actually produces these numbers</h2></header><ul><li><article variant="plain">${icon('i-code')}<h3>Server-rendered HTML, no framework runtime tax</h3><p>Every tenant page is rendered to plain HTML on Cloudflare’s edge with <code>@basenative/server</code> — there’s no client-side framework to download, hydrate, or execute before the page is usable. That’s most of why Total Blocking Time measured 0ms on the reference site above: there’s barely any JavaScript to block the main thread with in the first place.</p></article></li><li><article variant="plain">${icon('i-doc')}<h3>Structured data by default</h3><p>Every tenant page ships LocalBusiness JSON-LD from that contractor’s own row: name, and phone, email, or address only when the row has them. The About page’s FAQ is the same list the page shows — a licence line only when a licence number is stored, a service area only from the city and state on file, and a one-business-day response line. There is no question offering an estimate at no charge, and no insurance claim. FAQPage markup is built from that same list.</p></article></li><li><article variant="plain">${icon('i-eye')}<h3>Image handling — not demonstrated here</h3><p>The reference site above intentionally ships with no photos, so none of the numbers above include image weight — we didn’t want to invent stock photography that could read as a real business’s real work. In production, tenant logos and job photos are served through Cloudflare’s image resizing, so a real tenant’s own numbers will include images and may differ from what’s shown here.</p></article></li><li><article variant="plain">${icon('i-shield')}<h3>Security headers on every response</h3><p>Content-Security-Policy, HSTS, X-Frame-Options, and the rest are set on every response by default, not bolted on after the fact.</p></article></li></ul></section>
<section data-density="spacious" aria-labelledby="tech-method"><header><h2 id="tech-method">Methodology</h2></header><ul><li>${icon('i-gauge')}<p>We ran <a href="https://developer.chrome.com/docs/lighthouse/overview" rel="noopener noreferrer">Google Lighthouse</a> against each site, on both a throttled mobile connection and desktop, using the same script our own CI runs on every push to main (<code>scripts/audit/lighthouse.mjs</code>). After staging deploys, CI re-runs it against the reference site’s always-on staging deployment as a post-deploy check, and fails that run when performance or best-practices drop below 90, or accessibility or SEO drops below 95.</p></li><li>${icon('i-search')}<p>The two comparison sites are a mainstream SaaS website-builder’s own public template preview and a free, publicly downloadable HTML template — both real, both live at the time of measurement, and both measured on {{ measuredOn }}. We’re deliberately not naming or linking either one: this page exists to make an honest, provable point about a category of product contractors are sold today, not to call out a specific business or template author.</p></li><li>${icon('i-shield')}<p>What we didn’t do: we didn’t audit any specific competitor’s paying customer site, we didn’t invent numbers for anything we couldn’t measure ourselves, and we didn’t give the reference site any credential, license number, or testimonial it doesn’t actually have.</p></li></ul></section>
${cta(
  'tech-cta-heading',
  'Want this for your business?',
  [
    'Every Greenput tenant site is built on the same platform as the reference site above.',
  ],
  '<li><a href="https://app.greenput.com/onboarding" variant="accent">Get Started</a></li>',
)}`;

const toolIcons = ['i-search', 'i-doc', 'i-lock'] as const;

const aiTools = aiContext.tools
  .map(
    (tool, index) =>
      `<li><article variant="plain">${icon(toolIcons[index] ?? 'i-code')}<h3><code>${esc(tool.name)}</code></h3><p>${esc(tool.summary)}</p><p>${esc(tool.access)}</p></article></li>`,
  )
  .join('');

const modelIcons = [
  'i-receipt',
  'i-layers',
  'i-heart-hand',
  'i-chart',
] as const;

const investorCards = investorsContext.modelPoints
  .map(
    (point, index) =>
      `<li><article variant="plain">${icon(modelIcons[index] ?? 'i-flag')}<h3>${esc(point.title)}</h3><p>${esc(point.description)}</p></article></li>`,
  )
  .join('');

const compoundIcons = ['i-bolt', 'i-flag', 'i-loop'] as const;

const compoundCards = investorsContext.compoundPoints
  .map(
    (point, index) =>
      `<li><article variant="plain">${icon(compoundIcons[index] ?? 'i-layers')}<h3>${esc(point.title)}</h3><p>${esc(point.description)}</p></article></li>`,
  )
  .join('');

export const aiTemplate = `${hero({
  id: 'ai',
  headingId: 'ai-heading',
  title:
    'The assistant can book the job. Only the customer can share the details.',
  lead: 'A homeowner asks ChatGPT or Claude for an electrician. The way that assistant would find a verified contractor, start a quote, and hand off a booking is specified, and a prototype of it runs on mock data. It is not listed in the ChatGPT or Claude directories, and nothing on this page is a live shop. Nothing about a customer moves until they grant the share: field by field, to one shop, for one purpose, with a receipt they keep.',
  figure: shot('scheduling', 'high', 'scheduling-week.webp'),
})}
<section data-density="spacious" aria-labelledby="ai-grant-heading"><header><h2 id="ai-grant-heading">Sharing is a grant, not a checkbox</h2><p>Booking shares data — and only under an explicit grant, the way a GitHub App install makes you pick the org and the repos before anything is shared. There is no bundled consent and no pre-approved version of it.</p></header><ul><li><article variant="plain">${icon('i-lock')}<h3>Per shop, per field</h3><p>A grant names one shop and the exact fields it may receive: name, phone, email, service address, job details, photos. Fields the customer did not grant are dropped, even if the assistant sends them.</p></article></li><li><article variant="plain">${icon('i-flag')}<h3>One purpose</h3><p>“quote-and-schedule” is the only purpose in v1. A grant cannot be repurposed for marketing or anything else.</p></article></li><li><article variant="plain">${icon('i-loop')}<h3>Rerouting needs its own yes</h3><p>If the picked shop cannot take the job, handing it to another shop is a new share. The grant carries an allow_network_reroute flag; without it, the booking stays with the shop the customer chose.</p></article></li><li><article variant="plain">${icon('i-receipt')}<h3>Every share is receipted</h3><p>The booking returns a sharing receipt: a grant id, who received what, for what purpose, and when. The customer keeps the proof, can revoke the grant, and can cancel, switch shops, and port their data at any time.</p></article></li></ul><p>For the customer, that is control they can point to instead of a privacy policy they have to trust. For the contractor, it is the other half of the same deal: the booking that arrives is consented, qualified, and priced — not a scraped lead sold to five shops at once.</p></section>
<section data-density="spacious" aria-labelledby="ai-demo-heading"><header><h2 id="ai-demo-heading">One booking, start to finish</h2><p>This is the designed flow, drawn the way the customer experiences it — an illustrated walkthrough, not screenshots and not a protocol log. The shops, the name and the prices are demo data from the prototype’s test fixtures; the real directory opens with the first verified cohort. What is not illustrative is the order: verified results first, a quote before any commitment, the grant before anything is shared, and a receipt after.</p><p>Illustrated walkthrough · Demo data</p></header>
<ul data-walkthrough>
<li><article variant="plain"><p>Step 1 The ask</p><blockquote><p><b>Homeowner</b>I need an electrician near Irvine to install a Tesla Wall Connector this week.</p><p><b>Assistant</b>I’ll search Greenput’s verified contractor directory for electricians near Irvine who install Wall Connectors.</p></blockquote></article></li>
<li><article variant="plain"><p>Step 2 The answer — verified shops, and a quote before anyone commits</p><blockquote><p><b>Assistant</b>Two verified electricians cover Irvine and install Wall Connectors. No price is shown yet. As you answer the shop’s quote questions (panel photo, charger location), a price takes shape, and you book at one exact number, before anyone has seen the job in person.</p></blockquote>
<ul>
<li><article variant="plain"><header><h3>Irvine Electric Co.</h3><p>${check}Greenput Verified</p></header><p>Wall Connector certified · CSLB C-10 licensed · 2.3 mi away · Rated 4.9 across 38 completed jobs · Books into their schedule — they confirm the details with you</p><p>Wall Connector install<strong>Price: answer a few questions to start your quote</strong></p><p><b variant="primary">Book Irvine Electric Co.</b></p></article></li>
<li><article variant="plain"><header><h3>Tustin Power &amp; Light</h3><p>${check}Greenput Verified</p></header><p>Wall Connector certified · CSLB C-10 licensed · 4.1 mi away · Rated 4.8 across 51 completed jobs · Books into their schedule — they confirm the details with you</p><p>Wall Connector install<strong>Price: answer a few questions to start your quote</strong></p><p><b variant="primary">Book Tustin Power &amp; Light</b></p></article></li>
</ul>
<blockquote><p><b>Homeowner</b>Book Irvine Electric Co.</p></blockquote></article></li>
<li><article variant="plain"><p>Step 3 The grant — the screen the booking stops for</p>
<article variant="raised"><p>Greenput</p><p><strong>Irvine Electric Co.</strong> asked Greenput to book your Wall Connector install. Greenput will share only the details you approve below — with that one shop, and no one else.</p><p>Purpose: so they can quote and schedule your install. Nothing else — no marketing, no resale, no other shops.</p>
<ul>
<li>${check}<b>Name</b><small>Alex Rivera</small></li>
<li>${check}<b>Phone number</b><small>(949) 555-0134</small></li>
<li>${check}<b>Service address</b><small>12 Main St, Irvine</small></li>
<li>${check}<b>Job details</b><small>Tesla Wall Connector install, this week — panel photos attached</small></li>
</ul>
<aside data-state="off">${minus}<p><strong>If Irvine Electric Co. can’t take the job</strong>, share my details with another verified contractor instead. Off unless you turn it on — a reroute is a new share, so it needs its own yes.</p></aside>
<p><b variant="primary">Grant &amp; book</b><b variant="secondary">Cancel</b></p>
</article>
<p>Skip or decline this screen and the booking stops there: the server records nothing and shares nothing. There is no pre-approved version of this screen.</p>
</article></li>
<li><article variant="plain"><p>Step 4 The receipt — the homeowner keeps the proof</p>
<article variant="raised"><p>${check}Booked with Irvine Electric Co.</p><p>Irvine Electric is enrolled in schedule management, so that grant books the job into an open slot on their calendar. The shop confirms the booking and the details with the customer directly — and the customer can cancel, or take the job to a different shop, at any point. And the customer keeps a receipt of the share itself:</p>
<dl>
<dt>Shared</dt><dd>Name, phone number, service address, job details</dd>
<dt>With</dt><dd>Irvine Electric Co. — the shop you picked, and no one else</dd>
<dt>For</dt><dd>Quoting and scheduling your Wall Connector install — the one purpose on the grant</dd>
<dt>When</dt><dd>Today, 2:41 PM · Grant GP-2481</dd>
<dt>Not shared</dt><dd>Network reroute — you left it off, so if this shop can’t take the job, Greenput asks you again instead of passing your details on</dd>
</dl>
<p><b variant="secondary">Revoke this grant</b></p>
<p>Revoking stops any future sharing under this grant. The shop keeps what it already received, only to run the job you booked.</p>
</article></article></li>
</ul>
</section>
<section data-density="spacious" aria-labelledby="ai-tools-heading"><header><h2 id="ai-tools-heading">Under the hood: one server, three tools</h2><p>The prototype defines one MCP server, called <code>greenput-discovery</code> — the open protocol ChatGPT and Claude both use to call tools. It is not deployed, and no assistant directory lists it. These are the only three tools it defines. There is no qualify tool, and <code>start_quote</code> returns no price — in the prototype it does not run the engine’s questions:</p></header>
<ul>${aiTools}</ul>
<p>The two read-only tools learn nothing about the customer. The booking tool is the only one that can share anything — and it refuses to run until the customer grants the share, field by field, as shown above.</p>
</section>
<section data-density="spacious" aria-labelledby="ai-status-heading"><header><h2 id="ai-status-heading">Where this stands</h2></header><ul><li>${icon('i-flag')}<p>Plainly: the server above is a working prototype, built and contract-tested against the three tools described on this page. It runs on mock data only. It is not yet listed in the ChatGPT or Claude directories, and it has not been submitted to them.</p></li><li>${icon('i-pin')}<p>The directory opens with Greenput’s first verified contractor cohort in Orange County. We submit to the assistant directories only when a real query — “EV charger installer near Irvine” — returns real shops with real prices. Until then, every response the server gives is sample data, and it labels itself sample in the response — which is why the walkthrough above runs on labeled demo data from the same fixtures. Greenput does not present mock inventory as real, here or anywhere else.</p></li><li>${icon('i-doc')}<p>What an assistant can cite today, with no demo shops in it, is the <a href="/guides">homeowner guides</a>: Wall Connector, panel capacity, Powerwall (which this product does not quote), and why no install price is published on this domain.</p></li></ul></section>
${cta(
  'ai-cta-heading',
  'Be the shop the assistant books',
  [
    'The first verified cohort in Orange County is forming now. Create a Greenput account and complete your verified profile, and when the directory opens your shop is what the assistant searches, prices, and books — in the same pipeline, at the same one price per delivered lead, as your website demand.',
  ],
  '<li><a href="https://app.greenput.com/onboarding" variant="accent">Get Started</a></li><li><a href="/pricing" variant="secondary">See pricing</a></li>',
)}`;

export const investorsTemplate = `${hero({
  id: 'investors',
  headingId: 'investors-heading',
  title: 'Booked jobs, not bought leads.',
  lead: 'Greenput is the operating system for trade contractors — a lead-to-payment platform that charges one price per delivered lead, so contractors pay for booked jobs, not bought leads. Greenput is raising $1M on a standard YC post-money SAFE: cap-only, $8M cap, no discount, no MFN.',
  figure: `<figure>${shot('leads', 'high')}</figure><figure>${shot('scheduling', 'lazy', 'scheduling-week.webp')}</figure>`,
})}
<section data-density="spacious" aria-labelledby="investors-opening-heading"><header><h2 id="investors-opening-heading">The wedge: the directory stops at the phone number</h2><p>Tesla’s certified installer program counts 7,000+ installers in 35+ countries, with 1M+ installations behind it — the largest trained installer network in home electrification. When a customer finds a shop through it, the directory hands them a business name, a phone number, and a website, and stops.</p><p>Everything after that click — the quote, the scheduling, the completion, the payment — is unowned. The shop runs it on phone calls and callbacks; the customer waits. That unowned stretch, from first click to payment, is the business Greenput is. Tesla One handles Tesla product ordering and quoting; Greenput runs all of the shop’s work, Tesla and non-Tesla, from first click to payment.</p></header><figure>${shot('portal', 'lazy')}</figure></section>
<section data-density="spacious" aria-labelledby="investors-model-heading"><header><h2 id="investors-model-heading">The model</h2><p>Everything a contractor pays Greenput sits in four rules:</p></header>
<ul>${investorCards}</ul>
<p>No booking carries a deposit. At booking, the contractor pays the per-lead price — one flat price per booked job, regardless of source. After booking, the shop confirms the details directly with the customer, and both sides can confirm in Greenput: that bilateral confirmation locks the details — the quote’s price, the address, the appointment. It is never the billing gate — the fee billed at booking already stands. Customers can cancel, switch shops, and port their data at any time.</p>
</section>
<section data-density="spacious" aria-labelledby="investors-compounds-heading"><header><h2 id="investors-compounds-heading">Why it compounds</h2></header><ul>${compoundCards}</ul></section>
<section data-density="spacious" aria-labelledby="investors-status-heading"><header><h2 id="investors-status-heading">Where it stands, and what happens next</h2><p>Stated plainly, the way our llms.txt states it: Greenput is a built product in beta. It is pre-first-user and pre-revenue.</p><p>Shipped in October 2026: a persisted consent record that stands ahead of every customer text — no record, no send; the network pool mechanism, with cross-shop reassignment under the customer’s grant; and schedule-aware delivery that auto-books a delivered job into a shop’s open slots under the shop’s own rules for time windows, service coverage and team enrollment.</p><p>A pilot is being set now with a Tesla-certified electrician in Orange County at $1 per lead — priced to prove the mechanics, not to make money. It is the first shop of the proof cohort. From here the sequence is short: close the round, the founder goes full-time, a cohort of 5–10 electricians goes live and transacting, and the quote-to-paid dataset starts compounding. That cohort’s record is the evidence the next round prices on.</p></header><figure>${shot('customers', 'lazy')}</figure></section>
<section data-density="spacious" aria-labelledby="investors-round-heading"><header><h2 id="investors-round-heading">The round</h2></header><ul><li>${icon('i-card')}<p>Greenput is raising $1M on a standard YC post-money SAFE. Cap-only: an $8M cap, no discount, no MFN. Those are the whole terms — there is no range and no second set.</p></li><li>${icon('i-clock')}<p>The money buys 18–24 months of runway: the founder goes full-time at close, and a proof cohort of 5–10 electricians goes live and transacting in the first vertical.</p></li><li>${icon('i-doc')}<p>The data room — the product, the plan and the numbers behind this page — is available on request.</p></li></ul></section>
${cta(
  'investors-cta-heading',
  'Ask for the data room',
  [
    'If you invest in marketplaces, vertical software, or the trades, ask for the data room: the product, the plan, and the numbers behind this page. You get access, not a deck tour.',
  ],
  '<li><a href="/contact" variant="accent">Talk to us</a></li>',
)}`;

export const notFoundTemplate = `<section data-sec="s1" data-density="spacious" aria-labelledby="not-found-heading"><header><p aria-hidden="true">404</p><h1 id="not-found-heading">We couldn’t find that page</h1><p>The page you’re looking for may have moved, or never existed. Let’s get you back on track.</p><menu><li><a href="/" variant="accent">Back to home</a></li><li><a href="/contact" variant="ghost">Contact us</a></li></menu></header><figure>${shot('leads', 'high')}</figure></section>`;
