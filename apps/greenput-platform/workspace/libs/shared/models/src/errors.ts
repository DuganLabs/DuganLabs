// ── Error Tracking Types ─────────────────────────────────────

export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'info';
export type ErrorCategory =
  'validation' | 'auth' | 'database' | 'external' | 'unknown';

export interface ErrorEvent {
  id: string;
  severity: ErrorSeverity;
  category: ErrorCategory;
  code: string;
  message: string;
  stack?: string;
  requestId?: string;
  userId?: string;
  workspaceId?: string;
  path?: string;
  method?: string;
  statusCode?: number;
  metadata?: Record<string, unknown>;
  createdAt: string;
}
