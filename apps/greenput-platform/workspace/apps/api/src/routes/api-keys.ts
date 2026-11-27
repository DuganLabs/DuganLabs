import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, forbidden, newId } from '../lib/response';
import { entity, entityArray } from '../lib/serialize';
import { WIRE_API_KEY, WIRE_API_KEY_CREATED } from '@greenput/shared/models';
import { hashApiKey, extractPrefix } from '../middleware/api-key-auth';
import { validate } from '../middleware/validate';
import {
  CreateApiKeySchema,
  UpdateApiKeySchema,
} from '@greenput/shared/validators';

export const apiKeysRouter = Router({ base: '/api/api-keys' });

/** Generate a random API key: `gp_` + 32 random hex chars */
function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `gp_${hex}`;
}

/** Check that the requesting user is owner or admin */
function requireOwnerOrAdmin(req: IRequest): Response | undefined {
  const user = (req as unknown as { user: { role: string } }).user;
  if (user.role !== 'owner' && user.role !== 'admin') {
    return forbidden();
  }
  return undefined;
}

// GET /api/api-keys — list keys for workspace
apiKeysRouter.get('/', async (req: IRequest, env: Env) => {
  const roleCheck = requireOwnerOrAdmin(req);
  if (roleCheck) return roleCheck;

  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const rows = await env.DB.prepare(
    `SELECT id, workspace_id, name, key_prefix, scopes, last_used_at, expires_at, created_at, created_by
     FROM api_keys
     WHERE workspace_id = ?
     ORDER BY created_at DESC`,
  )
    .bind(workspaceId)
    .all();

  return entityArray(WIRE_API_KEY, rows.results);
});

// POST /api/api-keys — create a new API key
apiKeysRouter.post(
  '/',
  validate(CreateApiKeySchema),
  async (req: IRequest, env: Env) => {
    const roleCheck = requireOwnerOrAdmin(req);
    if (roleCheck) return roleCheck;

    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const body = (
      req as unknown as {
        validatedBody: { name: string; scopes: string[]; expiresAt?: string };
      }
    ).validatedBody;

    const { name, scopes, expiresAt: rawExpiresAt } = body;
    const expiresAt = rawExpiresAt
      ? new Date(rawExpiresAt).toISOString()
      : null;

    const id = newId();
    const rawKey = generateApiKey();
    const keyPrefix = extractPrefix(rawKey);
    const keyHash = await hashApiKey(rawKey);

    await env.DB.prepare(
      `INSERT INTO api_keys (id, workspace_id, name, key_prefix, key_hash, scopes, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        workspaceId,
        name,
        keyPrefix,
        keyHash,
        JSON.stringify(scopes),
        expiresAt,
        user.id,
      )
      .run();

    // Return the full key ONCE — it cannot be retrieved again. Everything
    // else about the row comes back through the wire contract, so the create
    // response and the list response describe the same thing (they used to
    // disagree: create invented `scopes` as an array and `createdAt` as
    // "now", while the list handed out the raw JSON string and the stored
    // timestamp).
    const created = await env.DB.prepare(
      `SELECT id, workspace_id, name, key_prefix, scopes, last_used_at, expires_at, created_at, created_by
       FROM api_keys WHERE id = ?`,
    )
      .bind(id)
      .first<Record<string, unknown>>();

    return entity(WIRE_API_KEY_CREATED, created, { key: rawKey }, 201);
  },
);

// PATCH /api/api-keys/:id — update name or scopes
apiKeysRouter.patch(
  '/:id',
  validate(UpdateApiKeySchema),
  async (req: IRequest, env: Env) => {
    const roleCheck = requireOwnerOrAdmin(req);
    if (roleCheck) return roleCheck;

    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const keyId = req.params!['id'];

    // Verify key belongs to this workspace
    const existing = await env.DB.prepare(
      'SELECT id FROM api_keys WHERE id = ? AND workspace_id = ?',
    )
      .bind(keyId, workspaceId)
      .first();

    if (!existing) return notFound('API key');

    const body = (
      req as unknown as { validatedBody: { name?: string; scopes?: string[] } }
    ).validatedBody;

    const updates: string[] = [];
    const params: unknown[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      params.push(body.name);
    }

    if (body.scopes !== undefined) {
      updates.push('scopes = ?');
      params.push(JSON.stringify(body.scopes));
    }

    params.push(keyId, workspaceId);
    await env.DB.prepare(
      `UPDATE api_keys SET ${updates.join(', ')} WHERE id = ? AND workspace_id = ?`,
    )
      .bind(...params)
      .run();

    // Return updated key
    const updated = await env.DB.prepare(
      `SELECT id, workspace_id, name, key_prefix, scopes, last_used_at, expires_at, created_at, created_by
       FROM api_keys WHERE id = ?`,
    )
      .bind(keyId)
      .first<Record<string, unknown>>();

    return entity(WIRE_API_KEY, updated);
  },
);

// DELETE /api/api-keys/:id — revoke a key
apiKeysRouter.delete('/:id', async (req: IRequest, env: Env) => {
  const roleCheck = requireOwnerOrAdmin(req);
  if (roleCheck) return roleCheck;

  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const keyId = req.params!['id'];

  const existing = await env.DB.prepare(
    'SELECT id FROM api_keys WHERE id = ? AND workspace_id = ?',
  )
    .bind(keyId, workspaceId)
    .first();

  if (!existing) return notFound('API key');

  await env.DB.prepare('DELETE FROM api_keys WHERE id = ? AND workspace_id = ?')
    .bind(keyId, workspaceId)
    .run();

  return json({ data: { id: keyId, deleted: true } });
});
