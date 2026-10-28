import { z } from 'zod';
import { pluginPermissions, type PluginDefinition, type PluginManifest } from '../types';

const pluginManifestSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/, 'Invalid plugin id'),
  name: z.string().min(1),
  version: z.string().min(1),
  apiVersion: z.string().regex(/^1(?:\.\d+){0,2}$/, 'Unsupported plugin API version'),
  hosts: z.array(z.enum(['desktop', 'cli'])).optional(),
  permissions: z.array(z.enum(pluginPermissions)).optional(),
  activationEvents: z.array(z.string()).optional(),
  entry: z.object({ service: z.string().optional(), ui: z.string().optional() }).optional(),
  contributes: z.record(z.string(), z.unknown()).optional(),
});

export const parsePluginManifest = (value: unknown): PluginManifest => pluginManifestSchema.parse(value);

/** Narrow a Vite glob default export into a plugin. This is a shape check, not a privilege boundary. */
export const parsePluginDefinition = (value: unknown): PluginDefinition => {
  if (!value || typeof value !== 'object') throw new Error('Plugin must be an object');
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.activate !== 'function') throw new Error('Plugin activate() is required');
  if (candidate.deactivate !== undefined && typeof candidate.deactivate !== 'function') {
    throw new Error('Plugin deactivate() must be a function');
  }
  return {
    manifest: parsePluginManifest(candidate.manifest),
    activate: candidate.activate as PluginDefinition['activate'],
    ...(typeof candidate.deactivate === 'function'
      ? { deactivate: candidate.deactivate as PluginDefinition['deactivate'] }
      : {}),
  };
};
