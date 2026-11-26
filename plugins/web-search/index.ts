import { Search } from 'lucide-react';
import type { PluginDefinition } from '../../src/app/modules/plugin';
import { SearchSettings } from './SettingsPage';

export default {
  manifest: { id: 'live2d.web-search', name: 'DeepSeek 搜索', version: '1.0.0', apiVersion: '1.0.0',
    hosts: ['desktop'], permissions: ['control-panel.navigation', 'settings.storage'], activationEvents: ['onRendererReady'] },
  activate(context) {
    if (context.windowKind === 'control-panel') context.ui.register({
      id: 'web-search.settings', slot: 'control-panel', placement: 'page', group: '网页搜索', title: 'DeepSeek 搜索',
      description: '配置网页搜索使用的 API token', icon: Search, render: SearchSettings,
    });
  },
} satisfies PluginDefinition;
