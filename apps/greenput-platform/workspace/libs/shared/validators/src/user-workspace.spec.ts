import { describe, it, expect } from 'vitest';
import {
  CreateUserWorkspaceSchema,
  SwitchWorkspaceSchema,
} from './user-workspace';

const validUuid = '550e8400-e29b-41d4-a716-446655440001';

describe('CreateUserWorkspaceSchema', () => {
  it('accepts minimal valid input (name only)', () => {
    const result = CreateUserWorkspaceSchema.safeParse({
      name: 'Smith Electric',
    });
    expect(result.success).toBe(true);
  });

  it('accepts full valid input', () => {
    const result = CreateUserWorkspaceSchema.safeParse({
      name: 'Smith Electric',
      trade: 'electrician',
      phone: '555-555-1234',
      email: 'info@smith-electric.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty name', () => {
    const result = CreateUserWorkspaceSchema.safeParse({ name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects missing name', () => {
    const result = CreateUserWorkspaceSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = CreateUserWorkspaceSchema.safeParse({
      name: 'Smith Electric',
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('trims name whitespace', () => {
    const result = CreateUserWorkspaceSchema.safeParse({
      name: '  Smith Electric  ',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Smith Electric');
  });

  it('trade is optional', () => {
    const result = CreateUserWorkspaceSchema.safeParse({ name: 'Test Co' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.trade).toBeUndefined();
  });

  it('phone is optional', () => {
    const result = CreateUserWorkspaceSchema.safeParse({ name: 'Test Co' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.phone).toBeUndefined();
  });

  it('accepts name at max length (255 chars)', () => {
    const result = CreateUserWorkspaceSchema.safeParse({
      name: 'A'.repeat(255),
    });
    expect(result.success).toBe(true);
  });

  it('rejects name exceeding max length (256 chars)', () => {
    const result = CreateUserWorkspaceSchema.safeParse({
      name: 'A'.repeat(256),
    });
    expect(result.success).toBe(false);
  });
});

describe('SwitchWorkspaceSchema', () => {
  it('accepts valid UUID v4', () => {
    const result = SwitchWorkspaceSchema.safeParse({ workspaceId: validUuid });
    expect(result.success).toBe(true);
  });

  it('rejects missing workspaceId', () => {
    const result = SwitchWorkspaceSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects non-UUID workspaceId', () => {
    const result = SwitchWorkspaceSchema.safeParse({
      workspaceId: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty string workspaceId', () => {
    const result = SwitchWorkspaceSchema.safeParse({ workspaceId: '' });
    expect(result.success).toBe(false);
  });

  it('rejects numeric workspaceId', () => {
    const result = SwitchWorkspaceSchema.safeParse({ workspaceId: 12345 });
    expect(result.success).toBe(false);
  });
});
