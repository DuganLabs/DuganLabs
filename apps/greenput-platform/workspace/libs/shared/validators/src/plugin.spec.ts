import { describe, it, expect } from 'vitest';
import {
  InstallPluginSchema,
  UpdatePluginConfigSchema,
  PluginCategoryEnum,
} from './plugin';

describe('InstallPluginSchema', () => {
  it('allows empty config (uses default)', () => {
    const result = InstallPluginSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config).toEqual({});
    }
  });

  it('allows arbitrary config values', () => {
    const result = InstallPluginSchema.safeParse({
      config: { apiKey: 'abc', timeout: 30 },
    });
    expect(result.success).toBe(true);
  });

  it('allows nested config objects', () => {
    const result = InstallPluginSchema.safeParse({
      config: { nested: { deep: true }, arr: [1, 2, 3] },
    });
    expect(result.success).toBe(true);
  });

  it('allows null config values', () => {
    const result = InstallPluginSchema.safeParse({ config: { key: null } });
    expect(result.success).toBe(true);
  });
});

describe('UpdatePluginConfigSchema', () => {
  it('validates config update', () => {
    const result = UpdatePluginConfigSchema.safeParse({
      config: { newSetting: true },
    });
    expect(result.success).toBe(true);
  });

  it('validates config + enabled update', () => {
    const result = UpdatePluginConfigSchema.safeParse({
      config: {},
      enabled: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing config', () => {
    const result = UpdatePluginConfigSchema.safeParse({ enabled: true });
    expect(result.success).toBe(false);
  });

  it('rejects empty object', () => {
    expect(UpdatePluginConfigSchema.safeParse({}).success).toBe(false);
  });

  it('accepts empty config object', () => {
    expect(UpdatePluginConfigSchema.safeParse({ config: {} }).success).toBe(
      true,
    );
  });

  it('accepts enabled: true', () => {
    expect(
      UpdatePluginConfigSchema.safeParse({ config: {}, enabled: true }).success,
    ).toBe(true);
  });
});

describe('PluginCategoryEnum', () => {
  it('accepts all valid categories', () => {
    const validCategories = [
      'general',
      'communication',
      'accounting',
      'scheduling',
      'marketing',
      'analytics',
    ];
    for (const cat of validCategories) {
      expect(PluginCategoryEnum.safeParse(cat).success).toBe(true);
    }
  });

  it('rejects unknown category', () => {
    expect(PluginCategoryEnum.safeParse('unknown').success).toBe(false);
  });

  it('rejects empty string', () => {
    expect(PluginCategoryEnum.safeParse('').success).toBe(false);
  });

  it('rejects numeric value', () => {
    expect(PluginCategoryEnum.safeParse(1).success).toBe(false);
  });

  it('rejects null', () => {
    expect(PluginCategoryEnum.safeParse(null).success).toBe(false);
  });

  it('rejects partial match (gen instead of general)', () => {
    expect(PluginCategoryEnum.safeParse('gen').success).toBe(false);
  });
});

describe('InstallPluginSchema additional', () => {
  it('strips unknown top-level fields', () => {
    const result = InstallPluginSchema.safeParse({
      config: {},
      extraKey: 'ignored',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(
        (result.data as Record<string, unknown>)['extraKey'],
      ).toBeUndefined();
    }
  });
});

describe('UpdatePluginConfigSchema additional', () => {
  it('enabled defaults to undefined when not provided', () => {
    const result = UpdatePluginConfigSchema.safeParse({ config: {} });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.enabled).toBeUndefined();
  });

  it('rejects enabled as string', () => {
    const result = UpdatePluginConfigSchema.safeParse({
      config: {},
      enabled: 'yes',
    });
    expect(result.success).toBe(false);
  });
});
