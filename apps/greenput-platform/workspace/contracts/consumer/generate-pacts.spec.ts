import { describe, it, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { handlers } from '../../mocks/handlers';

const server = setupServer(...handlers);

describe('Pact Consumer Contract Generation', () => {
  beforeAll(() => {
    server.listen({ onUnhandledRequest: 'error' });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  // ── Auth ──────────────────────────────────────────────────────
  it('should record POST /api/auth/login interaction', async () => {
    const res = await fetch('http://localhost:8787/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'password' }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.user).toBeTruthy();
  });

  // ── Dashboard ─────────────────────────────────────────────────
  it('should record GET /api/dashboard/stats interaction', async () => {
    const res = await fetch('http://localhost:8787/api/dashboard/stats');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeTruthy();
  });

  // ── Leads ─────────────────────────────────────────────────────
  it('should record GET /api/leads interaction', async () => {
    const res = await fetch('http://localhost:8787/api/leads');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  it('should record POST /api/leads interaction', async () => {
    const res = await fetch('http://localhost:8787/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane@example.com',
        phone: '555-0100',
        serviceType: 'HVAC',
        source: 'website',
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.id).toBeTruthy();
  });

  // ── Opportunities ─────────────────────────────────────────────
  it('should record GET /api/opportunities interaction', async () => {
    const res = await fetch('http://localhost:8787/api/opportunities');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  // ── Jobs ──────────────────────────────────────────────────────
  it('should record GET /api/jobs interaction', async () => {
    const res = await fetch('http://localhost:8787/api/jobs');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  // ── Customers ─────────────────────────────────────────────────
  it('should record GET /api/customers interaction', async () => {
    const res = await fetch('http://localhost:8787/api/customers');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  // ── Campaigns ─────────────────────────────────────────────────
  it('should record GET /api/campaigns interaction', async () => {
    const res = await fetch('http://localhost:8787/api/campaigns');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  // ── Estimates ─────────────────────────────────────────────────
  it('should record GET /api/estimates interaction', async () => {
    const res = await fetch('http://localhost:8787/api/estimates');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  // ── Reviews ───────────────────────────────────────────────────
  it('should record GET /api/reviews interaction', async () => {
    const res = await fetch('http://localhost:8787/api/reviews');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  it('should record GET /api/reviews/stats interaction', async () => {
    const res = await fetch('http://localhost:8787/api/reviews/stats');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeTruthy();
  });

  it('should record GET /api/reviews/requests interaction', async () => {
    const res = await fetch('http://localhost:8787/api/reviews/requests');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  // ── Inventory ─────────────────────────────────────────────────
  it('should record GET /api/inventory interaction', async () => {
    const res = await fetch('http://localhost:8787/api/inventory');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  it('should record POST /api/inventory interaction', async () => {
    const res = await fetch('http://localhost:8787/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '14 AWG Wire',
        category: 'electrical',
        quantity: 100,
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.id).toBeTruthy();
  });

  // ── Vehicles ──────────────────────────────────────────────────
  it('should record GET /api/vehicles interaction', async () => {
    const res = await fetch('http://localhost:8787/api/vehicles');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  it('should record POST /api/vehicles interaction', async () => {
    const res = await fetch('http://localhost:8787/api/vehicles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Service Van 1',
        make: 'Ford',
        model: 'Transit',
        year: 2023,
      }),
    });
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.id).toBeTruthy();
  });

  // ── Plugins ───────────────────────────────────────────────────
  it('should record GET /api/plugins interaction', async () => {
    const res = await fetch('http://localhost:8787/api/plugins');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  it('should record GET /api/plugins/installed interaction', async () => {
    const res = await fetch('http://localhost:8787/api/plugins/installed');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  // ── Activity ──────────────────────────────────────────────────
  it('should record GET /api/audit interaction', async () => {
    const res = await fetch('http://localhost:8787/api/audit');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  // ── Webhooks ──────────────────────────────────────────────────
  it('should record GET /api/webhooks interaction', async () => {
    const res = await fetch('http://localhost:8787/api/webhooks');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  // ── Reports ───────────────────────────────────────────────────
  it('should record GET /api/reports/revenue interaction', async () => {
    const res = await fetch(
      'http://localhost:8787/api/reports/revenue?from=2025-04-01&to=2026-04-01&period=month',
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeTruthy();
  });

  it('should record GET /api/reports/pipeline interaction', async () => {
    const res = await fetch(
      'http://localhost:8787/api/reports/pipeline?from=2025-04-01&to=2026-04-01',
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeTruthy();
  });

  // ── Branding ──────────────────────────────────────────────────
  it('should record GET /api/branding interaction', async () => {
    const res = await fetch('http://localhost:8787/api/branding');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeTruthy();
  });

  // ── API Keys ──────────────────────────────────────────────────
  it('should record GET /api/api-keys interaction', async () => {
    const res = await fetch('http://localhost:8787/api/api-keys');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  // ── Workspace ─────────────────────────────────────────────────
  it('should record GET /api/workspace interaction', async () => {
    const res = await fetch('http://localhost:8787/api/workspace');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeTruthy();
  });

  // ── Notification Preferences ──────────────────────────────────
  it('should record GET /api/notification-preferences interaction', async () => {
    const res = await fetch(
      'http://localhost:8787/api/notification-preferences',
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  // ── Chat ──────────────────────────────────────────────────────
  it('should record GET /api/chat/rooms interaction', async () => {
    const res = await fetch('http://localhost:8787/api/chat/rooms');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeInstanceOf(Array);
  });

  // ── Billing ───────────────────────────────────────────────────
  it('should record GET /api/billing interaction', async () => {
    const res = await fetch('http://localhost:8787/api/billing');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeTruthy();
  });

  // ── Campaign Report ────────────────────────────────────────────
  it('should record GET /api/reports/campaigns interaction', async () => {
    const res = await fetch(
      'http://localhost:8787/api/reports/campaigns?from=2025-04-01&to=2026-04-01',
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeTruthy();
  });

  // ── Technician Report ──────────────────────────────────────────
  it('should record GET /api/reports/technicians interaction', async () => {
    const res = await fetch(
      'http://localhost:8787/api/reports/technicians?from=2025-04-01&to=2026-04-01',
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toBeTruthy();
  });
});
