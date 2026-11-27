import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error } from '../lib/response';

export const reportsRouter = Router({ base: '/api/reports' });

/**
 * Parse shared date-range params. Defaults: last 12 months, ending today.
 *
 * `from` and `to` are date-only strings (`YYYY-MM-DD`) and both days are
 * inclusive. The columns they bound hold full ISO timestamps, compared as
 * TEXT, so `to` cannot be used as an upper bound directly:
 * `'2026-09-12T14:03:00.000Z'` sorts AFTER `'2026-09-12'` and every row on the
 * last day of the window would be dropped (GP-017). Bind `toExclusive` — the
 * day after `to` — with `< ?` instead. `from` is fine with `>= ?` because the
 * bare date sorts before every timestamp on that day. `to` is kept as sent so
 * the response can echo the window the caller asked for.
 */
export function parseDateRange(url: URL): {
  from: string;
  to: string;
  toExclusive: string;
} {
  const to =
    url.searchParams.get('to') ?? new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date();
  defaultFrom.setFullYear(defaultFrom.getFullYear() - 1);
  const from =
    url.searchParams.get('from') ?? defaultFrom.toISOString().slice(0, 10);
  return { from, to, toExclusive: nextUtcDay(to) };
}

/** The calendar day after `date` (`YYYY-MM-DD`, read as UTC), date-only. */
function nextUtcDay(date: string): string {
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

/** Validate period param for revenue grouping. */
function parsePeriod(url: URL): 'month' | 'quarter' | 'year' {
  const raw = url.searchParams.get('period') ?? 'month';
  if (raw === 'month' || raw === 'quarter' || raw === 'year') return raw;
  return 'month';
}

/**
 * SQLite strftime format for grouping by period.
 * month  → "2025-03"
 * quarter → "2025-Q1"
 * year   → "2025"
 */
function periodFormat(period: 'month' | 'quarter' | 'year'): string {
  switch (period) {
    case 'month':
      return "strftime('%Y-%m', paid_at)";
    case 'quarter':
      return "strftime('%Y', paid_at) || '-Q' || ((CAST(strftime('%m', paid_at) AS INTEGER) - 1) / 3 + 1)";
    case 'year':
      return "strftime('%Y', paid_at)";
  }
}

// ── GET /api/reports/revenue ─────────────────────────────────────
reportsRouter.get('/revenue', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const url = new URL(req.url);
  const { from, to, toExclusive } = parseDateRange(url);
  const period = parsePeriod(url);

  const [byPeriod, byServiceType, avgJobValue, topCustomers] =
    await Promise.all([
      // Revenue grouped by period
      env.DB.prepare(
        `
        SELECT ${periodFormat(period)} AS period,
               SUM(total) AS revenue,
               COUNT(*) AS job_count
        FROM jobs
        WHERE workspace_id = ?
          AND status = 'paid'
          AND paid_at >= ?
          AND paid_at < ?
        GROUP BY period
        ORDER BY period ASC
      `,
      )
        .bind(workspaceId, from, toExclusive)
        .all<{ period: string; revenue: number; job_count: number }>(),

      // Revenue by service type (via opportunity)
      env.DB.prepare(
        `
        SELECT o.service_type,
               SUM(j.total) AS revenue,
               COUNT(*) AS job_count
        FROM jobs j
        JOIN opportunities o ON j.opportunity_id = o.id
        WHERE j.workspace_id = ?
          AND j.status = 'paid'
          AND j.paid_at >= ?
          AND j.paid_at < ?
        GROUP BY o.service_type
        ORDER BY revenue DESC
      `,
      )
        .bind(workspaceId, from, toExclusive)
        .all<{ service_type: string; revenue: number; job_count: number }>(),

      // Average job value
      env.DB.prepare(
        `
        SELECT AVG(total) AS avg_value,
               SUM(total) AS total_revenue,
               COUNT(*) AS job_count
        FROM jobs
        WHERE workspace_id = ?
          AND status = 'paid'
          AND paid_at >= ?
          AND paid_at < ?
      `,
      )
        .bind(workspaceId, from, toExclusive)
        .first<{
          avg_value: number | null;
          total_revenue: number | null;
          job_count: number;
        }>(),

      // Top 10 customers by revenue
      env.DB.prepare(
        `
        SELECT c.id,
               c.first_name,
               c.last_name,
               c.company,
               SUM(j.total) AS revenue,
               COUNT(*) AS job_count
        FROM jobs j
        JOIN customers c ON j.customer_id = c.id
        WHERE j.workspace_id = ?
          AND j.status = 'paid'
          AND j.paid_at >= ?
          AND j.paid_at < ?
        GROUP BY c.id
        ORDER BY revenue DESC
        LIMIT 10
      `,
      )
        .bind(workspaceId, from, toExclusive)
        .all<{
          id: string;
          first_name: string;
          last_name: string;
          company: string | null;
          revenue: number;
          job_count: number;
        }>(),
    ]);

  return json({
    data: {
      period,
      from,
      to,
      byPeriod: byPeriod.results,
      byServiceType: byServiceType.results,
      summary: {
        totalRevenue: avgJobValue?.total_revenue ?? 0,
        jobCount: avgJobValue?.job_count ?? 0,
        averageJobValue: avgJobValue?.avg_value
          ? Math.round(avgJobValue.avg_value * 100) / 100
          : 0,
      },
      topCustomers: topCustomers.results,
    },
  });
});

// ── GET /api/reports/pipeline ────────────────────────────────────
reportsRouter.get('/pipeline', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const url = new URL(req.url);
  const { from, to, toExclusive } = parseDateRange(url);

  const [byStatus, bySource, avgTimeInStage] = await Promise.all([
    // Leads by status (funnel counts)
    env.DB.prepare(
      `
      SELECT status,
             COUNT(*) AS count
      FROM leads
      WHERE workspace_id = ?
        AND created_at >= ?
        AND created_at < ?
      GROUP BY status
      ORDER BY CASE status
        WHEN 'new' THEN 1
        WHEN 'contacted' THEN 2
        WHEN 'qualified' THEN 3
        WHEN 'unqualified' THEN 4
        WHEN 'converted' THEN 5
      END
    `,
    )
      .bind(workspaceId, from, toExclusive)
      .all<{ status: string; count: number }>(),

    // Leads by source with conversion counts
    env.DB.prepare(
      `
      SELECT source,
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted,
             SUM(CASE WHEN status = 'qualified' THEN 1 ELSE 0 END) AS qualified,
             SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) AS contacted
      FROM leads
      WHERE workspace_id = ?
        AND created_at >= ?
        AND created_at < ?
      GROUP BY source
      ORDER BY total DESC
    `,
    )
      .bind(workspaceId, from, toExclusive)
      .all<{
        source: string;
        total: number;
        converted: number;
        qualified: number;
        contacted: number;
      }>(),

    // Average time in each stage (days between created_at and updated_at
    // for leads that have moved past each status)
    env.DB.prepare(
      `
      SELECT
        'new_to_contacted' AS stage,
        AVG(julianday(updated_at) - julianday(created_at)) AS avg_days
      FROM leads
      WHERE workspace_id = ?
        AND created_at >= ?
        AND created_at < ?
        AND status IN ('contacted','qualified','unqualified','converted')
      UNION ALL
      SELECT
        'contacted_to_qualified' AS stage,
        AVG(julianday(updated_at) - julianday(created_at)) AS avg_days
      FROM leads
      WHERE workspace_id = ?
        AND created_at >= ?
        AND created_at < ?
        AND status IN ('qualified','converted')
      UNION ALL
      SELECT
        'qualified_to_converted' AS stage,
        AVG(julianday(updated_at) - julianday(created_at)) AS avg_days
      FROM leads
      WHERE workspace_id = ?
        AND created_at >= ?
        AND created_at < ?
        AND status = 'converted'
    `,
    )
      .bind(
        workspaceId,
        from,
        toExclusive,
        workspaceId,
        from,
        toExclusive,
        workspaceId,
        from,
        toExclusive,
      )
      .all<{ stage: string; avg_days: number | null }>(),
  ]);

  // Compute funnel conversion rates
  const statusMap = new Map<string, number>();
  for (const row of byStatus.results) {
    statusMap.set(row.status, row.count);
  }
  const totalLeads =
    (statusMap.get('new') ?? 0) +
    (statusMap.get('contacted') ?? 0) +
    (statusMap.get('qualified') ?? 0) +
    (statusMap.get('unqualified') ?? 0) +
    (statusMap.get('converted') ?? 0);

  const contacted =
    (statusMap.get('contacted') ?? 0) +
    (statusMap.get('qualified') ?? 0) +
    (statusMap.get('converted') ?? 0);
  const qualified =
    (statusMap.get('qualified') ?? 0) + (statusMap.get('converted') ?? 0);
  const converted = statusMap.get('converted') ?? 0;

  const conversionRates = {
    newToContacted:
      totalLeads > 0 ? Math.round((contacted / totalLeads) * 10000) / 100 : 0,
    contactedToQualified:
      contacted > 0 ? Math.round((qualified / contacted) * 10000) / 100 : 0,
    qualifiedToConverted:
      qualified > 0 ? Math.round((converted / qualified) * 10000) / 100 : 0,
    overallConversion:
      totalLeads > 0 ? Math.round((converted / totalLeads) * 10000) / 100 : 0,
  };

  // Source conversion rates
  const bySourceWithRates = bySource.results.map((s) => ({
    source: s.source,
    total: s.total,
    converted: s.converted,
    qualified: s.qualified,
    contacted: s.contacted,
    conversionRate:
      s.total > 0 ? Math.round((s.converted / s.total) * 10000) / 100 : 0,
  }));

  // avgTimeToConvert: overall average days from lead creation to conversion
  const qualifiedToConvertedRow = avgTimeInStage.results.find(
    (r) => r.stage === 'qualified_to_converted',
  );
  const avgTimeToConvert =
    qualifiedToConvertedRow?.avg_days !== null &&
    qualifiedToConvertedRow?.avg_days !== undefined
      ? Math.round(qualifiedToConvertedRow.avg_days * 10) / 10
      : null;

  return json({
    data: {
      from,
      to,
      byStatus: byStatus.results,
      conversionRate: conversionRates.overallConversion,
      conversionRates,
      avgTimeToConvert,
      averageTimeInStage: avgTimeInStage.results.map((r) => ({
        stage: r.stage,
        avgDays: r.avg_days !== null ? Math.round(r.avg_days * 10) / 10 : null,
      })),
      bySource: bySourceWithRates,
    },
  });
});

// ── GET /api/reports/campaigns ───────────────────────────────────
reportsRouter.get('/campaigns', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const url = new URL(req.url);
  const { from, to, toExclusive } = parseDateRange(url);

  const campaignStats = await env.DB.prepare(
    `
    SELECT
      c.id,
      c.name,
      c.channel,
      c.status,
      c.budget,
      c.spent,
      c.start_date,
      c.end_date,
      COUNT(DISTINCT l.id) AS lead_count,
      -- DISTINCT over lead ids, not a SUM over rows: the jobs LEFT JOIN below
      -- fans one converted lead out once per paid job (GP-034).
      COUNT(DISTINCT CASE WHEN l.status = 'converted' THEN l.id END) AS converted_leads,
      COALESCE(SUM(j.total), 0) AS attributed_revenue
    FROM campaigns c
    LEFT JOIN leads l
      ON l.campaign_id = c.id
      AND l.workspace_id = c.workspace_id
    LEFT JOIN opportunities o
      ON o.lead_id = l.id
      AND o.workspace_id = c.workspace_id
    LEFT JOIN jobs j
      ON j.opportunity_id = o.id
      AND j.workspace_id = c.workspace_id
      AND j.status = 'paid'
    WHERE c.workspace_id = ?
      AND c.created_at >= ?
      AND c.created_at < ?
    GROUP BY c.id
    ORDER BY attributed_revenue DESC
  `,
  )
    .bind(workspaceId, from, toExclusive)
    .all<{
      id: string;
      name: string;
      channel: string;
      status: string;
      budget: number | null;
      spent: number | null;
      start_date: string;
      end_date: string | null;
      lead_count: number;
      converted_leads: number;
      attributed_revenue: number;
    }>();

  const campaigns = campaignStats.results.map((c) => {
    const spent = c.spent ?? 0;
    const costPerLead =
      c.lead_count > 0 ? Math.round((spent / c.lead_count) * 100) / 100 : null;
    const roi =
      spent > 0
        ? Math.round(((c.attributed_revenue - spent) / spent) * 10000) / 100
        : null;

    return {
      id: c.id,
      name: c.name,
      channel: c.channel,
      status: c.status,
      budget: c.budget,
      spent,
      startDate: c.start_date,
      endDate: c.end_date,
      leadCount: c.lead_count,
      convertedLeads: c.converted_leads,
      conversionRate:
        c.lead_count > 0
          ? Math.round((c.converted_leads / c.lead_count) * 10000) / 100
          : 0,
      attributedRevenue: c.attributed_revenue,
      costPerLead,
      roi,
    };
  });

  return json({
    data: {
      from,
      to,
      campaigns,
    },
  });
});

// ── GET /api/reports/technicians ─────────────────────────────────
reportsRouter.get('/technicians', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const url = new URL(req.url);
  const { from, to, toExclusive } = parseDateRange(url);

  const techStats = await env.DB.prepare(
    `
    SELECT
      u.id,
      u.first_name,
      u.last_name,
      u.role,
      COUNT(j.id) AS job_count,
      SUM(CASE WHEN j.status = 'paid' THEN j.total ELSE 0 END) AS revenue,
      SUM(CASE WHEN j.status IN ('completed','invoiced','paid')
            AND j.actual_start IS NOT NULL
            AND j.actual_end IS NOT NULL
            THEN julianday(j.actual_end) - julianday(j.actual_start)
            ELSE 0 END) AS total_days,
      SUM(CASE WHEN j.status IN ('completed','invoiced','paid')
            AND j.actual_start IS NOT NULL
            AND j.actual_end IS NOT NULL
            THEN 1 ELSE 0 END) AS completed_count
    FROM users u
    -- GP-034: the assignee, never created_by — that credited every job to
    -- whoever typed it in. A job nobody is assigned to is credited to nobody.
    LEFT JOIN jobs j
      ON j.assigned_to = u.id
      AND j.workspace_id = u.workspace_id
      AND j.created_at >= ?
      AND j.created_at < ?
    WHERE u.workspace_id = ?
      AND u.role IN ('tech','owner','admin')
    GROUP BY u.id
    ORDER BY revenue DESC
  `,
  )
    .bind(from, toExclusive, workspaceId)
    .all<{
      id: string;
      first_name: string;
      last_name: string;
      role: string;
      job_count: number;
      revenue: number;
      total_days: number;
      completed_count: number;
    }>();

  const technicians = techStats.results.map((t) => ({
    id: t.id,
    firstName: t.first_name,
    lastName: t.last_name,
    role: t.role,
    jobCount: t.job_count,
    revenue: t.revenue,
    avgCompletionDays:
      t.completed_count > 0
        ? Math.round((t.total_days / t.completed_count) * 10) / 10
        : null,
  }));

  return json({
    data: {
      from,
      to,
      technicians,
    },
  });
});
