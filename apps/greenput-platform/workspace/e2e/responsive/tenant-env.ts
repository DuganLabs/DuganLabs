/**
 * Just enough of a D1 binding for apps/tenant-site to render its shell.
 *
 * The tenant shell — header, nav, footer — is where the header-overflow and
 * brand-truncation defects live, and it only renders once the Worker has
 * resolved a hostname to a workspace row. Without a workspace the Worker
 * returns its bare branded 404, which has no nav at all and so cannot
 * demonstrate either defect.
 *
 * A stub rather than a seeded database on purpose: this test has to run on a
 * pull request, on a runner with no Cloudflare credentials, and the layout
 * property it asserts does not depend on where the row came from. Two queries
 * are enough — the workspace lookup and the service-type rollup.
 */

export interface TenantStubOptions {
  /** Workspace display name. Long names are the point of TS-05. */
  name?: string;
  slug?: string;
  trade?: string;
  /** One published instant-price flow, so /quote renders a card. */
  quote?: boolean;
  /** A sent proposal and a public invoice the document routes can render. */
  documents?: boolean;
}

interface StubRow {
  [key: string]: unknown;
}

const SERVICE_TYPES: StubRow[] = [
  { name: 'Panel upgrade', count: 9 },
  { name: 'EV charger install', count: 7 },
  { name: 'Outlet or circuit addition', count: 6 },
  { name: 'Troubleshooting callout', count: 5 },
  { name: 'Whole-home surge protection', count: 3 },
  { name: 'Lighting', count: 2 },
];

const QUOTE_FLOW: StubRow = {
  id: '00000000-0000-4000-8000-000000000010',
  slug: 'ev-charger-install',
  name: 'Level 2 EV charger',
  description: 'Nine questions, about two minutes.',
  vertical: 'ev_charger',
  current_version_id: '00000000-0000-4000-8000-000000000011',
};

const ESTIMATE: StubRow = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Panel upgrade',
  estimate_number: 'EST-0042',
  subtotal: 180000,
  tax_rate: 8.25,
  tax_amount: 14850,
  total: 194850,
  notes: 'Includes the breaker.',
  valid_until: '2026-12-01',
  status: 'sent',
  line_items: JSON.stringify([
    {
      type: 'material',
      description: '200A panel',
      quantity: 1,
      unitPrice: 120000,
      total: 120000,
    },
    {
      type: 'labor',
      description: 'Install',
      quantity: 4,
      unitPrice: 15000,
      total: 60000,
    },
  ]),
};

const INVOICE_JOB: StubRow = {
  id: '00000000-0000-4000-8000-000000000020',
  job_number: 'JOB-1001',
  title: 'Panel upgrade',
  invoiced_at: '2026-10-01T15:00:00.000Z',
  paid_at: null,
  total: 194850,
  notes: 'Thank you.',
  street: '18 Oak St',
  city: 'Rivertown',
  state: 'TX',
  zip: '78701',
};

const INVOICE_CUSTOMER: StubRow = {
  first_name: 'Ada',
  last_name: 'Lovelace',
  company: null,
  email: 'ada@example.com',
  phone: '+15125550100',
  street: '18 Oak St',
  city: 'Rivertown',
  state: 'TX',
  zip: '78701',
};

const INVOICE_LINES: StubRow[] = [
  {
    id: '00000000-0000-4000-8000-000000000021',
    description: '200A panel',
    quantity: 1,
    unit_price: 120000,
    total: 120000,
  },
];

class StubStatement {
  constructor(
    private readonly sql: string,
    private readonly row: StubRow,
    private readonly options: TenantStubOptions,
  ) {}

  bind(): StubStatement {
    return this;
  }

  async first<T>(): Promise<T | null> {
    if (/FROM\s+workspaces/i.test(this.sql)) return this.row as unknown as T;
    if (this.options.documents && /FROM\s+estimates/i.test(this.sql))
      return ESTIMATE as unknown as T;
    if (this.options.documents && /FROM\s+jobs/i.test(this.sql))
      return INVOICE_JOB as unknown as T;
    if (this.options.documents && /FROM\s+customers/i.test(this.sql))
      return INVOICE_CUSTOMER as unknown as T;
    return null;
  }

  async all<T>(): Promise<{ results: T[]; success: true }> {
    if (/FROM\s+leads/i.test(this.sql))
      return { results: SERVICE_TYPES as unknown as T[], success: true };
    if (this.options.quote && /pricing_fsms/i.test(this.sql))
      return { results: [QUOTE_FLOW] as unknown as T[], success: true };
    if (this.options.documents && /job_line_items/i.test(this.sql))
      return { results: INVOICE_LINES as unknown as T[], success: true };
    return { results: [], success: true };
  }

  async run(): Promise<{ success: true }> {
    return { success: true };
  }
}

export function tenantStubEnv(options: TenantStubOptions = {}): unknown {
  const row: StubRow = {
    id: '00000000-0000-4000-8000-000000000001',
    name: options.name ?? 'Rivertown Electric',
    slug: options.slug ?? 'demo',
    trade: options.trade ?? 'electrical',
    phone: '(512) 555-0142',
    email: 'hello@rivertown.example',
    logo_url: null,
    street: '118 Mill Race Rd',
    city: 'Rivertown',
    state: 'TX',
    zip: '78701',
    license_num: null,
    custom_hostname: null,
    custom_domain_status: null,
  };
  return {
    ENVIRONMENT: 'test',
    DB: {
      prepare: (sql: string) => new StubStatement(sql, row, options),
    },
  };
}
