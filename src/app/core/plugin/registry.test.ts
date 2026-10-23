import { describe, expect, it } from 'vitest';
import { PluginRuntime } from './PluginRuntime';

describe('PluginRuntime', () => {
  it('owns contributions and removes them when a plugin stops', async () => {
    const runtime = new PluginRuntime();
    runtime.registerPlugin({
      manifest: { id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1.0.0', permissions: ['control-panel.cards'] },
      activate: ({ ui }) => {
        ui.register({ id: 'test.panel', slot: 'control-panel', title: 'Test', render: () => null });
      },
    });

    await runtime.activatePlugin('test.plugin');
    expect(runtime.registry.ui.listBySlot('control-panel')).toHaveLength(1);
    await runtime.stopPlugin('test.plugin');
    expect(runtime.registry.ui.listBySlot('control-panel')).toHaveLength(0);
    expect(runtime.plugins.get('test.plugin')?.state).toBe('stopped');
  });

  it('namespaces contributions by owner and rejects duplicates from one owner', async () => {
    const runtime = new PluginRuntime();
    runtime.registerPlugin({
      manifest: { id: 'one', name: 'One', version: '1.0.0', apiVersion: '1.0.0', permissions: ['control-panel.cards'] },
      activate: ({ ui }) => { ui.register({ id: 'same', slot: 'control-panel', title: 'One', render: () => null }); },
    });
    runtime.registerPlugin({
      manifest: { id: 'two', name: 'Two', version: '1.0.0', apiVersion: '1.0.0', permissions: ['control-panel.cards'] },
      activate: ({ ui }) => { ui.register({ id: 'same', slot: 'control-panel', title: 'Two', render: () => null }); },
    });
    await runtime.activatePlugin('one');
    await runtime.activatePlugin('two');
    expect(runtime.registry.ui.listBySlot('control-panel')).toHaveLength(2);
  });

  it('does not grant UI or storage without manifest permissions', async () => {
    const runtime = new PluginRuntime();
    runtime.registerPlugin({
      manifest: { id: 'permission.test', name: 'Permission', version: '1.0.0', apiVersion: '1.0.0' },
      activate: async ({ ui, storage }) => {
        expect(() => ui.register({ id: 'denied', slot: 'control-panel', title: 'Denied', render: () => null })).toThrow(/permission/);
        await expect(storage.get('key')).rejects.toThrow(/permission/);
      },
    });
    await runtime.activatePlugin('permission.test');
    expect(runtime.plugins.get('permission.test')?.state).toBe('active');
  });

  it('registers a dedicated page under an owner-scoped tab id and removes it on stop', async () => {
    const runtime = new PluginRuntime(undefined, 'desktop', 'control-panel');
    runtime.registerPlugin({
      manifest: { id: 'page.plugin', name: 'Page', version: '1.0.0', apiVersion: '1.0.0', permissions: ['control-panel.navigation'] },
      activate: ({ ui }) => {
        ui.register({ id: 'settings', slot: 'control-panel', placement: 'page', title: 'Plugin Settings', render: () => null });
      },
    });
    await runtime.activatePlugin('page.plugin');
    const [page] = runtime.getControlPanelPages();
    expect(page.tabId).toBe('plugin:page.plugin/settings');
    expect(runtime.getControlPanelPage(page.tabId)?.ownerId).toBe('page.plugin');
    await runtime.stopPlugin('page.plugin');
    expect(runtime.getControlPanelPages()).toHaveLength(0);
  });

  it('fails activation when one owner registers the same contribution twice', async () => {
    const runtime = new PluginRuntime();
    runtime.registerPlugin({
      manifest: { id: 'duplicate.plugin', name: 'Duplicate', version: '1.0.0', apiVersion: '1.0.0', permissions: ['control-panel.cards'] },
      activate: ({ ui }) => {
        ui.register({ id: 'card', slot: 'control-panel', title: 'One', render: () => null });
        ui.register({ id: 'card', slot: 'control-panel', title: 'Two', render: () => null });
      },
    });
    await expect(runtime.activatePlugin('duplicate.plugin')).rejects.toThrow(/Duplicate contribution/);
    expect(runtime.registry.ui.listBySlot('control-panel')).toHaveLength(0);
    expect(runtime.plugins.get('duplicate.plugin')?.state).toBe('failed');
  });

  it('activates once under concurrent calls and revokes host capabilities after stop', async () => {
    const runtime = new PluginRuntime();
    runtime.registerHostApi('aiModels', 'ai.models', { getModels: () => [{ id: 'model', efforts: [] }], subscribe: () => () => {} });
    let activations = 0;
    let models: (() => readonly { id: string; efforts: readonly string[] }[]) | undefined;
    runtime.registerPlugin({
      manifest: { id: 'lifecycle.plugin', name: 'Lifecycle', version: '1.0.0', apiVersion: '1.0.0', permissions: ['ai.models'] },
      activate: ({ host }) => { activations += 1; models = host.aiModels?.getModels; },
    });

    await Promise.all([runtime.activatePlugin('lifecycle.plugin'), runtime.activatePlugin('lifecycle.plugin')]);
    expect(activations).toBe(1);
    expect(models?.()).toEqual([{ id: 'model', efforts: [] }]);
    await runtime.stopPlugin('lifecycle.plugin');
    expect(() => models?.()).toThrow(/no longer active/);
  });
});
