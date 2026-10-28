import { describe, expect, it, vi } from 'vitest';
import type { AiHostApi, ConversationChannel } from '../types';
import { PluginRuntime } from './PluginRuntime';

describe('PluginRuntime', () => {
  it('exposes only contracted host methods and revokes saved methods on stop', async () => {
    const unsubscribe = vi.fn();
    const channelDispose = vi.fn();
    class Host {
      internal = 'hidden';
      dispose = vi.fn();
      getModels() { return [{ id: this.internal, efforts: [] }]; }
      subscribe() { return unsubscribe; }
      openChannel() { return { dispose: channelDispose } as unknown as ConversationChannel; }
    }
    const host = new Host();
    let api!: AiHostApi;
    const runtime = new PluginRuntime({ hosts: { ai: host } });
    runtime.registerPlugin({
      manifest: { id: 'boundary', name: 'Boundary', version: '1.0.0', apiVersion: '1.0.0', permissions: ['ai'] },
      activate: (context) => { api = context.host.ai!; },
    });
    await runtime.activatePlugin('boundary');
    const getModels = api.getModels;
    expect(getModels()).toEqual([{ id: 'hidden', efforts: [] }]);
    expect(api.getModels).toBe(getModels);
    for (const key of ['dispose', 'internal', 'constructor', '__proto__']) {
      expect(Reflect.get(api, key)).toBeUndefined();
      expect(Object.getOwnPropertyDescriptor(api, key)).toBeUndefined();
      expect(key in api).toBe(false);
    }
    expect(Object.getPrototypeOf(api)).toBeNull();
    expect(Reflect.ownKeys(api)).not.toContain('internal');
    expect(Reflect.set(api, 'internal', 'changed')).toBe(false);
    expect(Reflect.defineProperty(api, 'dispose', { value: () => undefined })).toBe(false);
    expect(Reflect.deleteProperty(api, 'getModels')).toBe(false);
    expect(Reflect.setPrototypeOf(api, host)).toBe(false);
    api.subscribe(() => undefined);
    api.openChannel({ source: 'test', conversationId: 'test', interaction: { mode: 'queue' } });
    await runtime.stopPlugin('boundary');
    expect(getModels).toThrow('no longer active');
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(channelDispose).toHaveBeenCalledOnce();
    expect(host.dispose).not.toHaveBeenCalled();
    expect(host.internal).toBe('hidden');
    await runtime.dispose();
  });

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
    const runtime = new PluginRuntime({ windowKind: 'control-panel' });
    runtime.registerPlugin({
      manifest: { id: 'page.plugin', name: 'Page', version: '1.0.0', apiVersion: '1.0.0', permissions: ['control-panel.navigation'] },
      activate: ({ ui }) => {
        ui.register({ id: 'settings', slot: 'control-panel', placement: 'page', title: 'Plugin Settings', render: () => null });
      },
    });
    await runtime.activatePlugin('page.plugin');
    const [page] = runtime.getControlPanelPages();
    expect(page.tabId).toBe('plugin:page.plugin/settings');
    expect(page.ownerId).toBe('page.plugin');
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
    const runtime = new PluginRuntime({
      hosts: {
        ai: {
          openChannel: () => { throw new Error('unused'); },
          getModels: () => [{ id: 'model', efforts: [] }],
          subscribe: () => () => {},
        },
      },
    });
    let activations = 0;
    let models: (() => readonly { id: string; efforts: readonly string[] }[]) | undefined;
    runtime.registerPlugin({
      manifest: { id: 'lifecycle.plugin', name: 'Lifecycle', version: '1.0.0', apiVersion: '1.0.0', permissions: ['ai'] },
      activate: ({ host }) => { activations += 1; models = host.ai?.getModels; },
    });

    await Promise.all([runtime.activatePlugin('lifecycle.plugin'), runtime.activatePlugin('lifecycle.plugin')]);
    expect(activations).toBe(1);
    expect(models?.()).toEqual([{ id: 'model', efforts: [] }]);
    await runtime.stopPlugin('lifecycle.plugin');
    expect(() => models?.()).toThrow(/no longer active/);
  });
});
