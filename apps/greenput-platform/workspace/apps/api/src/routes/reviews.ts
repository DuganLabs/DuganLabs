import { IRequest, Router } from 'itty-router';
import type { Env } from '../env';
import { json, error, notFound, newId, paginate } from '../lib/response';
import { entity, entityList } from '../lib/serialize';
import { WIRE_REVIEW, WIRE_REVIEW_REQUEST } from '@greenput/shared/models';
import { validate } from '../middleware/validate';
import {
  CreateReviewSchema,
  UpdateReviewSchema,
  CreateReviewRequestSchema,
} from '@greenput/shared/validators';

export const reviewsRouter = Router({ base: '/api/reviews' });

// GET /api/reviews/stats — must be before /:id to avoid matching "stats" as id
reviewsRouter.get('/stats', async (req: IRequest, env: Env) => {
  const workspaceId = (req as Record<string, unknown>).workspaceId as string;

  const [avgRow, countByPlatform, distribution, totalRow] = await Promise.all([
    env.DB.prepare(
      'SELECT AVG(rating) AS average_rating FROM reviews WHERE workspace_id = ?',
    )
      .bind(workspaceId)
      .first<{ average_rating: number | null }>(),
    env.DB.prepare(
      'SELECT platform, COUNT(*) AS count FROM reviews WHERE workspace_id = ? GROUP BY platform ORDER BY count DESC',
    )
      .bind(workspaceId)
      .all(),
    env.DB.prepare(
      'SELECT rating, COUNT(*) AS count FROM reviews WHERE workspace_id = ? GROUP BY rating ORDER BY rating DESC',
    )
      .bind(workspaceId)
      .all(),
    env.DB.prepare(
      'SELECT COUNT(*) AS total FROM reviews WHERE workspace_id = ?',
    )
      .bind(workspaceId)
      .first<{ total: number }>(),
  ]);

  return json({
    data: {
      averageRating: avgRow?.average_rating
        ? Math.round(avgRow.average_rating * 100) / 100
        : null,
      totalReviews: totalRow?.total ?? 0,
      byPlatform: countByPlatform.results,
      ratingDistribution: distribution.results,
    },
  });
});

// GET /api/reviews/requests
reviewsRouter.get('/requests', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as Record<string, unknown>).workspaceId as string;

  const status = url.searchParams.get('status');

  let where = 'WHERE rr.workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (status) {
    where += ' AND rr.status = ?';
    params.push(status);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `
      SELECT rr.*,
             c.first_name AS customer_first_name,
             c.last_name AS customer_last_name,
             j.title AS job_title
      FROM review_requests rr
      LEFT JOIN customers c ON rr.customer_id = c.id
      LEFT JOIN jobs j ON rr.job_id = j.id
      ${where}
      ORDER BY rr.created_at DESC
      LIMIT ? OFFSET ?
    `,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM review_requests rr ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_REVIEW_REQUEST, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// GET /api/reviews
reviewsRouter.get('/', async (req: IRequest, env: Env) => {
  const url = new URL(req.url);
  const { limit, offset, page } = paginate(url);
  const workspaceId = (req as Record<string, unknown>).workspaceId as string;

  const platform = url.searchParams.get('platform');
  const rating = url.searchParams.get('rating');
  const q = url.searchParams.get('q');

  let where = 'WHERE r.workspace_id = ?';
  const params: unknown[] = [workspaceId];

  if (platform) {
    where += ' AND r.platform = ?';
    params.push(platform);
  }
  if (rating) {
    where += ' AND r.rating = ?';
    params.push(parseInt(rating, 10));
  }
  if (q) {
    where += ' AND (r.content LIKE ? OR r.author_name LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like);
  }

  const [rows, countRow] = await Promise.all([
    env.DB.prepare(
      `
      SELECT r.*,
             c.first_name AS customer_first_name,
             c.last_name AS customer_last_name
      FROM reviews r
      LEFT JOIN customers c ON r.customer_id = c.id
      ${where}
      ORDER BY r.created_at DESC
      LIMIT ? OFFSET ?
    `,
    )
      .bind(...params, limit, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM reviews r ${where}`)
      .bind(...params)
      .first<{ total: number }>(),
  ]);

  return entityList(WIRE_REVIEW, rows.results, {
    total: countRow?.total ?? 0,
    page,
    perPage: limit,
  });
});

// GET /api/reviews/:id
reviewsRouter.get('/:id', async (req: IRequest, env: Env) => {
  const workspaceId = (req as Record<string, unknown>).workspaceId as string;

  const review = await env.DB.prepare(
    `
    SELECT r.*,
           c.first_name AS customer_first_name,
           c.last_name AS customer_last_name
    FROM reviews r
    LEFT JOIN customers c ON r.customer_id = c.id
    WHERE r.id = ? AND r.workspace_id = ?
  `,
  )
    .bind(req.params!['id'], workspaceId)
    .first<Record<string, unknown>>();

  if (!review) return notFound('Review');
  return entity(WIRE_REVIEW, review);
});

// POST /api/reviews
reviewsRouter.post(
  '/',
  validate(CreateReviewSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as Record<string, unknown>).workspaceId as string;
    const user = (req as Record<string, unknown>).user as { id: string };
    const body = (req as Record<string, unknown>).validatedBody as Record<
      string,
      unknown
    >;

    const id = newId();
    const now = new Date().toISOString();

    await env.DB.prepare(
      `
      INSERT INTO reviews (
        id, workspace_id, customer_id, job_id, platform,
        rating, content, author_name, review_url, created_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `,
    )
      .bind(
        id,
        workspaceId,
        body.customerId ?? null,
        body.jobId ?? null,
        body.platform ?? 'internal',
        body.rating,
        body.content ?? '',
        body.authorName,
        body.reviewUrl ?? null,
        now,
      )
      .run();

    // Log activity
    await env.DB.prepare(
      `
      INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
      VALUES (?, ?, ?, 'review', ?, 'created', ?)
    `,
    )
      .bind(newId(), workspaceId, user.id, id, now)
      .run();

    const review = await env.DB.prepare('SELECT * FROM reviews WHERE id = ?')
      .bind(id)
      .first<Record<string, unknown>>();

    return entity(WIRE_REVIEW, review, {}, 201);
  },
);

// PATCH /api/reviews/:id
reviewsRouter.patch(
  '/:id',
  validate(UpdateReviewSchema),
  async (req: IRequest, env: Env) => {
    const workspaceId = (req as Record<string, unknown>).workspaceId as string;
    const user = (req as Record<string, unknown>).user as { id: string };
    const reviewId = req.params!['id'];

    const existing = await env.DB.prepare(
      'SELECT id FROM reviews WHERE id = ? AND workspace_id = ?',
    )
      .bind(reviewId, workspaceId)
      .first();

    if (!existing) return notFound('Review');

    const body = (req as Record<string, unknown>).validatedBody as Record<
      string,
      unknown
    >;

    const camelToSnake: Record<string, string> = {
      authorName: 'author_name',
      reviewUrl: 'review_url',
      responseText: 'response_text',
    };

    const allowed = [
      'rating',
      'content',
      'author_name',
      'platform',
      'review_url',
      'responded',
      'response_text',
    ];

    const sets: string[] = [];
    const vals: unknown[] = [];

    for (const [key, val] of Object.entries(body)) {
      const col = camelToSnake[key] ?? key;
      if (allowed.includes(col)) {
        if (col === 'responded') {
          // Convert boolean to integer for SQLite
          sets.push(`${col} = ?`);
          vals.push(val ? 1 : 0);
        } else {
          sets.push(`${col} = ?`);
          vals.push(val);
        }
      }
    }

    if (sets.length === 0) {
      return error('No valid fields to update', 400, 'VALIDATION_ERROR');
    }

    vals.push(reviewId, workspaceId);

    await env.DB.prepare(
      `UPDATE reviews SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`,
    )
      .bind(...vals)
      .run();

    const now = new Date().toISOString();

    // Log activity
    await env.DB.prepare(
      `
      INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, created_at)
      VALUES (?, ?, ?, 'review', ?, 'updated', ?)
    `,
    )
      .bind(newId(), workspaceId, user.id, reviewId, now)
      .run();

    const updated = await env.DB.prepare('SELECT * FROM reviews WHERE id = ?')
      .bind(reviewId)
      .first<Record<string, unknown>>();

    return entity(WIRE_REVIEW, updated);
  },
);

// POST /api/reviews/requests — record a review request. Greenput sends
// nothing (GP-008: links, not sending — no provider). The row is written
// `pending` with no `sent_at`, and the contractor copies the message from the
// job row on /jobs and sends it themselves. `sent` is never written here: a
// status that says sent must mean sent (GP-047).
//
// Served on `/requests` (the documented path, and the GET's) and kept on the
// singular `/request` the handler was first registered under.
const createReviewRequest = async (req: IRequest, env: Env) => {
  const workspaceId = (req as Record<string, unknown>).workspaceId as string;
  const user = (req as Record<string, unknown>).user as { id: string };
  const body = (req as Record<string, unknown>).validatedBody as Record<
    string,
    unknown
  >;

  // Verify customer belongs to workspace
  const customer = await env.DB.prepare(
    'SELECT id, email, phone FROM customers WHERE id = ? AND workspace_id = ?',
  )
    .bind(body.customerId, workspaceId)
    .first();

  if (!customer) return notFound('Customer');

  // Verify job belongs to workspace
  const job = await env.DB.prepare(
    'SELECT id, status FROM jobs WHERE id = ? AND workspace_id = ?',
  )
    .bind(body.jobId, workspaceId)
    .first();

  if (!job) return notFound('Job');

  const id = newId();
  const now = new Date().toISOString();

  await env.DB.prepare(
    `
      INSERT INTO review_requests (
        id, workspace_id, customer_id, job_id, channel, status, sent_at, created_at
      ) VALUES (?,?,?,?,?,?,?,?)
    `,
  )
    .bind(
      id,
      workspaceId,
      body.customerId,
      body.jobId,
      body.channel,
      'pending',
      null,
      now,
    )
    .run();

  // Log activity
  await env.DB.prepare(
    `
      INSERT INTO activity_log (id, workspace_id, user_id, entity_type, entity_id, action, meta, created_at)
      VALUES (?, ?, ?, 'review', ?, 'request_created', ?, ?)
    `,
  )
    .bind(
      newId(),
      workspaceId,
      user.id,
      id,
      JSON.stringify({ channel: body.channel, customerId: body.customerId }),
      now,
    )
    .run();

  const request = await env.DB.prepare(
    'SELECT * FROM review_requests WHERE id = ?',
  )
    .bind(id)
    .first<Record<string, unknown>>();

  return entity(WIRE_REVIEW_REQUEST, request, {}, 201);
};

reviewsRouter.post(
  '/requests',
  validate(CreateReviewRequestSchema),
  createReviewRequest,
);
reviewsRouter.post(
  '/request',
  validate(CreateReviewRequestSchema),
  createReviewRequest,
);
