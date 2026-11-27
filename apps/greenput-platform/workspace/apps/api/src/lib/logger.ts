// ── Structured Logging Service ───────────────────────────────
// Lightweight, zero-dependency logger for Cloudflare Workers.
// Outputs JSON for Logpush compatibility via console.log/warn/error.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

interface RequestContext {
  requestId: string;
  path: string;
  method: string;
  userId?: string;
  workspaceId?: string;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  requestId?: string;
  path?: string;
  method?: string;
  userId?: string;
  workspaceId?: string;
  [key: string]: unknown;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
};

export class Logger {
  private context: Partial<RequestContext>;
  private minLevel: LogLevel;

  constructor(
    context: Partial<RequestContext> = {},
    minLevel: LogLevel = 'info',
  ) {
    this.context = context;
    this.minLevel = minLevel;
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.log('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.log('error', message, data);
  }

  critical(message: string, data?: Record<string, unknown>): void {
    this.log('critical', message, data);
  }

  private log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    if (LOG_LEVEL_ORDER[level] < LOG_LEVEL_ORDER[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(this.context.requestId && { requestId: this.context.requestId }),
      ...(this.context.path && { path: this.context.path }),
      ...(this.context.method && { method: this.context.method }),
      ...(this.context.userId && { userId: this.context.userId }),
      ...(this.context.workspaceId && {
        workspaceId: this.context.workspaceId,
      }),
      ...data,
    };

    const json = JSON.stringify(entry);

    switch (level) {
      case 'debug':
      case 'info':
        console.log(json);
        break;
      case 'warn':
        console.warn(json);
        break;
      case 'error':
      case 'critical':
        console.error(json);
        break;
    }
  }
}

/**
 * Create a request-scoped logger that auto-attaches context from the
 * incoming request. Generates a unique requestId per invocation.
 */
export function createRequestLogger(
  request: Request,
  env: { ENVIRONMENT: string },
): { logger: Logger; requestId: string } {
  const requestId = crypto.randomUUID();
  const url = new URL(request.url);

  // Extract user context if already attached by auth middleware
  const reqWithUser = request as Request & {
    user?: { id: string; workspaceId: string };
    workspaceId?: string;
  };

  const minLevel: LogLevel =
    env.ENVIRONMENT === 'development' ? 'debug' : 'info';

  const logger = new Logger(
    {
      requestId,
      path: url.pathname,
      method: request.method,
      userId: reqWithUser.user?.id,
      workspaceId: reqWithUser.workspaceId,
    },
    minLevel,
  );

  return { logger, requestId };
}
