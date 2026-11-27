// ── Error Tracking Service ───────────────────────────────────
// Captures, classifies, and persists error events to D1 for monitoring.

import type {
  ErrorSeverity,
  ErrorCategory,
  ErrorEvent,
} from '@greenput/shared/models';
import type { Env } from '../env';

export interface ErrorContext {
  requestId?: string;
  userId?: string;
  workspaceId?: string;
  path?: string;
  method?: string;
  statusCode?: number;
  metadata?: Record<string, unknown>;
  // ── Explicit classification ──────────────────────────────────
  // classifyError guesses severity/category/code from message prose, which is
  // the right default for an error nobody diagnosed. A caller that already
  // knows what the fault is should state it instead of hoping the guess lands:
  // two halves of one fault whose library messages differ by a single word
  // ("registration" vs "authentication") otherwise land in two categories.
  // Omitted fields still fall back to classifyError.
  severity?: ErrorSeverity;
  category?: ErrorCategory;
  code?: string;
}

interface ClassifiedError {
  severity: ErrorSeverity;
  category: ErrorCategory;
  code: string;
  message: string;
  stack?: string;
}

/**
 * Classify an unknown error into severity, category, and code.
 * Uses heuristics based on error message patterns and error types.
 */
export function classifyError(err: unknown): ClassifiedError {
  if (err instanceof Error) {
    const message = err.message;
    const stack = err.stack;

    // D1 / database errors
    if (
      message.includes('D1_ERROR') ||
      message.includes('SQLITE') ||
      message.includes('database') ||
      message.includes('constraint') ||
      err.constructor.name === 'D1Error'
    ) {
      return {
        severity: 'error',
        category: 'database',
        code: 'DATABASE_ERROR',
        message,
        stack,
      };
    }

    // Auth errors
    if (
      message.toLowerCase().includes('unauthorized') ||
      message.toLowerCase().includes('forbidden') ||
      message.toLowerCase().includes('authentication') ||
      message.toLowerCase().includes('invalid token') ||
      message.toLowerCase().includes('session expired')
    ) {
      return {
        severity: 'warning',
        category: 'auth',
        code: 'AUTH_ERROR',
        message,
        stack,
      };
    }

    // Validation errors
    if (
      message.toLowerCase().includes('validation') ||
      message.toLowerCase().includes('invalid') ||
      message.toLowerCase().includes('required') ||
      message.toLowerCase().includes('zod')
    ) {
      return {
        severity: 'warning',
        category: 'validation',
        code: 'VALIDATION_ERROR',
        message,
        stack,
      };
    }

    // External service errors (Stripe, Twilio, etc.)
    if (
      message.toLowerCase().includes('stripe') ||
      message.toLowerCase().includes('twilio') ||
      message.toLowerCase().includes('fetch') ||
      message.toLowerCase().includes('network') ||
      message.toLowerCase().includes('timeout')
    ) {
      return {
        severity: 'error',
        category: 'external',
        code: 'EXTERNAL_SERVICE_ERROR',
        message,
        stack,
      };
    }

    // Default: unknown error
    return {
      severity: 'error',
      category: 'unknown',
      code: 'UNKNOWN_ERROR',
      message,
      stack,
    };
  }

  // Non-Error thrown values
  const message = typeof err === 'string' ? err : 'Non-Error value thrown';
  return {
    severity: 'error',
    category: 'unknown',
    code: 'UNKNOWN_ERROR',
    message,
  };
}

/**
 * Track an error by persisting it to the D1 `error_logs` table.
 * Returns the created ErrorEvent for downstream use (e.g. response headers).
 *
 * Swallows its own persistence errors to avoid masking the original error.
 */
export async function trackError(
  env: Env,
  err: unknown,
  context: ErrorContext = {},
): Promise<ErrorEvent> {
  const classified = classifyError(err);

  const event: ErrorEvent = {
    id: crypto.randomUUID(),
    severity: context.severity ?? classified.severity,
    category: context.category ?? classified.category,
    code: context.code ?? classified.code,
    message: classified.message,
    stack: classified.stack,
    requestId: context.requestId,
    userId: context.userId,
    workspaceId: context.workspaceId,
    path: context.path,
    method: context.method,
    statusCode: context.statusCode ?? 500,
    metadata: context.metadata,
    createdAt: new Date().toISOString(),
  };

  try {
    await env.DB.prepare(
      `INSERT INTO error_logs
       (id, severity, category, code, message, stack, request_id, user_id,
        workspace_id, path, method, status_code, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        event.id,
        event.severity,
        event.category,
        event.code,
        event.message,
        event.stack ?? null,
        event.requestId ?? null,
        event.userId ?? null,
        event.workspaceId ?? null,
        event.path ?? null,
        event.method ?? null,
        event.statusCode ?? null,
        event.metadata ? JSON.stringify(event.metadata) : null,
        event.createdAt,
      )
      .run();
  } catch (persistErr) {
    // Log the persistence failure but don't throw — the original error
    // is more important than the tracking failure.
    console.error(
      JSON.stringify({
        level: 'critical',
        message: 'Failed to persist error event to D1',
        originalError: classified.message,
        persistError:
          persistErr instanceof Error ? persistErr.message : String(persistErr),
        timestamp: new Date().toISOString(),
      }),
    );
  }

  return event;
}

export interface ClientErrorEvent {
  message?: unknown;
  stack?: unknown;
  url?: unknown;
  timestamp?: unknown;
  userId?: unknown;
  workspaceId?: unknown;
  context?: unknown;
  requestId?: unknown;
}

/**
 * Persist a batch of client-reported error events to D1.
 *
 * Each event is classified server-side (we don't trust client severity), then
 * written to error_logs. The session user's id/workspaceId override any
 * spoofed values from the client. Returns the count of successfully ingested
 * events.
 */
export async function ingestClientErrors(
  env: Env,
  events: ClientErrorEvent[],
  session: { userId?: string; workspaceId?: string },
): Promise<number> {
  let ingested = 0;

  for (const evt of events) {
    const message =
      typeof evt.message === 'string' ? evt.message : 'Unknown client error';
    const stack = typeof evt.stack === 'string' ? evt.stack : null;
    const url = typeof evt.url === 'string' ? evt.url : null;
    const requestId = typeof evt.requestId === 'string' ? evt.requestId : null;
    const createdAt =
      typeof evt.timestamp === 'string'
        ? evt.timestamp
        : new Date().toISOString();

    const classified = classifyError(new Error(message));

    const metadata: Record<string, unknown> = { origin: 'client' };
    if (evt.context && typeof evt.context === 'object') {
      metadata.context = evt.context;
    }

    try {
      await env.DB.prepare(
        `INSERT INTO error_logs
         (id, severity, category, code, message, stack, request_id, user_id,
          workspace_id, path, method, status_code, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          classified.severity,
          classified.category,
          classified.code,
          message,
          stack,
          requestId,
          session.userId ?? null,
          session.workspaceId ?? null,
          url,
          null,
          null,
          JSON.stringify(metadata),
          createdAt,
        )
        .run();
      ingested++;
    } catch (persistErr) {
      console.error(
        JSON.stringify({
          level: 'warning',
          message: 'Failed to persist client error event to D1',
          originalError: message,
          persistError:
            persistErr instanceof Error
              ? persistErr.message
              : String(persistErr),
          timestamp: new Date().toISOString(),
        }),
      );
    }
  }

  return ingested;
}

/**
 * Retrieve recent error events from D1 for the monitoring endpoint.
 */
export async function getRecentErrors(
  env: Env,
  limit = 50,
): Promise<ErrorEvent[]> {
  const result = await env.DB.prepare(
    `SELECT * FROM error_logs ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all<{
      id: string;
      severity: ErrorSeverity;
      category: ErrorCategory;
      code: string;
      message: string;
      stack: string | null;
      request_id: string | null;
      user_id: string | null;
      workspace_id: string | null;
      path: string | null;
      method: string | null;
      status_code: number | null;
      metadata: string | null;
      created_at: string;
    }>();

  return result.results.map((row) => ({
    id: row.id,
    severity: row.severity,
    category: row.category,
    code: row.code,
    message: row.message,
    stack: row.stack ?? undefined,
    requestId: row.request_id ?? undefined,
    userId: row.user_id ?? undefined,
    workspaceId: row.workspace_id ?? undefined,
    path: row.path ?? undefined,
    method: row.method ?? undefined,
    statusCode: row.status_code ?? undefined,
    metadata: row.metadata
      ? (JSON.parse(row.metadata) as Record<string, unknown>)
      : undefined,
    createdAt: row.created_at,
  }));
}
