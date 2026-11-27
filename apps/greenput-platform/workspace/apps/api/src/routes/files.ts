import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';

export const filesRouter = Router({ base: '/api/files' });

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// POST /api/files/upload
filesRouter.post('/upload', async (req: IRequest, env: Env) => {
  if (!env.FILES) {
    return error('File storage not configured', 503, 'SERVICE_UNAVAILABLE');
  }

  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const user = (req as unknown as { user: { id: string } }).user;

  let formData: FormData;
  try {
    formData = await (req as unknown as Request).formData();
  } catch {
    return error('Invalid multipart form data', 400, 'INVALID_FORM_DATA');
  }

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    return error('Missing file field', 400, 'MISSING_FILE');
  }

  if (file.size > MAX_FILE_SIZE) {
    return error(
      `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB`,
      400,
      'FILE_TOO_LARGE',
    );
  }

  const contentType = file.type || 'application/octet-stream';
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    return error('File type not allowed', 400, 'INVALID_FILE_TYPE');
  }

  const entityType = formData.get('entityType');
  const entityId = formData.get('entityId');

  if (typeof entityType !== 'string' || entityType.length === 0) {
    return error('Missing "entityType" field', 400, 'MISSING_ENTITY_TYPE');
  }
  if (typeof entityId !== 'string' || entityId.length === 0) {
    return error('Missing "entityId" field', 400, 'MISSING_ENTITY_ID');
  }

  const fileId = newId();
  const sanitizedFilename = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const r2Key = `${workspaceId}/${entityType}/${entityId}/${sanitizedFilename}`;

  const now = new Date().toISOString();

  await env.FILES.put(r2Key, file.stream(), {
    httpMetadata: { contentType },
    customMetadata: {
      workspaceId,
      uploadedBy: user.id,
      originalFilename: file.name,
    },
  });

  await env.DB.prepare(
    `
    INSERT INTO files (id, workspace_id, entity_type, entity_id, filename, content_type, size, r2_key, uploaded_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
  )
    .bind(
      fileId,
      workspaceId,
      entityType,
      entityId,
      file.name,
      contentType,
      file.size,
      r2Key,
      user.id,
      now,
    )
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
    VALUES (?, ?, ?, 'file', ?, 'uploaded', ?, ?)
  `,
  )
    .bind(
      newId(),
      workspaceId,
      user.id,
      fileId,
      JSON.stringify({ filename: file.name, size: file.size, contentType }),
      now,
    )
    .run();

  return json(
    {
      data: {
        id: fileId,
        filename: file.name,
        contentType,
        size: file.size,
        entityType,
        entityId,
        createdAt: now,
      },
    },
    201,
  );
});

// GET /api/files
filesRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const entityType = url.searchParams.get('entityType');
  const entityId = url.searchParams.get('entityId');

  let where = 'WHERE workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (entityType) {
    where += ' AND entity_type = ?';
    params.push(entityType);
  }
  if (entityId) {
    where += ' AND entity_id = ?';
    params.push(entityId);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `
      SELECT id, workspace_id, entity_type, entity_id, filename, content_type, size, uploaded_by, created_at
      FROM files
      ${where}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM files ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return json({
    data: rows.results,
    meta: { total: countRow?.total ?? 0, page, perPage: limit },
  });
});

// GET /api/files/:id
filesRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const file = await env.DB.prepare(
    'SELECT id, workspace_id, entity_type, entity_id, filename, content_type, size, uploaded_by, created_at FROM files WHERE id = ? AND workspace_id = ?',
  )
    .bind(req.params!['id'], workspaceId)
    .first();

  if (!file) return notFound('File');
  return json({ data: file });
});

// GET /api/files/:id/download
filesRouter.get('/:id/download', async (req: IRequest, env: Env) => {
  if (!env.FILES) {
    return error('File storage not configured', 503, 'SERVICE_UNAVAILABLE');
  }

  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const file = await env.DB.prepare(
    'SELECT r2_key, filename, content_type FROM files WHERE id = ? AND workspace_id = ?',
  )
    .bind(req.params!['id'], workspaceId)
    .first<{ r2_key: string; filename: string; content_type: string }>();

  if (!file) return notFound('File');

  const object = await env.FILES.get(file.r2_key);
  if (!object) {
    return error('File not found in storage', 404, 'STORAGE_NOT_FOUND');
  }

  return new Response(object.body, {
    headers: {
      'Content-Type': file.content_type,
      'Content-Disposition': `attachment; filename="${file.filename.replace(/"/g, '\\"')}"`,
      'Cache-Control': 'private, max-age=3600',
    },
  });
});

// DELETE /api/files/:id
filesRouter.delete('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const user = (req as unknown as { user: { id: string } }).user;

  const file = await env.DB.prepare(
    'SELECT id, r2_key, filename FROM files WHERE id = ? AND workspace_id = ?',
  )
    .bind(req.params!['id'], workspaceId)
    .first<{ id: string; r2_key: string; filename: string }>();

  if (!file) return notFound('File');

  // Delete from R2 if bucket is configured
  if (env.FILES) {
    await env.FILES.delete(file.r2_key);
  }

  const now = new Date().toISOString();

  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(file.id).run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
    VALUES (?, ?, ?, 'file', ?, 'deleted', ?, ?)
  `,
  )
    .bind(
      newId(),
      workspaceId,
      user.id,
      file.id,
      JSON.stringify({ filename: file.filename }),
      now,
    )
    .run();

  return json({ data: { id: file.id, deleted: true } });
});
