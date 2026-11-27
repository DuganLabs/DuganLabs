import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';
import { entity, entityList, toWireList } from '../lib/serialize';
import {
  WIRE_INVENTORY_ITEM,
  WIRE_INVENTORY_TRANSACTION,
} from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import {
  CreateInventoryItemSchema,
  UpdateInventoryItemSchema,
  AdjustInventorySchema,
} from '@greenput/shared/validators';

export const inventoryRouter = Router({ base: '/api/inventory' });

// GET /api/inventory/low-stock — Items below minimum quantity
// Must be defined before /:id to avoid matching "low-stock" as an id
inventoryRouter.get('/low-stock', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `
      SELECT * FROM inventory_items
      WHERE workspace_id = ? AND quantity < min_quantity
      ORDER BY (min_quantity - quantity) DESC
      LIMIT ? OFFSET ?
      `,
    )
      .bind(workspaceId, limit, offset)
      .all(),
    env.DB.prepare(
      `SELECT COUNT(*) AS total FROM inventory_items WHERE workspace_id = ? AND quantity < min_quantity`,
    )
      .bind(workspaceId)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_INVENTORY_ITEM, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// GET /api/inventory — List items (search, category filter, low stock filter)
inventoryRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;

  const category = url.searchParams.get('category');
  const q = url.searchParams.get('q');
  const lowStock = url.searchParams.get('lowStock');

  let where = 'WHERE workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (category) {
    where += ' AND category = ?';
    params.push(category);
  }
  if (q) {
    where +=
      ' AND (name LIKE ? OR sku LIKE ? OR description LIKE ? OR supplier LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (lowStock === 'true') {
    where += ' AND quantity < min_quantity';
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM inventory_items ${where} ORDER BY name ASC LIMIT ? OFFSET ?`,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM inventory_items ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_INVENTORY_ITEM, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// GET /api/inventory/:id — Get item with transaction history
inventoryRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const itemId = req.params!['id'];

  const item = await env.DB.prepare(
    'SELECT * FROM inventory_items WHERE id = ? AND workspace_id = ?',
  )
    .bind(itemId, workspaceId)
    .first<Record<string, unknown>>();

  if (!item) return notFound('Inventory item');

  const transactions = await env.DB.prepare(
    `
    SELECT t.*, u.first_name, u.last_name
    FROM inventory_transactions t
    LEFT JOIN users u ON t.created_by = u.id
    WHERE t.item_id = ? AND t.workspace_id = ?
    ORDER BY t.created_at DESC
    LIMIT 50
    `,
  )
    .bind(itemId, workspaceId)
    .all();

  return entity(WIRE_INVENTORY_ITEM, item, {
    transactions: toWireList(WIRE_INVENTORY_TRANSACTION, transactions.results),
  });
});

// POST /api/inventory — Create item
inventoryRouter.post(
  '/',
  validate(CreateInventoryItemSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const body = (req as any).validatedBody as Record<string, unknown>;

    const id = newId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `
    INSERT INTO inventory_items (
      id, workspace_id, name, sku, description, category,
      quantity, min_quantity, unit_cost, unit_price,
      supplier, location, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `,
    )
      .bind(
        id,
        workspaceId,
        (body.name as string).trim(),
        body.sku ?? null,
        body.description ?? '',
        body.category ?? 'general',
        body.quantity ?? 0,
        body.minQuantity ?? 0,
        body.unitCost ?? 0,
        body.unitPrice ?? 0,
        body.supplier ?? '',
        body.location ?? '',
        now,
        now,
      )
      .run();

    // Log activity
    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'inventory_item', ?, 'created', ?)
    `,
    )
      .bind(newId(), workspaceId, user.id, id, now)
      .run();

    const item = await env.DB.prepare(
      'SELECT * FROM inventory_items WHERE id = ?',
    )
      .bind(id)
      .first<Record<string, unknown>>();

    return entity(WIRE_INVENTORY_ITEM, item, {}, 201);
  },
);

// PATCH /api/inventory/:id — Update item
inventoryRouter.patch(
  '/:id',
  validate(UpdateInventoryItemSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const itemId = req.params!['id'];

    const existing = await env.DB.prepare(
      'SELECT id FROM inventory_items WHERE id = ? AND workspace_id = ?',
    )
      .bind(itemId, workspaceId)
      .first();

    if (!existing) return notFound('Inventory item');

    const body = (req as any).validatedBody as Record<string, unknown>;
    const now = new Date().toISOString();

    const allowed = [
      'name',
      'sku',
      'description',
      'category',
      'quantity',
      'min_quantity',
      'unit_cost',
      'unit_price',
      'supplier',
      'location',
    ];

    const camelToSnake: Record<string, string> = {
      minQuantity: 'min_quantity',
      unitCost: 'unit_cost',
      unitPrice: 'unit_price',
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

    vals.push(itemId, workspaceId);

    await env.DB.prepare(
      `UPDATE inventory_items SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
    )
      .bind(...vals)
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'inventory_item', ?, 'updated', ?)
    `,
    )
      .bind(newId(), workspaceId, user.id, itemId, now)
      .run();

    const updated = await env.DB.prepare(
      'SELECT * FROM inventory_items WHERE id = ?',
    )
      .bind(itemId)
      .first<Record<string, unknown>>();

    return entity(WIRE_INVENTORY_ITEM, updated);
  },
);

// DELETE /api/inventory/:id — Delete item
inventoryRouter.delete('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
  const user = (req as unknown as { user: { id: string } }).user;
  const itemId = req.params!['id'];

  const existing = await env.DB.prepare(
    'SELECT id FROM inventory_items WHERE id = ? AND workspace_id = ?',
  )
    .bind(itemId, workspaceId)
    .first();

  if (!existing) return notFound('Inventory item');

  await env.DB.prepare(
    'DELETE FROM inventory_items WHERE id = ? AND workspace_id = ?',
  )
    .bind(itemId, workspaceId)
    .run();

  await env.DB.prepare(
    `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
    VALUES (?, ?, ?, 'inventory_item', ?, 'deleted', ?)
    `,
  )
    .bind(newId(), workspaceId, user.id, itemId, new Date().toISOString())
    .run();

  return json({ data: { deleted: true } });
});

// POST /api/inventory/:id/transaction — Record usage/purchase/adjustment/return
inventoryRouter.post(
  '/:id/transaction',
  validate(AdjustInventorySchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as unknown as { workspaceId: string }).workspaceId;
    const user = (req as unknown as { user: { id: string } }).user;
    const itemId = req.params!['id'];

    const item = await env.DB.prepare(
      'SELECT * FROM inventory_items WHERE id = ? AND workspace_id = ?',
    )
      .bind(itemId, workspaceId)
      .first<Record<string, unknown>>();

    if (!item) return notFound('Inventory item');

    const body = (req as any).validatedBody as Record<string, unknown>;

    const txType = body.type as string;
    const txQuantity = body.quantity as number;

    // Calculate quantity change: purchase/return add, usage subtracts, adjustment is absolute delta
    let quantityDelta: number;
    if (txType === 'usage') {
      quantityDelta = -Math.abs(txQuantity);
    } else if (txType === 'purchase' || txType === 'return') {
      quantityDelta = Math.abs(txQuantity);
    } else {
      // adjustment: signed value
      quantityDelta = txQuantity;
    }

    const currentQuantity = item['quantity'] as number;
    const newQuantity = currentQuantity + quantityDelta;

    if (newQuantity < 0) {
      return error('Insufficient stock', 400, 'INSUFFICIENT_STOCK');
    }

    const txId = newId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `
    INSERT INTO inventory_transactions (
      id, workspace_id, item_id, job_id, type, quantity, notes, created_at, created_by
    ) VALUES (?,?,?,?,?,?,?,?,?)
    `,
    )
      .bind(
        txId,
        workspaceId,
        itemId,
        body.jobId ?? null,
        txType,
        txQuantity,
        body.notes ?? '',
        now,
        user.id,
      )
      .run();

    // Update item quantity
    await env.DB.prepare(
      `UPDATE inventory_items SET quantity = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(newQuantity, now, itemId)
      .run();

    await env.DB.prepare(
      `
    INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
    VALUES (?, ?, ?, 'inventory_item', ?, 'transaction', ?, ?)
    `,
    )
      .bind(
        newId(),
        workspaceId,
        user.id,
        itemId,
        JSON.stringify({
          transactionId: txId,
          type: txType,
          quantity: txQuantity,
        }),
        now,
      )
      .run();

    return json({ data: { transactionId: txId, newQuantity } }, 201);
  },
);
