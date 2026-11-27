import { describe, it, expect, vi } from 'vitest';
import { filesRouter } from './files';

function makeEnv(withFiles = false) {
  const firstMock = vi.fn().mockResolvedValue(null);
  const allMock = vi.fn().mockResolvedValue({ results: [] });
  const runMock = vi.fn().mockResolvedValue({});
  const bindMock = vi
    .fn()
    .mockReturnValue({ first: firstMock, all: allMock, run: runMock });
  const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });

  const filesMock = withFiles
    ? {
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
      }
    : undefined;

  return {
    env: {
      DB: { prepare: prepareMock },
      SESSIONS: {},
      ENVIRONMENT: 'development',
      FILES: filesMock,
    } as unknown as {
      DB: unknown;
      SESSIONS: unknown;
      ENVIRONMENT: string;
      FILES: unknown;
    },
    firstMock,
    allMock,
    runMock,
    bindMock,
    prepareMock,
    filesMock,
  };
}

function makeReq(path: string, init: RequestInit = {}) {
  const req = new Request(`https://api.greenput.com/api/files${path}`, init);
  (req as unknown as Record<string, unknown>)['workspaceId'] = 'ws-1';
  (req as unknown as Record<string, unknown>)['user'] = {
    id: 'user-1',
    role: 'owner',
  };
  return req;
}

function makeUploadReq(fields: Record<string, string | Blob>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return makeReq('/upload', { method: 'POST', body: fd });
}

describe('filesRouter', () => {
  it('exports filesRouter with fetch', () => {
    expect(filesRouter).toBeDefined();
    expect(typeof filesRouter.fetch).toBe('function');
  });
});

describe('GET /api/files', () => {
  it('returns 200 with empty list', async () => {
    const { env } = makeEnv();
    const res = await filesRouter.fetch(makeReq('/'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      meta: { total: number };
    };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta).toHaveProperty('total');
  });

  it('returns file list', async () => {
    const { env, allMock } = makeEnv();
    allMock.mockResolvedValueOnce({
      results: [
        {
          id: 'f1',
          filename: 'photo.jpg',
          content_type: 'image/jpeg',
          size: 1024,
        },
      ],
    });
    const res = await filesRouter.fetch(makeReq('/'), env);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(1);
  });

  it('supports entityType filter', async () => {
    const { env } = makeEnv();
    const res = await filesRouter.fetch(makeReq('/?entityType=job'), env);
    expect(res.status).toBe(200);
  });

  it('supports entityId filter', async () => {
    const { env } = makeEnv();
    const res = await filesRouter.fetch(makeReq('/?entityId=job-1'), env);
    expect(res.status).toBe(200);
  });

  it('returns pagination meta', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({ total: 15 });
    const res = await filesRouter.fetch(makeReq('/?page=2&perPage=5'), env);
    const body = (await res.json()) as {
      meta: { page: number; perPage: number; total: number };
    };
    expect(body.meta.page).toBe(2);
    expect(body.meta.perPage).toBe(5);
    expect(body.meta.total).toBe(15);
  });
});

describe('GET /api/files/:id', () => {
  it('returns 404 when file not found', async () => {
    const { env } = makeEnv();
    const res = await filesRouter.fetch(makeReq('/nonexistent'), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with file metadata when found', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({
      id: 'f1',
      filename: 'document.pdf',
      content_type: 'application/pdf',
      size: 2048,
    });
    const res = await filesRouter.fetch(makeReq('/f1'), env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { filename: string } };
    expect(body.data.filename).toBe('document.pdf');
  });
});

describe('POST /api/files/upload', () => {
  it('returns 503 when FILES binding is not configured', async () => {
    const { env } = makeEnv(false);
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' });
    const res = await filesRouter.fetch(
      makeUploadReq({ file, entityType: 'job', entityId: 'job-1' }),
      env,
    );
    expect(res.status).toBe(503);
  });

  it('returns 400 when file field is missing', async () => {
    const { env } = makeEnv(true);
    const res = await filesRouter.fetch(
      makeUploadReq({ entityType: 'job', entityId: 'job-1' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when entityType is missing', async () => {
    const { env } = makeEnv(true);
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    const res = await filesRouter.fetch(
      makeUploadReq({ file, entityId: 'job-1' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when entityId is missing', async () => {
    const { env } = makeEnv(true);
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    const res = await filesRouter.fetch(
      makeUploadReq({ file, entityType: 'job' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 for disallowed content type', async () => {
    const { env } = makeEnv(true);
    const file = new File(['<script>bad</script>'], 'evil.html', {
      type: 'text/html',
    });
    const res = await filesRouter.fetch(
      makeUploadReq({ file, entityType: 'job', entityId: 'job-1' }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it('uploads file and returns 201 with metadata', async () => {
    const { env, runMock, filesMock } = makeEnv(true);
    const file = new File(['hello world'], 'document.pdf', {
      type: 'application/pdf',
    });
    const res = await filesRouter.fetch(
      makeUploadReq({ file, entityType: 'job', entityId: 'job-1' }),
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { filename: string; contentType: string };
    };
    expect(body.data.filename).toBe('document.pdf');
    expect(body.data.contentType).toBe('application/pdf');
    expect(filesMock?.put).toHaveBeenCalled();
    expect(runMock).toHaveBeenCalledTimes(2); // INSERT files + INSERT activity_log
  });

  it('sanitizes filename in R2 key', async () => {
    const { env, filesMock } = makeEnv(true);
    const file = new File(['data'], 'my photo (1).jpg', { type: 'image/jpeg' });
    await filesRouter.fetch(
      makeUploadReq({ file, entityType: 'lead', entityId: 'lead-1' }),
      env,
    );
    const putKey = (filesMock?.put as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as string;
    expect(putKey).toContain('my_photo__1_.jpg');
    expect(putKey).not.toContain(' ');
    expect(putKey).not.toContain('(');
  });
});

describe('GET /api/files/:id/download', () => {
  it('returns 503 when FILES binding is not configured', async () => {
    const { env, firstMock } = makeEnv(false);
    firstMock.mockResolvedValue({
      r2_key: 'ws-1/job/j1/file.pdf',
      filename: 'file.pdf',
      content_type: 'application/pdf',
    });
    const res = await filesRouter.fetch(makeReq('/f1/download'), env);
    expect(res.status).toBe(503);
  });

  it('returns 404 when file record not found', async () => {
    const { env } = makeEnv(true);
    const res = await filesRouter.fetch(makeReq('/nonexistent/download'), env);
    expect(res.status).toBe(404);
  });

  it('returns 404 when file not found in R2 storage', async () => {
    const { env, firstMock, filesMock } = makeEnv(true);
    firstMock.mockResolvedValue({
      r2_key: 'ws-1/job/j1/file.pdf',
      filename: 'file.pdf',
      content_type: 'application/pdf',
    });
    (filesMock!.get as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await filesRouter.fetch(makeReq('/f1/download'), env);
    expect(res.status).toBe(404);
  });

  it('returns file body with Content-Disposition header when found', async () => {
    const { env, firstMock, filesMock } = makeEnv(true);
    firstMock.mockResolvedValue({
      r2_key: 'ws-1/job/j1/report.pdf',
      filename: 'report.pdf',
      content_type: 'application/pdf',
    });
    (filesMock!.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      body: new ReadableStream(),
    });
    const res = await filesRouter.fetch(makeReq('/f1/download'), env);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('report.pdf');
    expect(res.headers.get('content-type')).toBe('application/pdf');
  });
});

describe('DELETE /api/files/:id', () => {
  it('returns 404 when file not found', async () => {
    const { env } = makeEnv();
    const res = await filesRouter.fetch(
      makeReq('/nonexistent', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(404);
  });

  it('returns 200 with deleted:true on success', async () => {
    const { env, firstMock } = makeEnv();
    firstMock.mockResolvedValue({
      id: 'f1',
      r2_key: 'ws-1/job/j1/photo.jpg',
      filename: 'photo.jpg',
    });
    const res = await filesRouter.fetch(
      makeReq('/f1', { method: 'DELETE' }),
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { deleted: boolean; id: string };
    };
    expect(body.data.deleted).toBe(true);
    expect(body.data.id).toBe('f1');
  });

  it('deletes from R2 when FILES is configured', async () => {
    const { env, firstMock, filesMock } = makeEnv(true);
    firstMock.mockResolvedValue({
      id: 'f1',
      r2_key: 'ws-1/job/j1/photo.jpg',
      filename: 'photo.jpg',
    });
    await filesRouter.fetch(makeReq('/f1', { method: 'DELETE' }), env);
    expect(filesMock?.delete).toHaveBeenCalledWith('ws-1/job/j1/photo.jpg');
  });

  it('logs deletion in activity_log', async () => {
    const { env, firstMock, runMock } = makeEnv();
    firstMock.mockResolvedValue({
      id: 'f1',
      r2_key: 'key',
      filename: 'photo.jpg',
    });
    await filesRouter.fetch(makeReq('/f1', { method: 'DELETE' }), env);
    // DELETE files + INSERT activity_log
    expect(runMock).toHaveBeenCalledTimes(2);
  });
});
