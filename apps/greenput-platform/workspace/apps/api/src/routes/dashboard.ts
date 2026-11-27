import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json } from '../lib/response';

export const dashboardRouter = Router({ base: '/api/dashboard' });

dashboardRouter.get('/stats', async (req: IRequest, env: Env) => {
  const workspaceId = (req as any).workspaceId;

  const [leads, jobs, revenue, conversion, activity] = await Promise.all([
    // New leads this month
    env.DB.prepare(
      `
      SELECT COUNT(*) AS total,
        SUM(CASE WHEN created_at >= date('now', 'start of month') THEN 1 ELSE 0 END) AS this_month,
        SUM(CASE WHEN created_at >= date('now', 'start of month', '-1 month')
                  AND created_at < date('now', 'start of month') THEN 1 ELSE 0 END) AS last_month
      FROM leads WHERE workspace_id = ?
    `,
    )
      .bind(workspaceId)
      .first<{ total: number; this_month: number; last_month: number }>(),

    // Active jobs
    env.DB.prepare(
      `
      SELECT COUNT(*) AS active,
        SUM(CASE WHEN scheduled_end <= date('now', '+7 days') THEN 1 ELSE 0 END) AS due_this_week
      FROM jobs WHERE workspace_id = ? AND status IN ('scheduled','in_progress')
    `,
    )
      .bind(workspaceId)
      .first<{ active: number; due_this_week: number }>(),

    // Revenue this month vs last
    env.DB.prepare(
      `
      SELECT
        SUM(CASE WHEN paid_at >= date('now', 'start of month') THEN total ELSE 0 END) AS this_month,
        SUM(CASE WHEN paid_at >= date('now', 'start of month', '-1 month')
                  AND paid_at < date('now', 'start of month') THEN total ELSE 0 END) AS last_month
      FROM jobs WHERE workspace_id = ? AND status IN ('paid')
    `,
    )
      .bind(workspaceId)
      .first<{ this_month: number; last_month: number }>(),

    // Conversion rate: converted / total leads (last 90 days)
    env.DB.prepare(
      `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) AS converted
      FROM leads
      WHERE workspace_id = ? AND created_at >= date('now', '-90 days')
    `,
    )
      .bind(workspaceId)
      .first<{ total: number; converted: number }>(),

    // Recent activity
    env.DB.prepare(
      `
      SELECT a.*, u.first_name, u.last_name
      FROM activity_log a
      LEFT JOIN users u ON a.user_id = u.id
      WHERE a.workspace_id = ?
      ORDER BY a.created_at DESC
      LIMIT 10
    `,
    )
      .bind(workspaceId)
      .all(),
  ]);

  const leadGrowth = leads?.last_month
    ? Math.round(
        ((leads.this_month - leads.last_month) / leads.last_month) * 100,
      )
    : null;

  const revenueGrowth = revenue?.last_month
    ? Math.round(
        ((revenue.this_month - revenue.last_month) / revenue.last_month) * 100,
      )
    : null;

  const conversionRate = conversion?.total
    ? Math.round((conversion.converted / conversion.total) * 100)
    : 0;

  return json({
    data: {
      leads: {
        thisMonth: leads?.this_month ?? 0,
        growth: leadGrowth,
      },
      jobs: {
        active: jobs?.active ?? 0,
        dueThisWeek: jobs?.due_this_week ?? 0,
      },
      revenue: {
        thisMonth: revenue?.this_month ?? 0,
        growth: revenueGrowth,
      },
      conversion: {
        rate: conversionRate,
      },
      activity: activity.results,
    },
  });
});
