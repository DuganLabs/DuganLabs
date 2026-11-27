import type { ApiClient } from '@basenative/fetch';

export type RevenuePeriod = 'month' | 'quarter' | 'year';

export type RevenuePeriodPoint = {
  period: string;
  revenue: number;
  job_count: number;
};

export type RevenueByServiceType = {
  service_type: string;
  revenue: number;
  job_count: number;
};

export type RevenueTopCustomer = {
  id: string;
  first_name: string;
  last_name: string;
  company: string | null;
  revenue: number;
  job_count: number;
};

export type RevenueReport = {
  period: RevenuePeriod;
  from: string;
  to: string;
  byPeriod: RevenuePeriodPoint[];
  byServiceType: RevenueByServiceType[];
  summary: {
    totalRevenue: number;
    jobCount: number;
    averageJobValue: number;
  };
  topCustomers: RevenueTopCustomer[];
};

export type PipelineByStatus = { status: string; count: number };
export type PipelineBySource = {
  source: string;
  total: number;
  converted: number;
  qualified: number;
  contacted: number;
  conversionRate?: number;
};

export type PipelineReport = {
  from: string;
  to: string;
  byStatus: PipelineByStatus[];
  bySource: PipelineBySource[];
  conversionRate: number;
  avgTimeToConvert: number | null;
};

export type CampaignReportItem = {
  id: string;
  name: string;
  channel: string;
  status: string;
  budget: number | null;
  spent: number;
  startDate: string;
  endDate: string | null;
  leadCount: number;
  convertedLeads: number;
  conversionRate: number;
  attributedRevenue: number;
  costPerLead: number | null;
  roi: number | null;
};

export type CampaignReport = {
  from: string;
  to: string;
  campaigns: CampaignReportItem[];
};

export type TechnicianReportItem = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  jobCount: number;
  revenue: number;
  avgCompletionDays: number | null;
};

export type TechnicianReport = {
  from: string;
  to: string;
  technicians: TechnicianReportItem[];
};

export type DateRange = {
  from?: string;
  to?: string;
};

export interface ReportsApi {
  revenue(
    params: DateRange & { period?: RevenuePeriod },
  ): Promise<{ data: RevenueReport }>;
  pipeline(params: DateRange): Promise<{ data: PipelineReport }>;
  campaigns(params: DateRange): Promise<{ data: CampaignReport }>;
  technicians(params: DateRange): Promise<{ data: TechnicianReport }>;
}

export function createReportsApi(api: ApiClient): ReportsApi {
  return {
    revenue: (params) => api.get('/api/reports/revenue', params),
    pipeline: (params) => api.get('/api/reports/pipeline', params),
    campaigns: (params) => api.get('/api/reports/campaigns', params),
    technicians: (params) => api.get('/api/reports/technicians', params),
  };
}
