import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';
import { entity, entityList } from '../lib/serialize';
import { WIRE_VEHICLE } from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import {
  CreateVehicleSchema,
  UpdateVehicleSchema,
} from '@greenput/shared/validators';

export const vehiclesRouter = Router({ base: '/api/vehicles' });

// GET /api/vehicles — List vehicles
vehiclesRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const status = url.searchParams.get('status');
  const q = url.searchParams.get('q');

  let where = 'WHERE v.workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (status) {
    where += ' AND v.status = ?';
    params.push(status);
  }
  if (q) {
    where +=
      ' AND (v.name LIKE ? OR v.make LIKE ? OR v.model LIKE ? OR v.license_plate LIKE ? OR v.vin LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `
      SELECT v.*, u.first_name AS assigned_first_name, u.last_name AS assigned_last_name
      FROM vehicles v
      LEFT JOIN users u ON v.assigned_to = u.id
      ${where}
      ORDER BY v.name ASC
      LIMIT ? OFFSET ?
      `,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM vehicles v ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_VEHICLE, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// GET /api/vehicles/:id — Get vehicle details
vehiclesRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const vehicleId = req.params!['id'];

  const vehicle = await env.DB.prepare(
    `
    SELECT v.*, u.first_name AS assigned_first_name, u.last_name AS assigned_last_name
    FROM vehicles v
    LEFT JOIN users u ON v.assigned_to = u.id
    WHERE v.id = ? AND v.workspace_id = ?
    `,
  )
    .bind(vehicleId, workspaceId)
    .first<Record<string, unknown>>();

  if (!vehicle) return notFound('Vehicle');
  return entity(WIRE_VEHICLE, vehicle);
});

// POST /api/vehicles — Add vehicle
vehiclesRouter.post(
  '/',
  validate(CreateVehicleSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const body = (req as any).validatedBody as Record<string, unknown>;

    const id = newId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `
    INSERT INTO vehicles (
      id, workspace_id, name, make, model, year, license_plate, vin,
      assigned_to, status, mileage, notes, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `,
    )
      .bind(
        id,
        workspaceId,
        (body.name as string).trim(),
        body.make ?? '',
        body.model ?? '',
        body.year ?? null,
        body.licensePlate ?? null,
        body.vin ?? null,
        body.assignedTo ?? null,
        body.status ?? 'active',
        body.mileage ?? 0,
        body.notes ?? '',
        now,
        now,
      )
      .run();

    // Log activity
    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'vehicle', ?, 'created', ?)
    `,
    )
      .bind(newId(), workspaceId, user.id, id, now)
      .run();

    const vehicle = await env.DB.prepare('SELECT * FROM vehicles WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>();

    return entity(WIRE_VEHICLE, vehicle, {}, 201);
  },
);

// PATCH /api/vehicles/:id — Update vehicle
vehiclesRouter.patch(
  '/:id',
  validate(UpdateVehicleSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const vehicleId = req.params!['id'];

    const existing = await env.DB.prepare(
      'SELECT id FROM vehicles WHERE id = ? AND workspace_id = ?',
    )
      .bind(vehicleId, workspaceId)
      .first();

    if (!existing) return notFound('Vehicle');

    const body = (req as any).validatedBody as Record<string, unknown>;
    const now = new Date().toISOString();

    const allowed = [
      'name',
      'make',
      'model',
      'year',
      'license_plate',
      'vin',
      'assigned_to',
      'status',
      'mileage',
      'notes',
    ];

    const camelToSnake: Record<string, string> = {
      licensePlate: 'license_plate',
      assignedTo: 'assigned_to',
    };

    const sets: string[] = ['updated_at = ?'];
    const vals: unknown[] = [now];

    for (const [key, val] of Object.entries(body)) {
      const col = camelToSnake[key] ?? key;
      if (allowed.includes(col)) {
        sets.push(`${col} = ?`);
        vals.push(val);
      }
    }

    if (sets.length === 1) {
      return error('No valid fields to update', 400, 'VALIDATION_ERROR');
    }

    vals.push(vehicleId, workspaceId);

    await env.DB.prepare(
      `UPDATE vehicles SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
    )
      .bind(...vals)
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'vehicle', ?, 'updated', ?)
    `,
    )
      .bind(newId(), workspaceId, user.id, vehicleId, now)
      .run();

    const updated = await env.DB.prepare('SELECT * FROM vehicles WHERE id = ?')
      .bind(vehicleId)
      .first<Record<string, unknown>>();

    return entity(WIRE_VEHICLE, updated);
  },
);

// DELETE /api/vehicles/:id — Remove vehicle
vehiclesRouter.delete('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const user = (req as unknown as { user: { id: string } }).user;
  const vehicleId = req.params!['id'];

  const existing = await env.DB.prepare(
    'SELECT id FROM vehicles WHERE id = ? AND workspace_id = ?',
  )
    .bind(vehicleId, workspaceId)
    .first();

  if (!existing) return notFound('Vehicle');

  await env.DB.prepare('DELETE FROM vehicles WHERE id = ? AND workspace_id = ?')
    .bind(vehicleId, workspaceId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'vehicle', ?, 'deleted', ?)
    `,
  )
    .bind(newId(), workspaceId, user.id, vehicleId, new Date().toISOString())
    .run();

  return json({ data: { deleted: true } });
});
