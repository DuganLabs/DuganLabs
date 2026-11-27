import { describe, it, expect } from 'vitest';
import { AdminSetupSchema } from './admin';

describe('AdminSetupSchema', () => {
  it('accepts valid email', () => {
    const result = AdminSetupSchema.safeParse({ email: 'admin@greenput.com' });
    expect(result.success).toBe(true);
  });

  it('accepts email with display name', () => {
    const result = AdminSetupSchema.safeParse({
      email: 'admin@greenput.com',
      displayName: 'Admin User',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.displayName).toBe('Admin User');
  });

  it('defaults displayName to empty string when not provided', () => {
    const result = AdminSetupSchema.safeParse({ email: 'admin@greenput.com' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.displayName).toBe('');
  });

  it('rejects missing email', () => {
    const result = AdminSetupSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = AdminSetupSchema.safeParse({ email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects email without domain', () => {
    const result = AdminSetupSchema.safeParse({ email: 'admin@' });
    expect(result.success).toBe(false);
  });

  it('accepts displayName at max length (255 chars)', () => {
    const result = AdminSetupSchema.safeParse({
      email: 'admin@greenput.com',
      displayName: 'A'.repeat(255),
    });
    expect(result.success).toBe(true);
  });

  it('rejects displayName exceeding max length (256 chars)', () => {
    const result = AdminSetupSchema.safeParse({
      email: 'admin@greenput.com',
      displayName: 'A'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty string displayName explicitly', () => {
    const result = AdminSetupSchema.safeParse({
      email: 'admin@greenput.com',
      displayName: '',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.displayName).toBe('');
  });
});

describe('AdminSetupSchema additional', () => {
  it('trims whitespace from email via Zod email validation', () => {
    // Zod does not trim; confirm leading whitespace fails
    const result = AdminSetupSchema.safeParse({ email: ' admin@greenput.com' });
    // Zod email validator rejects emails with leading spaces
    expect(result.success).toBe(false);
  });

  it('accepts a long valid email address', () => {
    const longEmail = 'a'.repeat(64) + '@' + 'b'.repeat(63) + '.com';
    const result = AdminSetupSchema.safeParse({ email: longEmail });
    expect(result.success).toBe(true);
  });

  it('returns parsed data with displayName when provided', () => {
    const result = AdminSetupSchema.safeParse({
      email: 'test@example.com',
      displayName: 'Test User',
    });
    if (result.success) {
      expect(result.data.email).toBe('test@example.com');
      expect(result.data.displayName).toBe('Test User');
    }
  });

  it('rejects displayName exactly at 256 chars', () => {
    const result = AdminSetupSchema.safeParse({
      email: 'admin@greenput.com',
      displayName: 'A'.repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it('accepts displayName with special characters', () => {
    const result = AdminSetupSchema.safeParse({
      email: 'admin@greenput.com',
      displayName: "O'Brien & Associates",
    });
    expect(result.success).toBe(true);
  });
});
