import React from 'react';
import * as ReactDOM from 'react-dom';
import * as jsxRuntime from 'react/jsx-runtime';
import type { PluginManifest } from './types/manifest';

/** Read runtime plugin manifests from Electron without importing their UI entry. */
export const loadRuntimePluginManifests = async (): Promise<ReadonlyArray<PluginManifest>> => window.SystemAPI?.listPlugins?.() ?? [];

export const loadRuntimePlugins = async (list: readonly PluginManifest[]): Promise<unknown[]> => {
  Object.assign(globalThis, { live2dPluginReact: { React, ReactDOM, jsxRuntime } });
  const plugins: unknown[] = [];
  for (const entry of list) {
    if (!entry.entry?.ui) continue;
    try {
      const loaded = await import(/* @vite-ignore */ `plugin://runtime/${encodeURIComponent(entry.id)}/${entry.entry.ui}`);
      plugins.push(loaded.default ?? loaded);
    } catch (error) {
      console.error('[plugin] runtime load failed', entry.id, error);
    }
  }
  return plugins;
};