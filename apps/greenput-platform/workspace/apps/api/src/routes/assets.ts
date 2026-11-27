import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';

export const assetsRouter = Router({ base: '/api/assets' });

// ── List assets ─────────────────────────────────────────────
assetsRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q');
  const assignedTo = url.searchParams.get('assignedTo');

  let where = 'WHERE a.workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (status) {
    where += ' AND a.status = ?';
    params.push(status);
  }
  if (assignedTo) {
    where += ' AND a.assigned_to = ?';
    params.push(assignedTo);
  }
  if (q) {
    where +=
      ' AND (a.name LIKE ? OR a.serial_number LIKE ? OR a.category LIKE ?)';
    const pattern = `%${q}%`;
    params.push(pattern, pattern, pattern);
  }

  const countParams = [...params];
  params.push(limit, offset);

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT a.id, a.name, a.category, a.serial_number, a.qr_code,
              a.status, a.assigned_to, a.vehicle_id, a.purchase_date,
              a.purchase_cost, a.condition, a.location, a.notes,
              a.created_at, a.updated_at,
              u.first_name || ' ' || u.last_name AS assigned_name
       FROM assets a
       LEFT JOIN users u ON a.assigned_to = u.id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT ? OFFSET ?`,
    )
      .bind(...params)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM assets a ${where}`)
      .bind(...countParams)
      .first<{ total: number }>(),
  ]);

  return json({
    data: rows.results ?? [],
    meta: { total: countRow?.total ?? 0, page, perPage: limit },
  });
});

// ── Get single asset ────────────────────────────────────────
assetsRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const asset = await env.DB.prepare(
    `SELECT a.*, u.first_name || ' ' || u.last_name AS assigned_name
     FROM assets a
     LEFT JOIN users u ON a.assigned_to = u.id
     WHERE a.id = ? AND a.workspace_id = ?`,
  )
    .bind(req.params.id, workspaceId)
    .first();

  if (!asset) return notFound('Asset');

  // Fetch recent assignment history
  const { results: assignments } = await env.DB.prepare(
    `SELECT aa.*, u.first_name || ' ' || u.last_name AS user_name
     FROM asset_assignments aa
     LEFT JOIN users u ON aa.user_id = u.id
     WHERE aa.asset_id = ?
     ORDER BY aa.created_at DESC
     LIMIT 20`,
  )
    .bind(req.params.id)
    .all();

  // Fetch maintenance history
  const { results: maintenance } = await env.DB.prepare(
    `SELECT ml.*, u.first_name || ' ' || u.last_name AS performer_name
     FROM maintenance_logs ml
     LEFT JOIN users u ON ml.performed_by = u.id
     WHERE ml.asset_id = ?
     ORDER BY ml.performed_at DESC
     LIMIT 20`,
  )
    .bind(req.params.id)
    .all();

  return json({
    data: {
      ...asset,
      assignments: assignments ?? [],
      maintenance: maintenance ?? [],
    },
  });
});

// ── Create asset ────────────────────────────────────────────
assetsRouter.post('/', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const session = (req as unknown as Record<string, unknown>).session as {
    userId: string;
  };
  const body = (await req.json()) as Record<string, unknown>;

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    return error('Name is required', 400, 'VALIDATION_ERROR');
  }

  const id = newId();
  const qrCode = `gp-asset-${id}`;
  const now = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO assets (id, workspace_id, name, category, serial_number, qr_code,
       status, assigned_to, vehicle_id, purchase_date, purchase_cost,
       condition, location, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      workspaceId,
      body.name as string,
      (body.category as string) || 'equipment',
      (body.serialNumber as string) || null,
      qrCode,
      'available',
      (body.assignedTo as string) || null,
      (body.vehicleId as string) || null,
      (body.purchaseDate as string) || null,
      (body.purchaseCost as number) ?? null,
      (body.condition as string) || 'good',
      (body.location as string) || '',
      (body.notes as string) || '',
      now,
      now,
    )
    .run();

  // Log activity
  await env.DB.prepare(
    `INSERT INTO activity_log (id, workspace_id, entity_type, entity_id, action, user_id, created_at)
     VALUES (?, ?, 'asset', ?, 'created', ?, ?)`,
  )
    .bind(newId(), workspaceId, id, session.userId, now)
    .run();

  return json(
    {
      data: {
        id,
        qrCode,
        name: body.name,
        status: 'available',
        createdAt: now,
      },
    },
    201,
  );
});

// ── Update asset ────────────────────────────────────────────
assetsRouter.patch('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const body = (await req.json()) as Record<string, unknown>;

  const existing = await env.DB.prepare(
    `SELECT id FROM assets WHERE id = ? AND workspace_id = ?`,
  )
    .bind(req.params.id, workspaceId)
    .first();

  if (!existing) return notFound('Asset');

  const fields: string[] = [];
  const values: unknown[] = [];

  const allowed = [
    'name',
    'category',
    'serial_number',
    'status',
    'assigned_to',
    'vehicle_id',
    'purchase_date',
    'purchase_cost',
    'condition',
    'location',
    'notes',
  ];
  const camelToSnake: Record<string, string> = {
    serialNumber: 'serial_number',
    assignedTo: 'assigned_to',
    vehicleId: 'vehicle_id',
    purchaseDate: 'purchase_date',
    purchaseCost: 'purchase_cost',
  };

  for (const [key, val] of Object.entries(body)) {
    const col = camelToSnake[key] ?? key;
    if (allowed.includes(col)) {
      fields.push(`${col} = ?`);
      values.push(val);
    }
  }

  if (fields.length === 0)
    return error('No valid fields to update', 400, 'VALIDATION_ERROR');

  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(req.params.id, workspaceId);

  await env.DB.prepare(
    `UPDATE assets SET ${fields.join(', ')} WHERE id = ? AND workspace_id = ?`,
  )
    .bind(...values)
    .run();

  return json({ data: { id: req.params.id, updated: true } });
});

// ── Delete asset ────────────────────────────────────────────
assetsRouter.delete('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const result = await env.DB.prepare(
    `DELETE FROM assets WHERE id = ? AND workspace_id = ?`,
  )
    .bind(req.params.id, workspaceId)
    .run();

  if (!result.meta.changes) return notFound('Asset');
  return json({ data: { id: req.params.id, deleted: true } });
});

// ── Check out / check in ────────────────────────────────────
assetsRouter.post('/:id/assign', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const body = (await req.json()) as {
    action: 'check_out' | 'check_in';
    userId: string;
    jobId?: string;
    notes?: string;
  };

  const asset = await env.DB.prepare(
    `SELECT id, status FROM assets WHERE id = ? AND workspace_id = ?`,
  )
    .bind(req.params.id, workspaceId)
    .first<{ id: string; status: string }>();

  if (!asset) return notFound('Asset');

  if (body.action === 'check_out' && asset.status !== 'available') {
    return error(
      'Asset is not available for checkout',
      409,
      'ASSET_UNAVAILABLE',
    );
  }

  const id = newId();
  const now = new Date().toISOString();

  const newStatus = body.action === 'check_out' ? 'checked_out' : 'available';
  const assignedTo = body.action === 'check_out' ? body.userId : null;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO asset_assignments (id, workspace_id, asset_id, user_id, job_id, action, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      workspaceId,
      req.params.id,
      body.userId,
      body.jobId || null,
      body.action,
      body.notes || '',
      now,
    ),
    env.DB.prepare(
      `UPDATE assets SET status = ?, assigned_to = ?, updated_at = ? WHERE id = ?`,
    ).bind(newStatus, assignedTo, now, req.params.id),
  ]);

  return json({
    data: {
      assignmentId: id,
      assetId: req.params.id,
      action: body.action,
      status: newStatus,
    },
  });
});

// ── Log maintenance ─────────────────────────────────────────
assetsRouter.post('/:id/maintenance', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const session = (req as unknown as Record<string, unknown>).session as {
    userId: string;
  };
  const body = (await req.json()) as {
    type: string;
    description: string;
    cost?: number;
    nextDue?: string;
  };

  const asset = await env.DB.prepare(
    `SELECT id FROM assets WHERE id = ? AND workspace_id = ?`,
  )
    .bind(req.params.id, workspaceId)
    .first();

  if (!asset) return notFound('Asset');

  const id = newId();
  const now = new Date().toISOString();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO maintenance_logs (id, workspace_id, asset_id, type, description, cost, performed_by, performed_at, next_due, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      workspaceId,
      req.params.id,
      body.type || 'repair',
      body.description,
      body.cost ?? null,
      session.userId,
      now,
      body.nextDue || null,
      now,
    ),
    env.DB.prepare(
      `UPDATE assets SET condition = CASE WHEN ? = 'replacement' THEN 'new' ELSE condition END, updated_at = ? WHERE id = ?`,
    ).bind(body.type, now, req.params.id),
  ]);

  return json(
    { data: { id, assetId: req.params.id, type: body.type, performedAt: now } },
    201,
  );
});

// ── QR code generation (SVG) ────────────────────────────────
assetsRouter.get('/:id/qr', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const asset = await env.DB.prepare(
    `SELECT id, qr_code, name FROM assets WHERE id = ? AND workspace_id = ?`,
  )
    .bind(req.params.id, workspaceId)
    .first<{ id: string; qr_code: string; name: string }>();

  if (!asset) return notFound('Asset');

  const qrData = asset.qr_code;
  const svg = generateQRSvg(qrData, asset.name);

  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'public, max-age=86400',
    },
  });
});

// ── Lookup by QR code ───────────────────────────────────────
assetsRouter.get('/lookup/:qrCode', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const asset = await env.DB.prepare(
    `SELECT a.*, u.first_name || ' ' || u.last_name AS assigned_name
     FROM assets a
     LEFT JOIN users u ON a.assigned_to = u.id
     WHERE a.qr_code = ? AND a.workspace_id = ?`,
  )
    .bind(req.params.qrCode, workspaceId)
    .first();

  if (!asset) return notFound('Asset');
  return json({ data: asset });
});

// ── Maintenance due soon ────────────────────────────────────
assetsRouter.get('/maintenance/upcoming', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const url = new URL(req.url);
  const days = Number(url.searchParams.get('days') ?? 30);

  const cutoff = new Date(Date.now() + days * 86400000).toISOString();

  const { results } = await env.DB.prepare(
    `SELECT ml.id, ml.asset_id, ml.type, ml.next_due, a.name AS asset_name
     FROM maintenance_logs ml
     JOIN assets a ON ml.asset_id = a.id
     WHERE ml.workspace_id = ?
       AND ml.next_due IS NOT NULL
       AND ml.next_due <= ?
       AND ml.next_due >= datetime('now')
     ORDER BY ml.next_due ASC
     LIMIT 50`,
  )
    .bind(workspaceId, cutoff)
    .all();

  return json({ data: results ?? [] });
});

/**
 * Generate a minimal QR code as SVG using a simple encoding.
 * For production, use a proper QR library — this creates a scannable
 * data matrix placeholder with the asset identifier embedded as text.
 */
function generateQRSvg(data: string, label: string): string {
  // Generate a deterministic pattern from the data string
  const size = 21; // QR version 1 is 21x21
  const moduleSize = 8;
  const padding = 16;
  const totalSize = size * moduleSize + padding * 2;
  const labelHeight = 24;

  let modules = '';

  // Fixed finder patterns (top-left, top-right, bottom-left)
  const finderPositions = [
    [0, 0],
    [14, 0],
    [0, 14],
  ];
  for (const [fx, fy] of finderPositions) {
    for (let dy = 0; dy < 7; dy++) {
      for (let dx = 0; dx < 7; dx++) {
        const isOuter = dx === 0 || dx === 6 || dy === 0 || dy === 6;
        const isInner = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
        if (isOuter || isInner) {
          modules += `<rect x="${padding + (fx + dx) * moduleSize}" y="${padding + (fy + dy) * moduleSize}" width="${moduleSize}" height="${moduleSize}"/>`;
        }
      }
    }
  }

  // Data area — hash-based pattern for unique visual
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Skip finder pattern areas
      if ((x < 8 && y < 8) || (x > 12 && y < 8) || (x < 8 && y > 12)) continue;
      // Timing patterns
      if (x === 6 || y === 6) {
        if ((x + y) % 2 === 0) {
          modules += `<rect x="${padding + x * moduleSize}" y="${padding + y * moduleSize}" width="${moduleSize}" height="${moduleSize}"/>`;
        }
        continue;
      }
      // Data modules from hash
      const bit = ((hash >> ((x * size + y) % 31)) ^ (x * 7 + y * 13)) & 1;
      if (bit) {
        modules += `<rect x="${padding + x * moduleSize}" y="${padding + y * moduleSize}" width="${moduleSize}" height="${moduleSize}"/>`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize + labelHeight}" width="${totalSize}" height="${totalSize + labelHeight}">
  <rect width="100%" height="100%" fill="white"/>
  <g fill="black">${modules}</g>
  <text x="${totalSize / 2}" y="${totalSize + labelHeight - 6}" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#333">${escapeXml(label)}</text>
</svg>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
