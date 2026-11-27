import { describe, it, expect } from 'vitest';
import { health } from '../src/routes/health.js';

describe('GET /api/health', () => {
  it('responds 200 with JSON body', async () => {
    const res = health();
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
  });

  it('reports ok=true and the service name', async () => {
    const body = (await health().json()) as { ok: boolean; service: string; timestamp: number };
    expect(body.ok).toBe(true);
    expect(body.service).toBe('pending-business');
  });

  it('includes a recent timestamp', async () => {
    const before = Date.now();
    const body = (await health().json()) as { timestamp: number };
    const after = Date.now();
    expect(body.timestamp).toBeGreaterThanOrEqual(before);
    expect(body.timestamp).toBeLessThanOrEqual(after);
  });
});
