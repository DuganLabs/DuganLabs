import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { validate } from './validate';

function makeRequest(body: unknown): Record<string, unknown> {
  return {
    json: () => Promise.resolve(body),
    headers: new Headers(),
  };
}

function makeBadJsonRequest(): Record<string, unknown> {
  return {
    json: () => Promise.reject(new Error('parse error')),
    headers: new Headers(),
  };
}

const testSchema = z.object({
  name: z.string().min(1),
  age: z.number().positive(),
});

describe('validate middleware', () => {
  it('passes valid body and attaches validatedBody', async () => {
    const req = makeRequest({ name: 'Alice', age: 30 });
    const result = await validate(testSchema)(req as never);

    expect(result).toBeUndefined();
    expect(req['validatedBody']).toEqual({ name: 'Alice', age: 30 });
  });

  it('returns 400 for invalid body', async () => {
    const req = makeRequest({ name: '', age: -1 });
    const result = await validate(testSchema)(req as never);

    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(400);

    const body = await result!.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.length).toBeGreaterThan(0);
  });

  it('returns 400 for missing required fields', async () => {
    const req = makeRequest({});
    const result = await validate(testSchema)(req as never);

    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const req = makeBadJsonRequest();
    const result = await validate(testSchema)(req as never);

    expect(result).toBeInstanceOf(Response);
    expect(result!.status).toBe(400);
    const body = await result!.json();
    expect(body.error.code).toBe('INVALID_JSON');
  });

  it('includes field path in error details', async () => {
    const req = makeRequest({ name: 'ok', age: 'not-a-number' });
    const result = await validate(testSchema)(req as never);

    expect(result).toBeInstanceOf(Response);
    const body = await result!.json();
    const ageError = body.error.details.find(
      (d: { field: string }) => d.field === 'age',
    );
    expect(ageError).toBeDefined();
  });

  it('sets X-Content-Type-Options: nosniff on validation error', async () => {
    const req = makeRequest({});
    const result = await validate(testSchema)(req as never);
    expect(result!.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('sets Content-Type: application/json on validation error', async () => {
    const req = makeRequest({});
    const result = await validate(testSchema)(req as never);
    expect(result!.headers.get('Content-Type')).toContain('application/json');
  });

  it('includes error.field for first issue', async () => {
    const req = makeRequest({ name: '', age: -1 });
    const result = await validate(testSchema)(req as never);
    const body = await result!.json();
    expect(body.error.field).toBeDefined();
  });

  it('includes error.message for first issue', async () => {
    const req = makeRequest({ name: '', age: -1 });
    const result = await validate(testSchema)(req as never);
    const body = await result!.json();
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message.length).toBeGreaterThan(0);
  });

  it('handles nested schema field paths with dot notation', async () => {
    const nestedSchema = z.object({
      user: z.object({ name: z.string().min(1) }),
    });
    const req = makeRequest({ user: { name: '' } });
    const result = await validate(nestedSchema)(req as never);
    expect(result).toBeInstanceOf(Response);
    const body = await result!.json();
    const nested = body.error.details.find(
      (d: { field: string }) => d.field === 'user.name',
    );
    expect(nested).toBeDefined();
  });

  it('attaches transformed/coerced values from schema', async () => {
    const transformSchema = z.object({
      name: z.string().trim(),
    });
    const req = makeRequest({ name: '  Alice  ' });
    await validate(transformSchema)(req as never);
    const validatedBody = req['validatedBody'] as { name: string };
    expect(validatedBody.name).toBe('Alice');
  });
});
