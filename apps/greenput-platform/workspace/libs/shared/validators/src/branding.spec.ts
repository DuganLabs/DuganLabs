import { describe, it, expect } from 'vitest';
import { UpdateBrandingSchema } from './branding';

describe('UpdateBrandingSchema', () => {
  it('rejects empty object', () => {
    const result = UpdateBrandingSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('accepts valid 6-char hex color', () => {
    const result = UpdateBrandingSchema.safeParse({ primaryColor: '#10b981' });
    expect(result.success).toBe(true);
  });

  it('rejects non-hex color name', () => {
    const result = UpdateBrandingSchema.safeParse({ primaryColor: 'blue' });
    expect(result.success).toBe(false);
  });

  it('rejects 3-char shorthand hex', () => {
    const result = UpdateBrandingSchema.safeParse({ primaryColor: '#fff' });
    expect(result.success).toBe(false);
  });

  it('accepts uppercase hex color', () => {
    const result = UpdateBrandingSchema.safeParse({ primaryColor: '#10B981' });
    expect(result.success).toBe(true);
  });

  it('accepts full branding update', () => {
    const result = UpdateBrandingSchema.safeParse({
      logoUrl: 'https://example.com/logo.png',
      faviconUrl: 'https://example.com/favicon.ico',
      primaryColor: '#10b981',
      secondaryColor: '#1f2937',
      accentColor: '#3b82f6',
      fontFamily: 'Inter',
      customDomain: 'app.mycompany.com',
      emailFooter: 'Thanks for choosing us!',
    });
    expect(result.success).toBe(true);
  });

  it('accepts null logoUrl', () => {
    const result = UpdateBrandingSchema.safeParse({ logoUrl: null });
    expect(result.success).toBe(true);
  });

  it('accepts null faviconUrl', () => {
    const result = UpdateBrandingSchema.safeParse({ faviconUrl: null });
    expect(result.success).toBe(true);
  });

  it('rejects invalid URL for logoUrl', () => {
    const result = UpdateBrandingSchema.safeParse({ logoUrl: 'not-a-url' });
    expect(result.success).toBe(false);
  });

  it('rejects empty string fontFamily', () => {
    const result = UpdateBrandingSchema.safeParse({ fontFamily: '' });
    expect(result.success).toBe(false);
  });

  it('accepts customDomain as null', () => {
    const result = UpdateBrandingSchema.safeParse({ customDomain: null });
    expect(result.success).toBe(true);
  });

  it('accepts emailFooter field alone', () => {
    const result = UpdateBrandingSchema.safeParse({
      emailFooter: 'Powered by Greenput',
    });
    expect(result.success).toBe(true);
  });
});

describe('UpdateBrandingSchema additional', () => {
  it('rejects hex color without hash prefix', () => {
    const result = UpdateBrandingSchema.safeParse({ primaryColor: '10b981' });
    expect(result.success).toBe(false);
  });

  it('rejects 7-char hex with extra char', () => {
    const result = UpdateBrandingSchema.safeParse({ primaryColor: '#10b9810' });
    expect(result.success).toBe(false);
  });

  it('accepts all three color fields together', () => {
    const result = UpdateBrandingSchema.safeParse({
      primaryColor: '#ff0000',
      secondaryColor: '#00ff00',
      accentColor: '#0000ff',
    });
    expect(result.success).toBe(true);
  });

  it('rejects emailFooter over 5000 chars', () => {
    const result = UpdateBrandingSchema.safeParse({
      emailFooter: 'A'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts emailFooter exactly at 5000 chars', () => {
    const result = UpdateBrandingSchema.safeParse({
      emailFooter: 'A'.repeat(5000),
    });
    expect(result.success).toBe(true);
  });

  it('rejects fontFamily over 200 chars', () => {
    const result = UpdateBrandingSchema.safeParse({
      fontFamily: 'A'.repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it('rejects customDomain over 253 chars', () => {
    const result = UpdateBrandingSchema.safeParse({
      customDomain: 'a'.repeat(254),
    });
    expect(result.success).toBe(false);
  });
});
