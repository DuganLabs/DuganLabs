import { describe, it, expect } from 'vitest';
import { CreateApiKeySchema, UpdateApiKeySchema } from './api-key';

describe('CreateApiKeySchema', () => {
  it('accepts minimal valid input', () => {
    const result = CreateApiKeySchema.safeParse({ name: 'My Key' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scopes).toEqual(['read']);
    }
  });

  it('accepts full valid input', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    const result = CreateApiKeySchema.safeParse({
      name: 'My Key',
      scopes: ['read', 'leads'],
      expiresAt: future,
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = CreateApiKeySchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects name longer than 100 characters', () => {
    const result = CreateApiKeySchema.safeParse({ name: 'a'.repeat(101) });
    expect(result.success).toBe(false);
  });

  it('rejects invalid scope', () => {
    const result = CreateApiKeySchema.safeParse({
      name: 'Key',
      scopes: ['read', 'invalid_scope'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects expiresAt in the past', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const result = CreateApiKeySchema.safeParse({
      name: 'Key',
      expiresAt: past,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-datetime expiresAt', () => {
    const result = CreateApiKeySchema.safeParse({
      name: 'Key',
      expiresAt: 'not-a-date',
    });
    expect(result.success).toBe(false);
  });

  it('trims name whitespace', () => {
    const result = CreateApiKeySchema.safeParse({ name: '  My Key  ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('My Key');
    }
  });

  it('accepts all valid scopes', () => {
    const scopes = [
      'read',
      'write',
      'leads',
      'jobs',
      'customers',
      'campaigns',
    ] as const;
    const result = CreateApiKeySchema.safeParse({
      name: 'All Scopes',
      scopes: [...scopes],
    });
    expect(result.success).toBe(true);
  });

  it('accepts name at max length (100 chars)', () => {
    const result = CreateApiKeySchema.safeParse({ name: 'a'.repeat(100) });
    expect(result.success).toBe(true);
  });

  it('accepts missing scopes (defaults to read)', () => {
    const result = CreateApiKeySchema.safeParse({ name: 'Key' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.scopes).toEqual(['read']);
  });
});

describe('UpdateApiKeySchema', () => {
  it('accepts name-only update', () => {
    const result = UpdateApiKeySchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('accepts scopes-only update', () => {
    const result = UpdateApiKeySchema.safeParse({ scopes: ['write', 'jobs'] });
    expect(result.success).toBe(true);
  });

  it('rejects empty object', () => {
    const result = UpdateApiKeySchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects empty scopes array', () => {
    const result = UpdateApiKeySchema.safeParse({ scopes: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid scope in update', () => {
    const result = UpdateApiKeySchema.safeParse({ scopes: ['admin'] });
    expect(result.success).toBe(false);
  });

  it('accepts all valid scopes in update', () => {
    const scopes = [
      'read',
      'write',
      'leads',
      'jobs',
      'customers',
      'campaigns',
    ] as const;
    for (const scope of scopes) {
      expect(UpdateApiKeySchema.safeParse({ scopes: [scope] }).success).toBe(
        true,
      );
    }
  });
});
