import { http, HttpResponse, delay } from 'msw';

// ── Revenue report fixture ──────────────────────────────────

function createRevenueReport() {
  return {
    period: 'month',
    from: '2025-04-01',
    to: '2026-04-01',
    byPeriod: [
      { period: '2025-10', revenue: 48000, job_count: 5 },
      { period: '2025-11', revenue: 72000, job_count: 8 },
      { period: '2025-12', revenue: 55000, job_count: 6 },
      { period: '2026-01', revenue: 91000, job_count: 10 },
      { period: '2026-02', revenue: 68000, job_count: 7 },
      { period: '2026-03', revenue: 83000, job_count: 9 },
    ],
    byServiceType: [
      { service_type: 'Electrical', revenue: 220000, job_count: 24 },
      { service_type: 'HVAC', revenue: 145000, job_count: 18 },
      { service_type: 'Plumbing', revenue: 52000, job_count: 6 },
    ],
    summary: { totalRevenue: 417000, jobCount: 45, averageJobValue: 9266.67 },
    topCustomers: [
      {
        id: 'c1',
        first_name: 'Alice',
        last_name: 'Johnson',
        company: 'AJ Properties',
        revenue: 65000,
        job_count: 7,
      },
      {
        id: 'c2',
        first_name: 'Bob',
        last_name: 'Martinez',
        company: null,
        revenue: 42000,
        job_count: 5,
      },
    ],
  };
}

function createPipelineReport() {
  return {
    from: '2025-04-01',
    to: '2026-04-01',
    byStatus: [
      { status: 'new', count: 32 },
      { status: 'contacted', count: 24 },
      { status: 'qualified', count: 16 },
      { status: 'converted', count: 10 },
      { status: 'unqualified', count: 8 },
    ],
    bySource: [
      {
        source: 'website',
        total: 18,
        converted: 5,
        qualified: 9,
        contacted: 14,
      },
      {
        source: 'referral',
        total: 14,
        converted: 4,
        qualified: 7,
        contacted: 11,
      },
      { source: 'google', total: 10, converted: 1, qualified: 4, contacted: 8 },
      {
        source: 'campaign',
        total: 8,
        converted: 0,
        qualified: 3,
        contacted: 6,
      },
    ],
    conversionRate: 31.25,
    avgTimeToConvert: 8.4,
  };
}

// ── Success handlers ────────────────────────────────────────

export const getRevenueReportSuccess = http.get(
  '*/api/reports/revenue',
  async () => {
    return HttpResponse.json({ data: createRevenueReport() });
  },
);

export const getPipelineReportSuccess = http.get(
  '*/api/reports/pipeline',
  async () => {
    return HttpResponse.json({ data: createPipelineReport() });
  },
);

// ── Error handlers ──────────────────────────────────────────

export const getRevenueReportError = http.get(
  '*/api/reports/revenue',
  async () => {
    return HttpResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  },
);

export const getPipelineReportError = http.get(
  '*/api/reports/pipeline',
  async () => {
    return HttpResponse.json(
      { message: 'Internal server error' },
      { status: 500 },
    );
  },
);

// ── Slow handlers ───────────────────────────────────────────

export const getReportsSlow = http.get('*/api/reports/*', async () => {
  await delay(2000);
  return HttpResponse.json({ data: {} });
});

export const getCampaignReportSuccess = http.get(
  '*/api/reports/campaigns',
  async () => {
    return HttpResponse.json({
      data: {
        from: '2025-04-01',
        to: '2026-04-01',
        campaigns: [
          {
            id: 'c1',
            name: 'Spring Email Blast',
            channel: 'email',
            status: 'completed',
            budget: 1500,
            spent: 1200,
            startDate: '2025-10-01',
            endDate: '2025-10-31',
            leadCount: 24,
            convertedLeads: 6,
            conversionRate: 25.0,
            attributedRevenue: 42000,
            costPerLead: 50.0,
            roi: 3400.0,
          },
        ],
      },
    });
  },
);

export const getTechnicianReportSuccess = http.get(
  '*/api/reports/technicians',
  async () => {
    return HttpResponse.json({
      data: {
        from: '2025-04-01',
        to: '2026-04-01',
        technicians: [
          {
            id: 'u1',
            firstName: 'Mike',
            lastName: 'Torres',
            role: 'tech',
            jobCount: 18,
            revenue: 84000,
            avgCompletionDays: 1.2,
          },
          {
            id: 'u2',
            firstName: 'Sarah',
            lastName: 'Chen',
            role: 'tech',
            jobCount: 14,
            revenue: 67000,
            avgCompletionDays: 0.9,
          },
        ],
      },
    });
  },
);

// ── Default export for use in handlers.ts ──────────────────

export const reportHandlers = [
  getRevenueReportSuccess,
  getPipelineReportSuccess,
  getCampaignReportSuccess,
  getTechnicianReportSuccess,
];
