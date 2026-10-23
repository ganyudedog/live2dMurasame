import { z } from 'zod';
import type { PluginManifest } from './types';

const pluginManifestSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/, 'Invalid plugin id'),
  name: z.string().min(1),
  version: z.string().min(1),
  apiVersion: z.string().regex(/^1(?:\.\d+){0,2}$/, 'Unsupported plugin API version'),
  hosts: z.array(z.enum(['desktop', 'cli'])).optional(),
  permissions: z.array(z.enum([
    'ai.conversations', 'ai.models', 'control-panel.navigation', 'control-panel.cards',
    'desktop.notifications', 'desktop.window', 'live2d.runtime', 'settings.storage', 'commands.register',
  ])).optional(),
  activationEvents: z.array(z.string()).optional(),
  entry: z.object({ service: z.string().optional(), ui: z.string().optional() }).optional(),
  contributes: z.record(z.string(), z.unknown()).optional(),
});

export const parsePluginManifest = (value: unknown): PluginManifest => pluginManifestSchema.parse(value);
