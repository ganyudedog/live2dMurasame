import { sanitizeLogDetail } from './types';
import type { NapCatPluginDefinition } from './types';
import { NapCatClient } from './NapCatClient';
import { BotMessageSquare, Cable, Users } from 'lucide-react';
import { NapCatConnectionPage } from './pages/ConnectionPage';
import { NapCatPeoplePage } from './pages/PeoplePage';
import { NapCatReplyPage } from './pages/ReplyPage';
import { DEFAULT_NAPCAT_SETTINGS, normalizeSettings, type NapCatSettings } from './settings';
import { EMPTY_DIRECTORY, normalizeDirectory } from './directory';

let activeClient: NapCatClient | undefined;

export const napCatPlugin: NapCatPluginDefinition = {
  manifest: {
    id: 'live2d.napcat-bridge', name: 'NapCat QQ', version: '0.3.0', apiVersion: '1.0.0',
    hosts: ['desktop'], permissions: ['ai', 'control-panel.navigation', 'settings.storage'],
    activationEvents: ['onRendererReady'],
  },
  activate: async (context) => {
    if (context.windowKind === 'control-panel') {
      const page = { slot: 'control-panel', placement: 'page', group: 'NapCat QQ' } as const;
      context.ui.register({
        ...page, id: 'napcat.connection', title: '连接与触发', icon: Cable, order: 30, render: NapCatConnectionPage,
        description: '连接 NapCat 正向 WebSocket，并决定哪些 QQ 消息会被回复、多个会话怎么排队。',
      });
      context.ui.register({
        ...page, id: 'napcat.reply', title: '回复设置', icon: BotMessageSquare, order: 31, render: NapCatReplyPage,
        description: 'QQ 里回复用的模型和语言、场景说明，以及可以发送的收藏表情。',
      });
      context.ui.register({
        ...page, id: 'napcat.people', title: 'QQ 用户', icon: Users, order: 32, render: NapCatPeoplePage,
        description: '绑定主人，并为每个 QQ 用户单独设置称呼、关系和人物描述。',
      });
      return;
    }
    if (context.windowKind !== 'pet') return;
    const ai = context.host.ai;
    const reminders = context.host.reminders;
    if (!ai || !reminders) { context.logger.warn('activation.skipped', { reason: 'AI conversation host is unavailable' }); return; }
    const saved = await context.storage.get<NapCatSettings>('settings', DEFAULT_NAPCAT_SETTINGS);
    const settings = normalizeSettings(saved, DEFAULT_NAPCAT_SETTINGS);
    if (JSON.stringify(saved) !== JSON.stringify(settings)) await context.storage.set('settings', settings);
    const directory = normalizeDirectory(await context.storage.get('directory', EMPTY_DIRECTORY));
    const registered = new Set<string>();
    const register = (id: string) => {
      if (registered.has(id)) return;
      registered.add(id);
      context.subscriptions.add(reminders.registerChannel(id, record => record.channel.kind === 'channel' && record.channel.source === `plugin:${context.manifest.id}`
        ? client.sendReminder(record.sentence, record.id, record.channel.conversationId) : false));
    };
    const client = new NapCatClient({
      ai, logger: context.logger, settings, storage: context.storage, directory,
      onChannel: register,
      onReminderReceipt: id => reminders.confirmDelivery(id, true),
      onStatus: status => {
        void context.storage.set('status', status).catch(() => context.logger.error('status.persist.failed'));
      },
    });
    activeClient = client;
    context.subscriptions.add(() => { void client.dispose(); });
    context.subscriptions.add(context.storage.subscribe((key) => {
      if (key === 'directory') {
        void context.storage.get('directory', EMPTY_DIRECTORY)
          .then((next) => client.updateDirectory(normalizeDirectory(next)))
          .catch((error: unknown) => context.logger.error('directory.reload.failed', { error: sanitizeLogDetail(error) }));
        return;
      }
      if (key !== 'settings') return;
      void context.storage.get<NapCatSettings>('settings', DEFAULT_NAPCAT_SETTINGS)
        .then((next) => client.updateSettings(normalizeSettings(next, DEFAULT_NAPCAT_SETTINGS)))
        .catch((error: unknown) => context.logger.error('settings.reload.failed', { error: sanitizeLogDetail(error) }));
    }));
    await client.start(reminders.pendingChannels?.());
    context.logger.info('activated');
  },
  deactivate: async () => {
    const client = activeClient;
    activeClient = undefined;
    await client?.dispose();
  },
};
