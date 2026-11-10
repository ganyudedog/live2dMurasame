import { sanitizeLogDetail } from './types';
import type { AstrBotPluginDefinition } from './types';
import { AstrBotBridgeClient } from './AstrBotBridgeClient';
import { BotMessageSquare, Cable, Users } from 'lucide-react';
import { AstrBotConnectionPage } from './pages/ConnectionPage';
import { AstrBotPeoplePage } from './pages/PeoplePage';
import { AstrBotReplyPage } from './pages/ReplyPage';
import { DEFAULT_ASTRBOT_SETTINGS, normalizeSettings, type AstrBotBridgeSettings } from './settings';

export const astrBotBridgePlugin: AstrBotPluginDefinition = {
  manifest: {
    id: 'live2d.astrbot-bridge', name: 'AstrBot QQ Bridge', version: '0.3.0', apiVersion: '1.0.0',
    hosts: ['desktop'], permissions: ['ai', 'control-panel.navigation', 'settings.storage'],
    activationEvents: ['onRendererReady'],
  },
  activate: async (context) => {
    if (context.windowKind === 'control-panel') {
      const page = { slot: 'control-panel', placement: 'page', group: 'AstrBot QQ' } as const;
      context.ui.register({
        ...page, id: 'astrbot.connection', title: '连接与触发', icon: Cable, order: 30, render: AstrBotConnectionPage,
        description: '连接 AstrBot 的桥接插件，并决定哪些 QQ 消息会被回复、多个会话怎么排队。',
      });
      context.ui.register({
        ...page, id: 'astrbot.reply', title: '回复设置', icon: BotMessageSquare, order: 31, render: AstrBotReplyPage,
        description: 'QQ 里回复用的模型和语言、场景说明，以及可以发送的收藏表情。',
      });
      context.ui.register({
        ...page, id: 'astrbot.people', title: 'QQ 用户', icon: Users, order: 32, render: AstrBotPeoplePage,
        description: '绑定主人，并为每个 QQ 用户单独设置称呼、关系和人物描述。',
      });
      return;
    }
    if (context.windowKind !== 'pet') return;
    const ai = context.host.ai;
    if (!ai) { context.logger.warn('activation.skipped', { reason: 'AI conversation host is unavailable' }); return; }
    const saved = await context.storage.get<AstrBotBridgeSettings>('settings', DEFAULT_ASTRBOT_SETTINGS);
    const settings = normalizeSettings(saved, DEFAULT_ASTRBOT_SETTINGS);
    const client = new AstrBotBridgeClient({
      url: settings.bridgeUrl, token: settings.token, clientId: `live2d-${crypto.randomUUID()}`, ai, logger: context.logger, settings,
      storage: context.storage,
      onStatus: (status) => {
        void context.storage.set('status', status).catch((error: unknown) => context.logger.error('status.persist.failed', { error: sanitizeLogDetail(error) }));
      },
    });
    context.subscriptions.add(() => client.dispose());
    context.subscriptions.add(context.storage.subscribe((key) => {
      if (key !== 'settings') return;
      void context.storage.get<AstrBotBridgeSettings>('settings', DEFAULT_ASTRBOT_SETTINGS)
        .then((next) => client.updateSettings(normalizeSettings(next, DEFAULT_ASTRBOT_SETTINGS)))
        .catch((error: unknown) => context.logger.error('settings.reload.failed', { error: sanitizeLogDetail(error) }));
    }));
    client.start();
    context.logger.info('activated', { url: settings.bridgeUrl });
  },
};
