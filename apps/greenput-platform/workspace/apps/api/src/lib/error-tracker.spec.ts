import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  classifyError,
  trackError,
  getRecentErrors,
  ingestClientErrors,
} from './error-tracker';
import type { Env } from '../env';

describe('classifyError', () => {
  it('should classify D1 database errors', () => {
    const err = new Error('D1_ERROR: UNIQUE constraint failed');
    const result = classifyError(err);

    expect(result.category).toBe('database');
    expect(result.code).toBe('DATABASE_ERROR');
    expect(result.severity).toBe('error');
  });

  it('should classify SQLITE errors as database', () => {
    const err = new Error('SQLITE_CONSTRAINT: NOT NULL constraint failed');
    const result = classifyError(err);

    expect(result.category).toBe('database');
    expect(result.code).toBe('DATABASE_ERROR');
  });

  it('should classify auth errors', () => {
    const err = new Error('Unauthorized access attempt');
    const result = classifyError(err);

    expect(result.category).toBe('auth');
    expect(result.code).toBe('AUTH_ERROR');
    expect(result.severity).toBe('warning');
  });

  it('should classify forbidden as auth', () => {
    const err = new Error('Forbidden: insufficient permissions');
    const result = classifyError(err);

    expect(result.category).toBe('auth');
  });

  it('should classify session expired as auth', () => {
    const err = new Error('Session expired');
    const result = classifyError(err);

    expect(result.category).toBe('auth');
  });

  it('should classify validation errors', () => {
    const err = new Error('Validation failed: email is required');
    const result = classifyError(err);

    expect(result.category).toBe('validation');
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.severity).toBe('warning');
  });

  it('should classify Zod errors as validation', () => {
    const err = new Error('Zod parse error at path .email');
    const result = classifyError(err);

    expect(result.category).toBe('validation');
  });

  it('should classify external service errors', () => {
    const err = new Error('Stripe API returned 503');
    const result = classifyError(err);

    expect(result.category).toBe('external');
    expect(result.code).toBe('EXTERNAL_SERVICE_ERROR');
    expect(result.severity).toBe('error');
  });

  it('should classify Twilio errors as external', () => {
    const err = new Error('Twilio: message delivery failed');
    const result = classifyError(err);

    expect(result.category).toBe('external');
  });

  it('should classify network/timeout errors as external', () => {
    const err = new Error('Request timeout after 30s');
    const result = classifyError(err);

    expect(result.category).toBe('external');
  });

  it('should classify unknown errors as unknown', () => {
    const err = new Error('Something unexpected happened');
    const result = classifyError(err);

    expect(result.category).toBe('unknown');
    expect(result.code).toBe('UNKNOWN_ERROR');
    expect(result.severity).toBe('error');
  });

  it('should handle non-Error thrown values', () => {
    const result = classifyError('string error');

    expect(result.category).toBe('unknown');
    expect(result.message).toBe('string error');
    expect(result.stack).toBeUndefined();
  });

  it('should handle non-string non-Error values', () => {
    const result = classifyError(42);

    expect(result.message).toBe('Non-Error value thrown');
  });

  it('should preserve the stack trace', () => {
    const err = new Error('test error');
    const result = classifyError(err);

    expect(result.stack).toBeDefined();
    expect(result.stack).toContain('Error: test error');
  });
});

describe('trackError', () => {
  function createMockEnv(): Env {
    return {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            run: vi.fn().mockResolvedValue({}),
          }),
        }),
      },
      SESSIONS: {} as KVNamespace,
      CHAT_ROOM: {} as DurableObjectNamespace,
      ENVIRONMENT: 'test',
    } as unknown as Env;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should persist an error event to D1', async () => {
    const env = createMockEnv();
    const err = new Error('Database connection failed');

    const event = await trackError(env, err, {
      requestId: 'req-123',
      path: '/api/leads',
      method: 'POST',
      statusCode: 500,
    });

    expect(event.id).toBeDefined();
    expect(event.category).toBe('unknown');
    expect(event.message).toBe('Database connection failed');
    expect(event.requestId).toBe('req-123');
    expect(event.path).toBe('/api/leads');
    expect(event.method).toBe('POST');
    expect(event.statusCode).toBe(500);
    expect(event.createdAt).toBeDefined();

    expect(env.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO error_logs'),
    );
  });

  it('should classify D1 errors correctly when tracking', async () => {
    const env = createMockEnv();
    const err = new Error('D1_ERROR: table not found');

    const event = await trackError(env, err);

    expect(event.category).toBe('database');
    expect(event.code).toBe('DATABASE_ERROR');
  });

  it('should not throw if D1 persistence fails', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const env = createMockEnv();
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockReturnValue({
      bind: vi.fn().mockReturnValue({
        run: vi.fn().mockRejectedValue(new Error('D1 unavailable')),
      }),
    });

    const event = await trackError(env, new Error('original error'));

    // Should still return the event even though persistence failed
    expect(event.id).toBeDefined();
    expect(event.message).toBe('original error');

    // Should log the persistence failure
    expect(errorSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(errorSpy.mock.calls[0][0] as string) as Record<
      string,
      unknown
    >;
    expect(logged['level']).toBe('critical');
    expect(logged['message']).toContain('Failed to persist');
  });

  it('should include metadata when provided', async () => {
    const env = createMockEnv();
    const err = new Error('test');

    const event = await trackError(env, err, {
      metadata: { attempt: 3, endpoint: '/external-api' },
    });

    expect(event.metadata).toEqual({ attempt: 3, endpoint: '/external-api' });
  });

  it('should default statusCode to 500', async () => {
    const env = createMockEnv();
    const event = await trackError(env, new Error('test'));

    expect(event.statusCode).toBe(500);
  });

  it('lets a caller that diagnosed the fault state its classification', async () => {
    const env = createMockEnv();
    // classifyError would read "authentication" and file this as auth/warning,
    // and read the registration half of the same fault as unknown/error. A
    // caller that knows what it caught says so instead.
    const event = await trackError(
      env,
      new Error('Unexpected authentication response origin "https://x.test"'),
      {
        statusCode: 400,
        severity: 'error',
        category: 'validation',
        code: 'RP_ORIGIN_UNSUPPORTED',
      },
    );

    expect(event.severity).toBe('error');
    expect(event.category).toBe('validation');
    expect(event.code).toBe('RP_ORIGIN_UNSUPPORTED');
    // The message still comes from the error itself, never from the override.
    expect(event.message).toContain(
      'Unexpected authentication response origin',
    );
  });

  it('still guesses each field the caller left out', async () => {
    const env = createMockEnv();
    const event = await trackError(env, new Error('D1_ERROR: no such table'), {
      code: 'CUSTOM_CODE',
    });

    expect(event.code).toBe('CUSTOM_CODE');
    expect(event.category).toBe('database');
    expect(event.severity).toBe('error');
  });
});

describe('getRecentErrors', () => {
  it('should query D1 and map rows to ErrorEvent', async () => {
    const mockRows = [
      {
        id: 'err-1',
        severity: 'error',
        category: 'database',
        code: 'DATABASE_ERROR',
        message: 'constraint failed',
        stack: null,
        request_id: 'req-1',
        user_id: null,
        workspace_id: 'ws-1',
        path: '/api/leads',
        method: 'POST',
        status_code: 500,
        metadata: '{"table":"leads"}',
        created_at: '2026-04-10T12:00:00.000Z',
      },
    ];

    const env = {
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: mockRows }),
          }),
        }),
      },
    } as unknown as Env;

    const errors = await getRecentErrors(env, 10);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual({
      id: 'err-1',
      severity: 'error',
      category: 'database',
      code: 'DATABASE_ERROR',
      message: 'constraint failed',
      stack: undefined,
      requestId: 'req-1',
      userId: undefined,
      workspaceId: 'ws-1',
      path: '/api/leads',
      method: 'POST',
      statusCode: 500,
      metadata: { table: 'leads' },
      createdAt: '2026-04-10T12:00:00.000Z',
    });
  });

  it('should use default limit of 50', async () => {
    const bindMock = vi.fn().mockReturnValue({
      all: vi.fn().mockResolvedValue({ results: [] }),
    });
    const env = {
      DB: {
        prepare: vi.fn().mockReturnValue({ bind: bindMock }),
      },
    } as unknown as Env;

    await getRecentErrors(env);

    expect(bindMock).toHaveBeenCalledWith(50);
  });
});

describe('ingestClientErrors', () => {
  it('persists each event and uses session ids over client-supplied ones', async () => {
    const runMock = vi.fn().mockResolvedValue({});
    const bindMock = vi.fn().mockReturnValue({ run: runMock });
    const env = {
      DB: { prepare: vi.fn().mockReturnValue({ bind: bindMock }) },
    } as unknown as Env;

    const events = [
      {
        message: 'Boom',
        stack: 'at thing:1',
        url: 'https://app.greenput.com/x',
        timestamp: '2026-04-28T10:00:00Z',
        userId: 'spoofed',
        workspaceId: 'spoofed-ws',
        context: { foo: 'bar' },
        requestId: 'r-1',
      },
    ];

    const count = await ingestClientErrors(env, events, {
      userId: 'real-user',
      workspaceId: 'real-ws',
    });

    expect(count).toBe(1);
    expect(runMock).toHaveBeenCalledTimes(1);
    const boundArgs = bindMock.mock.calls[0];
    // Args: id, severity, category, code, message, stack, request_id,
    // user_id, workspace_id, path, method, status_code, metadata, created_at
    expect(boundArgs[4]).toBe('Boom'); // message
    expect(boundArgs[5]).toBe('at thing:1'); // stack
    expect(boundArgs[6]).toBe('r-1'); // request_id
    expect(boundArgs[7]).toBe('real-user'); // session wins
    expect(boundArgs[8]).toBe('real-ws'); // session wins
    expect(boundArgs[9]).toBe('https://app.greenput.com/x'); // path = url
    expect(boundArgs[13]).toBe('2026-04-28T10:00:00Z'); // created_at from client
    const metadata = JSON.parse(boundArgs[12]);
    expect(metadata.origin).toBe('client');
    expect(metadata.context).toEqual({ foo: 'bar' });
  });

  it('falls back to defaults for missing fields', async () => {
    const runMock = vi.fn().mockResolvedValue({});
    const bindMock = vi.fn().mockReturnValue({ run: runMock });
    const env = {
      DB: { prepare: vi.fn().mockReturnValue({ bind: bindMock }) },
    } as unknown as Env;

    const count = await ingestClientErrors(env, [{}], {});

    expect(count).toBe(1);
    const boundArgs = bindMock.mock.calls[0];
    expect(boundArgs[4]).toBe('Unknown client error');
    expect(boundArgs[5]).toBeNull(); // stack
    expect(boundArgs[7]).toBeNull(); // user_id
    expect(boundArgs[8]).toBeNull(); // workspace_id
    expect(typeof boundArgs[13]).toBe('string'); // generated timestamp
  });

  it('continues ingesting after a per-event persistence failure', async () => {
    const runMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('D1 down'))
      .mockResolvedValue({});
    const bindMock = vi.fn().mockReturnValue({ run: runMock });
    const env = {
      DB: { prepare: vi.fn().mockReturnValue({ bind: bindMock }) },
    } as unknown as Env;

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* swallow */
    });

    const count = await ingestClientErrors(
      env,
      [{ message: 'a' }, { message: 'b' }],
      {},
    );

    expect(count).toBe(1);
    expect(runMock).toHaveBeenCalledTimes(2);
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});
