import { z } from 'zod';

const PluginCategoryEnum = z.enum([
  'general',
  'communication',
  'accounting',
  'scheduling',
  'marketing',
  'analytics',
]);

export const InstallPluginSchema = z.object({
  config: z.record(z.string(), z.unknown()).optional().default({}),
});

export const UpdatePluginConfigSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  enabled: z.boolean().optional(),
});

export type InstallPluginInput = z.infer<typeof InstallPluginSchema>;
export type UpdatePluginConfigInput = z.infer<typeof UpdatePluginConfigSchema>;
export { PluginCategoryEnum };
