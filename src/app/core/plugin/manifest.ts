import { z } from 'zod';
import type { PluginManifest } from './types';

const pluginManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  apiVersion: z.string().min(1),
  hosts: z.array(z.enum(['desktop', 'cli'])).optional(),
  activationEvents: z.array(z.string()).optional(),
  entry: z.object({ service: z.string().optional(), ui: z.string().optional() }).optional(),
  contributes: z.record(z.string(), z.unknown()).optional(),
});

export const parsePluginManifest = (value: unknown): PluginManifest => pluginManifestSchema.parse(value);
