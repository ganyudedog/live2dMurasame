import type { AstrBotPluginDefinition } from './types';
import { AstrBotBridgeClient } from './AstrBotBridgeClient';
import { AstrBotSettingsCard } from './AstrBotSettingsCard';
import { DEFAULT_ASTRBOT_SETTINGS, normalizeSettings, type AstrBotBridgeSettings } from './settings';

export const astrBotBridgePlugin: AstrBotPluginDefinition = {
  manifest: {
    id: 'live2d.astrbot-bridge', name: 'AstrBot QQ Bridge', version: '0.2.0', apiVersion: '1.0.0',
    hosts: ['desktop'], permissions: ['ai', 'control-panel.navigation', 'settings.storage'],
    activationEvents: ['onRendererReady'],
  },
  activate: async (context) => {
    if (context.windowKind === 'control-panel') {
      context.ui.register({ id: 'astrbot.settings', slot: 'control-panel', placement: 'page', title: 'AstrBot QQ 对话', order: 30, render: AstrBotSettingsCard });
      return;
    }
    if (context.windowKind !== 'pet') return;
    const ai = context.host.ai;
    if (!ai) { context.logger.warn('activation.skipped', { reason: 'AI conversation host is unavailable' }); return; }
    const saved = await context.storage.get<AstrBotBridgeSettings>('settings', DEFAULT_ASTRBOT_SETTINGS);
    const settings = normalizeSettings(saved, DEFAULT_ASTRBOT_SETTINGS);
    const client = new AstrBotBridgeClient({ url: settings.bridgeUrl, token: settings.token, clientId: `live2d-${crypto.randomUUID()}`, ai, logger: context.logger, settings });
    context.subscriptions.add(() => client.dispose());
    context.subscriptions.add(context.storage.subscribe((key) => {
      if (key !== 'settings') return;
      void context.storage.get<AstrBotBridgeSettings>('settings', DEFAULT_ASTRBOT_SETTINGS)
        .then((next) => client.updateSettings(normalizeSettings(next, DEFAULT_ASTRBOT_SETTINGS)))
        .catch((error: unknown) => context.logger.error('settings.reload.failed', { error: String(error) }));
    }));
    client.start();
    context.logger.info('activated', { url: settings.bridgeUrl });
  },
};
