import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Logger, createRequestLogger } from './logger';

describe('Logger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should output JSON to console.log for info level', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = new Logger({}, 'debug');

    logger.info('test message');

    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as Record<
      string,
      unknown
    >;
    expect(parsed).toMatchObject({
      level: 'info',
      message: 'test message',
    });
    expect(parsed['timestamp']).toBeDefined();
  });

  it('should output JSON to console.warn for warn level', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logger = new Logger({}, 'debug');

    logger.warn('warning message');

    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as Record<
      string,
      unknown
    >;
    expect(parsed['level']).toBe('warn');
  });

  it('should output JSON to console.error for error level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new Logger({}, 'debug');

    logger.error('error message');

    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as Record<
      string,
      unknown
    >;
    expect(parsed['level']).toBe('error');
  });

  it('should output JSON to console.error for critical level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new Logger({}, 'debug');

    logger.critical('critical message');

    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as Record<
      string,
      unknown
    >;
    expect(parsed['level']).toBe('critical');
  });

  it('should suppress logs below the minimum level', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = new Logger({}, 'warn');

    logger.debug('debug message');
    logger.info('info message');

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('should include request context in log entries', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = new Logger(
      {
        requestId: 'req-123',
        path: '/api/leads',
        method: 'GET',
        userId: 'user-456',
        workspaceId: 'ws-789',
      },
      'debug',
    );

    logger.info('with context');

    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as Record<
      string,
      unknown
    >;
    expect(parsed).toMatchObject({
      requestId: 'req-123',
      path: '/api/leads',
      method: 'GET',
      userId: 'user-456',
      workspaceId: 'ws-789',
    });
  });

  it('should merge additional data into the log entry', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = new Logger({}, 'debug');

    logger.info('with data', { statusCode: 200, durationMs: 42 });

    const parsed = JSON.parse(spy.mock.calls[0][0] as string) as Record<
      string,
      unknown
    >;
    expect(parsed['statusCode']).toBe(200);
    expect(parsed['durationMs']).toBe(42);
  });

  it('should not include undefined context fields', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = new Logger({ requestId: 'req-1' }, 'debug');

    logger.info('partial context');

    const raw = spy.mock.calls[0][0] as string;
    expect(raw).not.toContain('userId');
    expect(raw).not.toContain('workspaceId');
  });
});

describe('createRequestLogger', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should generate a requestId and extract path/method', () => {
    // Stub crypto.randomUUID for predictability
    const originalRandomUUID = crypto.randomUUID;
    crypto.randomUUID = () =>
      'test-uuid-1234' as ReturnType<typeof crypto.randomUUID>;

    try {
      const request = new Request('https://api.greenput.com/api/leads?page=1', {
        method: 'POST',
      });
      const env = { ENVIRONMENT: 'production' };

      const { logger, requestId } = createRequestLogger(request, env);

      expect(requestId).toBe('test-uuid-1234');
      expect(logger).toBeInstanceOf(Logger);
    } finally {
      crypto.randomUUID = originalRandomUUID;
    }
  });

  it('should set minLevel to debug in development', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const request = new Request('https://localhost:8787/api/test');
    const env = { ENVIRONMENT: 'development' };

    const { logger } = createRequestLogger(request, env);
    logger.debug('dev debug message');

    // In development, debug logs should be emitted
    expect(spy).toHaveBeenCalled();
    const calls = spy.mock.calls.map(
      (c) => JSON.parse(c[0] as string) as Record<string, unknown>,
    );
    const debugCall = calls.find((c) => c['level'] === 'debug');
    expect(debugCall).toBeDefined();
    expect(debugCall!['message']).toBe('dev debug message');
  });

  it('should suppress debug in production', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const request = new Request('https://api.greenput.com/api/test');
    const env = { ENVIRONMENT: 'production' };

    const { logger } = createRequestLogger(request, env);
    logger.debug('prod debug message');

    // In production (minLevel=info), no debug logs should appear
    const calls = spy.mock.calls.map(
      (c) => JSON.parse(c[0] as string) as Record<string, unknown>,
    );
    const debugCall = calls.find((c) => c['level'] === 'debug');
    expect(debugCall).toBeUndefined();
  });
});
