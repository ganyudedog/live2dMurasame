import { describe, expect, it } from 'vitest';
import { PluginRuntime } from './PluginRuntime';

describe('PluginRuntime', () => {
  it('owns contributions and removes them when a plugin stops', async () => {
    const runtime = new PluginRuntime();
    runtime.registerPlugin({
      manifest: { id: 'test.plugin', name: 'Test', version: '1.0.0', apiVersion: '1.0.0' },
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

  it('rejects duplicate contributions across plugin owners', () => {
    const runtime = new PluginRuntime();
    runtime.registerPlugin({
      manifest: { id: 'one', name: 'One', version: '1.0.0', apiVersion: '1.0.0' },
      activate: ({ ui }) => { ui.register({ id: 'same', slot: 'control-panel', title: 'One', render: () => null }); },
    });
    runtime.registerPlugin({
      manifest: { id: 'two', name: 'Two', version: '1.0.0', apiVersion: '1.0.0' },
      activate: ({ ui }) => { ui.register({ id: 'same', slot: 'control-panel', title: 'Two', render: () => null }); },
    });
    return expect(runtime.activatePlugin('one').then(() => runtime.activatePlugin('two'))).rejects.toThrow(/Duplicate contribution/);
  });
});
