import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { createSqliteD1, type SqliteD1 } from '@greenput/shared/testing';
import { reviewsRouter } from './reviews';

describe('reviewsRouter', () => {
  it('exports reviewsRouter', async () => {
    const mod = await import('./reviews');
    expect(mod.reviewsRouter).toBeDefined();
    expect(typeof mod.reviewsRouter.fetch).toBe('function');
  });
});

describe('review validation', () => {
  describe('CreateReviewSchema', () => {
    it('rejects empty body', async () => {
      const { CreateReviewSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('accepts valid review with required fields', async () => {
      const { CreateReviewSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewSchema.safeParse({
        rating: 5,
        authorName: 'John Smith',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.platform).toBe('internal');
        expect(result.data.content).toBe('');
      }
    });

    it('accepts all valid platforms', async () => {
      const { CreateReviewSchema } =
        await import('@greenput/shared/validators');
      const platforms = ['internal', 'google', 'yelp', 'nextdoor', 'facebook'];
      for (const platform of platforms) {
        const result = CreateReviewSchema.safeParse({
          rating: 4,
          authorName: 'Jane Doe',
          platform,
        });
        expect(result.success).toBe(true);
      }
    });

    it('rejects invalid platform', async () => {
      const { CreateReviewSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewSchema.safeParse({
        rating: 3,
        authorName: 'Test',
        platform: 'twitter',
      });
      expect(result.success).toBe(false);
    });

    it('rejects rating below 1', async () => {
      const { CreateReviewSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewSchema.safeParse({
        rating: 0,
        authorName: 'Test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects rating above 5', async () => {
      const { CreateReviewSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewSchema.safeParse({
        rating: 6,
        authorName: 'Test',
      });
      expect(result.success).toBe(false);
    });

    it('rejects non-integer rating', async () => {
      const { CreateReviewSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewSchema.safeParse({
        rating: 3.5,
        authorName: 'Test',
      });
      expect(result.success).toBe(false);
    });

    it('accepts review with all optional fields', async () => {
      const { CreateReviewSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewSchema.safeParse({
        rating: 5,
        authorName: 'John Smith',
        content: 'Excellent work on the electrical panel upgrade!',
        platform: 'google',
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        jobId: '550e8400-e29b-41d4-a716-446655440001',
        reviewUrl: 'https://google.com/reviews/abc',
      });
      expect(result.success).toBe(true);
    });

    it('accepts nullable customerId', async () => {
      const { CreateReviewSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewSchema.safeParse({
        rating: 4,
        authorName: 'Test',
        customerId: null,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('UpdateReviewSchema', () => {
    it('rejects empty body', async () => {
      const { UpdateReviewSchema } =
        await import('@greenput/shared/validators');
      const result = UpdateReviewSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('accepts partial update with response', async () => {
      const { UpdateReviewSchema } =
        await import('@greenput/shared/validators');
      const result = UpdateReviewSchema.safeParse({
        responded: true,
        responseText: 'Thank you for your feedback!',
      });
      expect(result.success).toBe(true);
    });

    it('accepts rating update', async () => {
      const { UpdateReviewSchema } =
        await import('@greenput/shared/validators');
      const result = UpdateReviewSchema.safeParse({ rating: 4 });
      expect(result.success).toBe(true);
    });

    it('accepts nullable responseText', async () => {
      const { UpdateReviewSchema } =
        await import('@greenput/shared/validators');
      const result = UpdateReviewSchema.safeParse({
        responseText: null,
        responded: false,
      });
      expect(result.success).toBe(true);
    });
  });

  describe('CreateReviewRequestSchema', () => {
    it('rejects empty body', async () => {
      const { CreateReviewRequestSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('requires customerId, jobId, and channel', async () => {
      const { CreateReviewRequestSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewRequestSchema.safeParse({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        jobId: '550e8400-e29b-41d4-a716-446655440001',
        channel: 'email',
      });
      expect(result.success).toBe(true);
    });

    it('accepts sms channel', async () => {
      const { CreateReviewRequestSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewRequestSchema.safeParse({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        jobId: '550e8400-e29b-41d4-a716-446655440001',
        channel: 'sms',
      });
      expect(result.success).toBe(true);
    });

    it('rejects invalid channel', async () => {
      const { CreateReviewRequestSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewRequestSchema.safeParse({
        customerId: '550e8400-e29b-41d4-a716-446655440000',
        jobId: '550e8400-e29b-41d4-a716-446655440001',
        channel: 'push',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid UUID for customerId', async () => {
      const { CreateReviewRequestSchema } =
        await import('@greenput/shared/validators');
      const result = CreateReviewRequestSchema.safeParse({
        customerId: 'not-a-uuid',
        jobId: '550e8400-e29b-41d4-a716-446655440001',
        channel: 'email',
      });
      expect(result.success).toBe(false);
    });
  });
});

describe('reviews query parameters', () => {
  it('supports platform filter', () => {
    const url = new URL('https://api.greenput.com/api/reviews?platform=google');
    expect(url.searchParams.get('platform')).toBe('google');
  });

  it('supports rating filter', () => {
    const url = new URL('https://api.greenput.com/api/reviews?rating=5');
    expect(url.searchParams.get('rating')).toBe('5');
  });

  it('supports search query', () => {
    const url = new URL(
      'https://api.greenput.com/api/reviews?q=excellent+work',
    );
    expect(url.searchParams.get('q')).toBe('excellent work');
  });

  it('supports pagination', () => {
    const url = new URL(
      'https://api.greenput.com/api/reviews?page=2&perPage=10',
    );
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('perPage')).toBe('10');
  });
});

// ── The request handler, over the real schema ──────────────────────────
//
// GP-047 / GP-008. The handler used to write `status = 'sent'` next to a
// message nobody received. Greenput sends nothing — the contractor copies
// the message on /jobs — so the row is recorded `pending` with no `sent_at`,
// and a mocked env.DB could not show either (CLAUDE.md 10.0, rule 1).
describe('POST /api/reviews/requests over schema.sql (GP-047)', () => {
  const ROOT = resolve(__dirname, '../../../..');
  const WS = '00000000-0000-4000-8000-0000000000d1';
  const USER = '00000000-0000-4000-8000-0000000000d2';
  const CUST = '00000000-0000-4000-8000-0000000000d3';
  const JOB = '00000000-0000-4000-8000-0000000000d4';
  const OTHER_WS = '00000000-0000-4000-8000-0000000000e1';
  const OTHER_USER = '00000000-0000-4000-8000-0000000000e2';
  const OTHER_CUST = '00000000-0000-4000-8000-0000000000e3';

  const SEED = `
INSERT INTO workspaces (id, name, slug, created_at)
VALUES ('${WS}', 'Rivertown Electric', 'rivertown', '2026-01-01T00:00:00.000Z'),
       ('${OTHER_WS}', 'Someone Else', 'someone-else', '2026-01-01T00:00:00.000Z');

INSERT INTO users (id, workspace_id, first_name, last_name, email, role, password_hash, created_at, updated_at)
VALUES ('${USER}', '${WS}', 'Dana', 'Ortiz', 'dana@rivertown.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
       ('${OTHER_USER}', '${OTHER_WS}', 'Pat', 'Other', 'pat@other.example', 'owner', '',
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

INSERT INTO customers (id, workspace_id, first_name, last_name, email, phone, preferred_contact,
                       created_at, updated_at, created_by)
VALUES ('${CUST}', '${WS}', 'Jane', 'Doe', 'jane@example.com', '5125550143', 'phone',
        '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z', '${USER}'),
       ('${OTHER_CUST}', '${OTHER_WS}', 'Sam', 'Reed', 'sam@example.com', '5125550199', 'email',
        '2026-04-03T00:00:00.000Z', '2026-04-03T00:00:00.000Z', '${OTHER_USER}');

INSERT INTO leads (id, workspace_id, first_name, last_name, email, phone, preferred_contact,
                   status, source, service_type, notes, created_at, updated_at, created_by)
VALUES ('lead-1', '${WS}', 'Jane', 'Doe', 'jane@example.com', '5125550143', 'phone',
        'converted', 'website', 'Panel Upgrade', '',
        '2026-04-01T00:00:00.000Z', '2026-04-02T00:00:00.000Z', '${USER}');

INSERT INTO opportunities (id, workspace_id, lead_id, customer_id, title, status, value, service_type,
                           notes, created_at, updated_at, created_by)
VALUES ('opp-1', '${WS}', 'lead-1', '${CUST}', '200A Panel Upgrade', 'won', 265213, 'Panel Upgrade',
        '', '2026-04-05T00:00:00.000Z', '2026-04-05T00:00:00.000Z', '${USER}');

INSERT INTO jobs (id, workspace_id, opportunity_id, customer_id, job_number, title, status,
                  scheduled_start, scheduled_end, total, notes, created_at, updated_at, created_by)
VALUES ('${JOB}', '${WS}', 'opp-1', '${CUST}', '#1001', 'Panel upgrade', 'paid',
        '2026-04-07T09:00:00.000Z', '2026-04-07T11:00:00.000Z', 265213, '',
        '2026-04-07T00:00:00.000Z', '2026-04-07T00:00:00.000Z', '${USER}');
`;

  let sqlite: SqliteD1;

  beforeEach(() => {
    sqlite = createSqliteD1({
      files: [resolve(ROOT, 'schema.sql')],
      sql: [SEED],
    });
  });

  afterEach(() => {
    sqlite.close();
  });

  async function post(path: string, body: unknown): Promise<Response> {
    const req = new Request(`https://api.greenput.com${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const mutable = req as unknown as Record<string, unknown>;
    mutable['workspaceId'] = WS;
    mutable['user'] = { id: USER, role: 'owner' };
    return reviewsRouter.fetch(req, { DB: sqlite.db });
  }

  it('records the request as pending with no sent_at — nothing was sent', async () => {
    const res = await post('/api/reviews/requests', {
      customerId: CUST,
      jobId: JOB,
      channel: 'sms',
    });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: Record<string, unknown> };
    expect(data['status']).toBe('pending');
    expect(data['sentAt']).toBeUndefined();
    expect(data['customerId']).toBe(CUST);
    expect(data['jobId']).toBe(JOB);

    const rows = sqlite.rows<Record<string, unknown>>('review_requests');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workspace_id: WS,
      customer_id: CUST,
      job_id: JOB,
      channel: 'sms',
      status: 'pending',
      sent_at: null,
    });

    const log = sqlite
      .rows<Record<string, unknown>>('activity_log')
      .filter((row) => row['entity_type'] === 'review');
    expect(log).toHaveLength(1);
    // Not `request_sent`: the product never sent it.
    expect(log[0]?.['action']).toBe('request_created');
    expect(log[0]?.['entity_id']).toBe(data['id']);
  });

  it('answers on the documented /requests and on the singular /request it was first registered under', async () => {
    const plural = await post('/api/reviews/requests', {
      customerId: CUST,
      jobId: JOB,
      channel: 'email',
    });
    const singular = await post('/api/reviews/request', {
      customerId: CUST,
      jobId: JOB,
      channel: 'email',
    });
    expect(plural.status).toBe(201);
    expect(singular.status).toBe(201);
    expect(sqlite.rows('review_requests')).toHaveLength(2);
  });

  it("refuses another workspace's customer and writes no row", async () => {
    const res = await post('/api/reviews/requests', {
      customerId: OTHER_CUST,
      jobId: JOB,
      channel: 'sms',
    });
    expect(res.status).toBe(404);
    expect(sqlite.rows('review_requests')).toHaveLength(0);
  });
});
