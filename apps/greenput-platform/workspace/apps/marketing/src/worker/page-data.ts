import {
  DEFAULT_USAGE_THRESHOLD_CENTS,
  DEFAULT_USAGE_TOPUP_CENTS,
  TWILIO_US_SMS_SEGMENT_MICRO_USD,
} from '@greenput/shared/notifications';

/** Dollars, from the same constants the API charges. $0.0083 stays four places. */
const SMS_SEGMENT_USD = (TWILIO_US_SMS_SEGMENT_MICRO_USD / 1_000_000).toFixed(
  4,
);
const SMS_TOPUP_USD = DEFAULT_USAGE_TOPUP_CENTS / 100;
const SMS_THRESHOLD_USD = DEFAULT_USAGE_THRESHOLD_CENTS / 100;

const SMS_PASS_THROUGH = `Outbound SMS (a booking text or a chat fallback) is paid from a prepaid balance. Greenput reserves Twilio’s published US list price ($${SMS_SEGMENT_USD} per segment), then adjusts the balance to the price Twilio reports. When the balance drops below $${SMS_THRESHOLD_USD}, the card on file is charged $${SMS_TOPUP_USD}. Both amounts are configurable in Settings → Billing. If the balance cannot cover the message and that charge is not collected, those texts are blocked and lead delivery pauses until the card is updated and the charge is collected. Sign-in and verification codes are paid by Greenput and are not charged to the workspace. Cloudflare request volume is not billed. Stripe’s processing fee is taken by Stripe from each card charge, not as a separate invoice line. The per-lead price for a booked job is charged at booking, one charge per booked job, and is not taken from this balance.`;

export interface StatItem {
  label: string;
  value: string;
  growth: string | null;
}

export interface PipelineStage {
  name: string;
  slug: string;
  count: number;
}

export interface PainPoint {
  /** Stroke path drawn on the same 24-unit grid as every other Greenput
   *  icon. It replaced an emoji, which rendered as a tofu box on any
   *  machine without an emoji font and never matched the icon set. */
  iconPath: string;
  title: string;
  description: string;
}

export interface HomeFeature {
  title: string;
  description: string;
  iconPath: string;
  badge?: string;
}

export interface PipelineStep {
  step: string;
  title: string;
  description: string;
}

export interface HomePlan {
  name: string;
  /** Short label like "At cost" or "Per lead". No subscription tiers. */
  priceLabel: string;
  tagline: string;
  featured: boolean;
  cta: string;
  ctaHref: string;
  features: string[];
}

export interface HomeContext {
  stats: StatItem[];
  pipeline: PipelineStage[];
  painPoints: PainPoint[];
  features: HomeFeature[];
  pipelineSteps: PipelineStep[];
  plans: HomePlan[];
}

export const homeContext: HomeContext = {
  stats: [
    { label: 'Leads This Month', value: '24', growth: '18' },
    { label: 'Active Jobs', value: '7', growth: null },
    { label: 'Revenue MTD', value: '$12,400', growth: '23' },
    { label: 'Conversion Rate', value: '68%', growth: null },
  ],
  pipeline: [
    { name: 'New', slug: 'new', count: 8 },
    { name: 'Contacted', slug: 'contacted', count: 5 },
    { name: 'Qualified', slug: 'qualified', count: 6 },
    { name: 'Converted', slug: 'converted', count: 5 },
  ],
  painPoints: [
    {
      iconPath:
        'M9 4h6v3H9zM7 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1M8.5 12.5l1.5 1.5 3-3.5',
      title: 'Leads fall through the cracks',
      description:
        'Phone calls go unreturned. Sticky notes get lost. Potential customers hire the competitor who followed up.',
    },
    {
      iconPath: 'M3 5h18v16H3zM3 10h18M8 3v4M16 3v4M8.5 14l1.5 1.5 3-3',
      title: 'Scheduling is a nightmare',
      description:
        'Double-booking, missed jobs, and last-minute scrambles waste time and damage your reputation.',
    },
    {
      iconPath:
        'M3 6h18v9H3zM12 8.2a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6M6 19h12',
      title: 'Getting paid takes forever',
      description:
        'Paper invoices, forgotten follow-ups, and slow payment cycles kill cash flow for growing businesses.',
    },
    {
      iconPath: 'M4 20V4M4 20h16M8 16V11M12.5 16V7M17 16v-3',
      title: 'No visibility into your business',
      description:
        'Without real data, you can’t see which services are most profitable or which team members are most effective.',
    },
    {
      iconPath:
        'M4 10v4a1 1 0 0 0 1 1h2l5 4V5L7 9H5a1 1 0 0 0-1 1ZM17 9.5a4 4 0 0 1 0 5',
      title: 'Marketing is hit or miss',
      description:
        'You’re spending money on ads and referrals without knowing what actually brings in good customers.',
    },
    {
      iconPath: 'M4 7h7l2 2h7v10H4zM9 13h6M9 16h4',
      title: 'Customer data is scattered',
      description:
        'Job history, contact info, and notes spread across email, spreadsheets, and your memory.',
    },
  ],
  features: [
    {
      title: 'Lead Management',
      description:
        'Capture leads from your website, referrals, and campaigns. Track every contact from first touch to closed job.',
      iconPath:
        'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
    },
    {
      title: 'Job Scheduling',
      description:
        'Visual calendar with drag-and-drop scheduling. Assign jobs to crew members and prevent double-booking.',
      iconPath:
        'M8 2v4 M16 2v4 M3 10h18 M3 6h18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z',
    },
    {
      title: 'Invoicing & Payments',
      description:
        'Render an invoice from a job and share the link. Taking a card in the customer’s browser is not shipped yet.',
      iconPath:
        'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8',
    },
    {
      title: 'Customer Portal',
      badge: 'Coming soon',
      description:
        'Give customers a dedicated portal to view job status, approve estimates, and make payments.',
      iconPath:
        'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
    },
    {
      title: 'Campaign Tracking',
      description:
        'Run marketing campaigns and track which channels generate the best leads and highest job values.',
      iconPath: 'M22 12h-4l-3 9L9 3l-3 9H2',
    },
    {
      title: 'Business Insights',
      description:
        'Real-time dashboards showing revenue trends, team performance, and pipeline health at a glance.',
      iconPath: 'M3 3v18h18 M18.4 9.4l-4.8 4.8-2.8-2.8-4 4',
    },
  ],
  pipelineSteps: [
    {
      step: '1',
      title: 'Quote',
      description:
        'The quote is the first thing. The homeowner starts a quote, and the engine’s questions happen inside it — which service, where the job is, hardwired or plug-in, a photo of the electrical panel. No price at first; as the answers land, a range firms into one exact quote.',
    },
    {
      step: '2',
      title: 'Book',
      description:
        'The homeowner books at that exact quote, into a real slot on the shop’s schedule. At booking, the contractor pays the per-lead price — one flat price per booked job, regardless of source.',
    },
    {
      step: '3',
      title: 'Arrive',
      description:
        'The contractor files an arrival record at the address, verifies the job’s facts on site against the ticket, and confirms the price before any work begins.',
    },
    {
      step: '4',
      title: 'Work',
      description:
        'The work runs off the ticket. A price change moves as a change request on the ticket, approved by the customer on their own device before the changed work proceeds — never as a surprise on the invoice.',
    },
    {
      step: '5',
      title: 'Close',
      description:
        'The customer confirms completion, the engine-written invoice settles, and the job is tracked to its outcome: quoted → scheduled → completed → paid.',
    },
  ],
  plans: [
    {
      name: 'Prepaid SMS',
      priceLabel: 'At cost',
      tagline:
        'Outbound SMS is paid from a prepaid balance that tops up from the card on file.',
      featured: false,
      cta: 'See full pricing',
      ctaHref: '/pricing',
      features: [
        `Twilio SMS — $${SMS_SEGMENT_USD} per segment, then adjusted to Twilio’s price`,
        `$${SMS_TOPUP_USD} top-up when the balance falls below $${SMS_THRESHOLD_USD}`,
        'Sign-in codes are not charged to the workspace',
        'Cloudflare request volume is not billed',
        'No bundled "infrastructure fee"',
      ],
    },
    {
      name: 'Outcome-tracked lead delivery',
      priceLabel: 'Per delivered lead',
      tagline:
        'Leads priced per vertical and per service — an EV-charger install lead and a drain-cleaning lead are priced differently. Lead delivery pauses when your schedule fills up. Every delivered lead is tracked to its outcome: quoted, scheduled, completed, paid.',
      featured: true,
      cta: 'Talk to us',
      ctaHref: '/contact',
      features: [
        'Priced per vertical and per service',
        'Lead delivery pauses when your schedule is full',
        'One contractor per lead, unless the customer grants a reroute',
        'Every delivered lead’s outcome is recorded: quoted, scheduled, completed, paid. Those records do not recalibrate prices yet',
        'No subscription tier',
        'No commitment',
      ],
    },
  ],
};

export interface FeatureDetail {
  id: string;
  tag: string;
  title: string;
  description: string;
  reverse: boolean;
  /**
   * `<img alt>` for the product screenshot at `/screens/<id>.webp` —
   * captured from the real app by scripts/screenshots/capture.mjs, never a
   * mockup. Describe what the picture shows, not the feature.
   */
  screenshotAlt: string;
  bullets: string[];
  badge?: string;
}

export interface Integration {
  name: string;
  category: string;
  badge?: string;
}

export interface FeaturesContext {
  features: FeatureDetail[];
  integrations: Integration[];
}

export const featuresContext: FeaturesContext = {
  features: [
    {
      id: 'leads',
      tag: 'Lead Management',
      title: 'Never Lose a Lead Again',
      description:
        'Every lead — from your website, a referral, or a campaign — lands in one place. Track their journey from first contact to signed job.',
      reverse: false,
      screenshotAlt:
        'The Leads kanban in Greenput: New, Contacted, Qualified, Unqualified and Converted columns with a card per lead showing the job they asked about',
      bullets: [
        'Automatic lead capture from website contact forms',
        'Visual pipeline with drag-and-drop status updates',
        'Lead source tracking for marketing ROI',
        'Activity log from first contact to conversion',
        'Convert leads to opportunities with one click',
      ],
    },
    {
      id: 'scheduling',
      tag: 'Job Scheduling',
      title: 'Scheduling That Respects Your Time',
      description:
        'A visual calendar built for service businesses. Assign jobs to crew, manage availability, and eliminate double-booking.',
      reverse: true,
      screenshotAlt:
        'The Jobs calendar in Greenput: a week grid with six scheduled jobs placed across Monday to Friday',
      bullets: [
        'Drag-and-drop calendar with weekly and monthly views',
        'Multi-technician dispatch board',
        'Automated conflict detection and availability checks',
        'Customer appointment confirmations via email or SMS (coming soon)',
        'Mobile app for on-site job management (coming soon)',
      ],
    },
    {
      id: 'invoicing',
      tag: 'Invoicing & Payments',
      title: 'Get Paid Faster',
      description:
        'Render an invoice from a completed job and share the link. Taking a card in the customer’s browser is not shipped yet.',
      reverse: false,
      screenshotAlt:
        'An invoice Greenput generated from a completed job: three line items, the total due, and the contractor’s details at the top',
      bullets: [
        'Render an invoice when you mark the job invoiced',
        'Accept credit cards, ACH, and digital wallets (coming soon)',
        'On-site payment collection via mobile app (coming soon)',
        'Invoice status on the job: open, invoiced, or paid',
        'QuickBooks and Xero integration (coming soon)',
      ],
    },
    {
      id: 'customers',
      tag: 'Customer Management',
      title: 'Know Your Customers, Build Loyalty',
      description:
        'Complete customer profiles with job history, notes, and lifetime value tracking.',
      reverse: true,
      screenshotAlt:
        'A customer’s page in Greenput: contact details, lifetime value, and a job history table with an invoiced job',
      bullets: [
        'Full job and payment history per customer',
        'Notes on the customer, plus the jobs already on file',
        'Lifetime value and job frequency metrics',
        'Customer portal for self-service status checking (coming soon)',
        'Service review collection (coming soon)',
      ],
    },
    {
      id: 'portal',
      tag: 'Customer Portal',
      badge: 'Coming soon',
      title: 'Impress Customers with a Professional Portal',
      description:
        'Give every customer a dedicated portal where they can view job status, approve estimates, and make payments — without calling you.',
      reverse: false,
      screenshotAlt:
        'The proposal page a customer opens from the link their contractor sends: line items, tax, total and the acceptance status',
      bullets: [
        'Real-time job status tracking (coming soon)',
        'Online estimate approval and rejection (coming soon)',
        'Secure payment processing (coming soon)',
        'Invoice history and receipts (coming soon)',
        'Direct messaging to your office (coming soon)',
      ],
    },
  ],
  // Only vendors the code actually calls. Stripe and Twilio are real
  // clients. Email goes out through MailChannels (libs/shared/notifications),
  // not SendGrid. Nothing talks to Google Maps, QuickBooks, Google Business
  // Profile, Nextdoor, or Zapier — those stay labeled coming soon.
  integrations: [
    { name: 'Stripe', category: 'Payments' },
    { name: 'Twilio', category: 'SMS' },
    { name: 'MailChannels', category: 'Email' },
    { name: 'Cloudflare', category: 'Hosting' },
    { name: 'QuickBooks', category: 'Accounting', badge: 'Coming soon' },
    {
      name: 'Google Business Profile',
      category: 'Reviews',
      badge: 'Coming soon',
    },
    { name: 'Nextdoor', category: 'Marketing', badge: 'Coming soon' },
    { name: 'Zapier', category: 'Automation', badge: 'Coming soon' },
  ],
};

export interface PricingPlan {
  name: string;
  /** Short label like "At cost" or "Per delivered lead". No subscription tiers. */
  priceLabel: string;
  tagline: string;
  featured: boolean;
  cta: string;
  ctaHref: string;
  features: string[];
}

export interface VerticalRate {
  category: string;
  verticals: string[];
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface PricingContext {
  /**
   * The page’s abstract — what /pricing says in one breath. It is the meta
   * description (index.ts) and is written from the page’s own lead, so the
   * search snippet cannot describe a different product from the page it
   * links to (GP-045). Keep it under ~155 characters.
   */
  description: string;
  plans: PricingPlan[];
  verticalRates: VerticalRate[];
  faqs: FaqItem[];
}

export const pricingContext: PricingContext = {
  description:
    'No subscription tiers. Outbound SMS from a prepaid balance, plus a per-lead rate, by vertical and service, for leads delivered into open schedule slots.',
  plans: [
    {
      name: 'Prepaid SMS',
      priceLabel: 'At cost',
      tagline:
        'Outbound SMS is paid from a prepaid balance that tops up from the card on file. No bundled "infrastructure fee".',
      featured: false,
      cta: 'Talk to us',
      ctaHref: '/contact',
      features: [
        `Twilio SMS — $${SMS_SEGMENT_USD} per segment, then adjusted to Twilio’s price`,
        `$${SMS_TOPUP_USD} top-up when the balance falls below $${SMS_THRESHOLD_USD}`,
        'Sign-in codes are not charged to the workspace',
        'Cloudflare request volume is not billed',
        'Stripe’s processing fee is taken from each card charge',
      ],
    },
    {
      name: 'Outcome-tracked lead delivery',
      priceLabel: 'Per delivered lead',
      tagline:
        'Leads priced per vertical and per service — an EV-charger install lead and a drain-cleaning lead are priced differently. Lead delivery pauses when your schedule is full, to protect your margins. Every delivered lead is tracked to its outcome: quoted, scheduled, completed, paid.',
      featured: true,
      cta: 'Talk to us',
      ctaHref: '/contact',
      features: [
        'Priced per vertical and per service',
        'Lead delivery auto-pauses when schedule is full',
        'One contractor per lead, unless the customer grants a reroute',
        'Every delivered lead’s outcome is recorded: quoted, scheduled, completed, paid. Those records do not recalibrate prices yet',
        'No subscription tier, no monthly minimum',
        'No commitment — pause delivery any time',
      ],
    },
  ],
  verticalRates: [
    {
      category: 'Higher value',
      verticals: [
        'HVAC (Install/Repair)',
        'Electrical',
        'Roofing',
        'Solar/EV Charger',
      ],
    },
    {
      category: 'Mid value',
      verticals: ['Plumbing', 'Painting'],
    },
    {
      category: 'Lower value',
      verticals: ['Landscaping', 'Pest Control', 'Drain Cleaning', 'Handyman'],
    },
  ],
  faqs: [
    {
      question: 'Why no subscription tiers?',
      answer:
        'Subscription pricing punishes seasonal contractors and rewards us for software you don’t use. We charge for outbound SMS you send, from a prepaid balance, and for the leads we actually deliver. Slow week, small bill.',
    },
    {
      question: 'How is the rate per delivered lead set?',
      answer:
        'Per vertical and per service. The rate for a solar install lead is different from a drain-cleaning lead because the job value is different. Each rate is computed by a pricing engine modeled per service, per vertical, so the same job details always produce the same rate. We share the rate sheet during onboarding — no surprise pricing.',
    },
    {
      question: 'What does "pass-through infrastructure" actually mean?',
      answer: SMS_PASS_THROUGH,
    },
    {
      question: 'Is my data secure?',
      answer:
        'Yes. All data is encrypted in transit and at rest. We run on Cloudflare’s SOC 2-compliant infrastructure. You own your data and can export it at any time.',
    },
    {
      question: 'Do I need to install anything?',
      answer:
        'No. Greenput is fully web-based and works on any device with a modern browser. The contractor portal is mobile-optimized for on-site use.',
    },
    {
      question: 'How do I get started?',
      answer:
        'Sign up at app.greenput.com. Onboarding walks through your trade vertical, your service area, and your schedule. Once you’re in, we share the rate sheet for your vertical (priced per delivered lead) before any leads are delivered. Prefer to talk it through first? Contact us.',
    },
    {
      question: 'What counts as a delivered lead?',
      answer:
        'A real contact routed into one of your open schedule slots, logged with its source and timestamp. From there the lead lives in your pipeline, and its outcome is recorded in the same system: unqualified, quoted, scheduled, completed, paid. You see what every lead became, and so do we.',
    },
    {
      question: 'What if a lead turns out to be low quality?',
      answer:
        'The record settles it. Delivery and outcome are written down in the same system both sides can see — unqualified, quoted, scheduled, completed, paid — not a claim either side has to argue about. If a lead went nowhere, both sides can see where it stopped. Greenput does not run an answering service.',
    },
  ],
};

export interface ContactChannel {
  label: string;
  value: string;
  iconPath: string;
}

/**
 * What the visitor typed, echoed back into the inputs when the server
 * re-renders the page after a rejected no-JavaScript submission (GP-004).
 * The honeypot is deliberately not part of this shape.
 */
export interface ContactFormValues {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  trade: string;
  message: string;
}

export const EMPTY_CONTACT_FORM: ContactFormValues = {
  firstName: '',
  lastName: '',
  email: '',
  company: '',
  trade: '',
  message: '',
};

export interface ContactContext {
  /** The page was reached by a successful form-encoded POST (GP-004). */
  submitted: boolean;
  /** Fixed server copy for the banner after a rejected POST; null on a GET. */
  formError: string | null;
  /** Name of the input a rejected POST is about, for `aria-invalid`. */
  invalidField: string | null;
  form: ContactFormValues;
  trades: string[];
  contactChannels: ContactChannel[];
}

// submitted/formError/invalidField/form are the GET defaults; POST /contact
// overrides them through renderMarketingPage (see contact.ts).
export const contactContext: ContactContext = {
  submitted: false,
  formError: null,
  invalidField: null,
  form: EMPTY_CONTACT_FORM,
  trades: [
    'Electrician',
    'Plumber',
    'HVAC Technician',
    'Roofer',
    'General Contractor',
    'Painter',
    'Landscaper',
    'Other',
  ],
  contactChannels: [
    {
      label: 'GitHub',
      value: 'github.com/DuganLabs',
      iconPath:
        'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22',
    },
  ],
};

export interface ValueItem {
  title: string;
  description: string;
}

export interface Principle {
  number: string;
  title: string;
  description: string;
}

export interface AboutContext {
  values: ValueItem[];
  principles: Principle[];
}

export const aboutContext: AboutContext = {
  values: [
    {
      title: 'Trades First',
      description:
        'Every product decision starts with a single question: does this make a trade contractor’s day better? If the answer isn’t yes, we don’t ship it.',
    },
    {
      title: 'Data Transparency',
      description:
        'You own your data. No hidden analytics, no selling your customer data to advertisers. Export everything, anytime, in standard formats.',
    },
    {
      title: 'Radical Simplicity',
      description:
        'Feature creep is the enemy. We’d rather do 10 things extremely well than 50 things adequately. Every screen should be understandable in seconds.',
    },
    {
      title: 'Built to Last',
      description:
        'We’re building for the long term. That means writing clean code, maintaining backwards compatibility, and never introducing artificial lock-in.',
    },
  ],
  principles: [
    {
      number: '01',
      title: 'Schedule-aware by default',
      description:
        'Every feature in Greenput is aware of the contractor’s calendar. Leads route to open slots. No overbooking. No chaos.',
    },
    {
      number: '02',
      title: 'Tradesperson-authored workflows',
      description:
        'The contractor defines their own intake states and status transitions. Greenput provides the structure; the contractor defines the rules.',
    },
    {
      number: '03',
      title: 'First-party data only',
      description:
        'No third-party trackers. No consent banners. No behavioral advertising. The contractor’s data belongs to the contractor.',
    },
    {
      number: '04',
      title: 'Mobile-first, always',
      description:
        'Trade contractors work on job sites. Every feature is designed for a phone screen first, then enhanced for tablets and desktops.',
    },
    {
      number: '05',
      title: 'Zero lock-in',
      description:
        'Export your data in standard CSV and JSON formats at any time. If you leave Greenput, you keep everything you brought in.',
    },
  ],
};

// ─── Technology showcase (/technology) ─────────────────────────────────────
// Every number below was produced by scripts/audit/lighthouse.mjs — the
// harness that’s wired into CI (see .github/workflows/ci.yml’s
// `lighthouse-demo-tenant` job) and re-runs on main after staging deploys
// against the demo tenant’s always-on staging deployment. Nothing here is estimated
// or asserted; it’s a transcription of one dated report. See
// docs/technology-showcase-methodology.md for how these were produced and
// what was deliberately left unmeasured.

export interface LighthouseScores {
  performance: number;
  accessibility: number;
  bestPractices: number;
  seo: number;
}

export interface AuditedSite {
  id: string;
  /** Greenput’s own reference site gets its real name; every other row is
   * an anonymised category label — never a named business (see
   * docs/technology-showcase-methodology.md’s anonymisation policy). */
  name: string;
  isGreenput: boolean;
  mobile: LighthouseScores;
  desktop: LighthouseScores;
  lcpMobileMs: number;
  lcpDesktopMs: number;
  pageWeightKb: number;
  requests: number;
}

export interface TechnologyContext {
  measuredOn: string;
  demoUrl: string;
  sites: AuditedSite[];
}

export const technologyContext: TechnologyContext = {
  measuredOn: '2026-09-11',
  demoUrl: 'https://demo.greenput.com',
  sites: [
    {
      id: 'greenput',
      name: 'Greenput demo tenant (this platform)',
      isGreenput: true,
      // Best-Practices and Performance are unmodified. Lighthouse’s
      // "is-crawlable" SEO check was excluded for this one row only,
      // because the demo tenant is deliberately set to noindex (it’s a
      // reference site, not a real business soliciting work — see
      // apps/tenant-site/src/render.ts’s `isDemo` handling) and that
      // audit would otherwise fail for a reason that has nothing to do
      // with markup quality. A real Greenput tenant is never noindexed
      // and this audit runs unmodified for it.
      mobile: {
        performance: 100,
        accessibility: 100,
        bestPractices: 100,
        seo: 100,
      },
      desktop: {
        performance: 100,
        accessibility: 100,
        bestPractices: 100,
        seo: 100,
      },
      lcpMobileMs: 1479,
      lcpDesktopMs: 476,
      pageWeightKb: 65,
      requests: 6,
    },
    {
      id: 'saas-builder',
      name: 'A mainstream SaaS website-builder template',
      isGreenput: false,
      mobile: {
        performance: 69,
        accessibility: 84,
        bestPractices: 96,
        seo: 100,
      },
      desktop: {
        performance: 98,
        accessibility: 84,
        bestPractices: 96,
        seo: 100,
      },
      lcpMobileMs: 3986,
      lcpDesktopMs: 902,
      pageWeightKb: 2221,
      requests: 267,
    },
    {
      id: 'free-template',
      name: 'A free, publicly downloadable HTML template',
      isGreenput: false,
      mobile: {
        performance: 61,
        accessibility: 95,
        bestPractices: 100,
        seo: 92,
      },
      desktop: {
        performance: 95,
        accessibility: 76,
        bestPractices: 100,
        seo: 58,
      },
      lcpMobileMs: 6659,
      lcpDesktopMs: 761,
      pageWeightKb: 696,
      requests: 26,
    },
  ],
};

export interface AiTool {
  /** MCP tool name, exactly as an assistant sees it. */
  name: string;
  /** Plain-English summary for the tools grid. */
  summary: string;
  /** What a call is allowed to do. */
  access: string;
}

export interface AiContext {
  tools: AiTool[];
  /**
   * The walkthrough frames on /ai are illustrative markup in the template,
   * drawn from the homeowner’s side — deliberately not protocol captures.
   * The journey they draw (ask → verified results → sharing grant →
   * receipt) is the designed flow over the prototype’s demo data; the
   * shops, names and prices in them are illustrative, and the page says
   * so. Nothing here carries raw demo payloads anymore.
   */
}

export const aiContext: AiContext = {
  tools: [
    {
      name: 'find_contractors',
      summary:
        'Defined to search verified shops by service and area. The only implementation returns mock shops, and the server is not deployed.',
      access: 'Read-only',
    },
    {
      name: 'start_quote',
      summary:
        'Defined to open a quote session on the shop’s pricing engine. It returns no price until the questions are answered. The only implementation is mock data and does not reach the seeded pricing engines; its extra inputs are an untyped record.',
      access: 'Read-only',
    },
    {
      name: 'request_booking',
      summary:
        'Defined to hand a booking to one shop, and to refuse without an explicit sharing grant. The prototype does not write into the product database.',
      access: 'Write — grant-gated',
    },
  ],
};

// ─── Investors (/investors) ────────────────────────────────────────────────
// Copy is drawn from the approved fundraise one-pager and llms.txt — the
// same settled facts, stated the same way: one price per delivered lead,
// no referral fees paid to anyone, and the plainly-stated stage. People
// appear by role only; no names on this page.

export interface InvestorPoint {
  title: string;
  description: string;
}

export interface InvestorsContext {
  /** The model, as cards — one price across three sources of demand. */
  modelPoints: InvestorPoint[];
  /** Why the position compounds — the engines and the outcome dataset. */
  compoundPoints: InvestorPoint[];
}

export const investorsContext: InvestorsContext = {
  modelPoints: [
    {
      title: 'One price, billed at booking',
      description:
        'One flat price per booked job, regardless of source. At booking, the contractor pays the per-lead price — for all booked jobs. Enrolling availability and per-service pricing is the shop’s standing acceptance of auto-booked jobs, and the fee bills that agreement.',
    },
    {
      title: 'Three sources, one schedule',
      description:
        'The shop’s own website and marketing, the network pool — a job passed to another verified shop only under the customer’s explicit grant — and organic demand earned with content AI assistants cite. Every source feeds the same schedule at the same price.',
    },
    {
      title: 'No referral fees, ever',
      description:
        'Greenput pays nothing for referrals — not to partners, and not to AI assistants that route a customer to a shop. Every source of demand is unpaid distribution: each lead feeds the same schedule at the same price, and no source takes a share of the fee.',
    },
    {
      title: 'Tracked to outcome, infrastructure at cost',
      description:
        'Every delivered lead is tracked to its outcome: quoted → scheduled → completed → paid. Outbound SMS is paid from a prepaid balance that tops up from the card. No subscription tiers, no monthly minimum.',
    },
  ],
  compoundPoints: [
    {
      title: 'Pricing engines, defined once',
      description:
        'Pricing is a finite-state engine per service. Its qualification questions — panel photos, charger placement — take the quote from no price to the one exact number the customer books at. Define an engine once and every shop offering that service prices from it.',
    },
    {
      title: 'Outcomes are recorded',
      description:
        'Each delivered lead can be followed to quoted, scheduled, completed, or paid. That is the record a quote-to-paid dataset would be built from. Nothing in the product recalibrates a price from it yet.',
    },
    {
      title: 'Each vertical costs less than the last',
      description:
        'Electricians, reached through the Tesla certified installer network, are the proof and calibration phase. The platform does not change across trades, so each added vertical reuses the engine pattern, the playbook and the dataset.',
    },
  ],
};
