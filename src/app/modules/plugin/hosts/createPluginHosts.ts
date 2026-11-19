import { reaction } from 'mobx';
import { loadLlmSelection } from '@app/shared/state-bus/llmSelectionCache';
import type { ConfigService } from '@app/shared/config/ConfigService';
import type { ElectronService } from '@app/shared/electron/ElectronService';
import type { LogService } from '@app/shared/logging/LogService';
import type { ControlPanelService } from '@app/modules/control-panel/service/ControlPanelService';
import type { Live2dService } from '@app/modules/live2d/service/Live2dService';
import type { AiService } from '@app/modules/ai/service/AiService';
import { ReminderRuntime, type ReminderChannelDelivery } from '@app/modules/ai/modules/reminders/ReminderRuntime';
import type { PluginHostApiMap, PluginWindowKind } from '../types';
import { AiHost } from './ai/AiHost';
import { createDefaultConversationExecutor } from './ai/createConversationExecutor';
import { createControlPanelHost } from './control-panel/ControlPanelHost';
import { createDesktopNotificationsHost, createDesktopWindowHost } from './desktop/DesktopHost';
import { createLive2dHost } from './live2d/Live2dHost';

export interface PluginHostDependencies {
  readonly windowKind: PluginWindowKind;
  readonly log: LogService;
  readonly config: ConfigService;
  readonly electron: ElectronService;
  readonly live2d?: Live2dService;
  readonly controlPanel?: ControlPanelService;
  readonly ai?: AiService;
}

export interface InstalledPluginHosts {
  readonly hosts: Partial<PluginHostApiMap>;
  dispose(): void;
}

export const createPluginHosts = (deps: PluginHostDependencies): InstalledPluginHosts => {
  const getLlmModels = () => (Array.isArray(deps.config.globalModelConfig?.llmModels)
    ? deps.config.globalModelConfig.llmModels
    : []);
  const reminderRuntime = deps.windowKind === 'pet' && deps.ai
    ? new ReminderRuntime({
      desktopDeliver: (sentence, reminderId, speakText) => deps.ai!.deliverReminder(sentence, reminderId, deps.config.modelConfig?.tts?.enabled ? speakText : undefined),
      channelDeliver: () => false,
      onDelivered: (record) => {
        const desktop = record.channel.kind === 'desktop';
        const modelPath = record.history?.modelPath ?? (desktop ? deps.config.activeModelPath : undefined);
        const at = Date.now();
        if (desktop) deps.ai!.publishReminderHistory(record.id, record.sentence, modelPath ?? undefined, at);
        if (modelPath && (desktop || record.history?.archive)) {
          void window.MemoryAPI?.appendConversation?.({ modelPath, archive: record.history?.archive, sender: record.history?.sender,
            requestId: record.id, userText: '定时提醒到点', assistantText: record.sentence, at,
            conversationId: record.channel.kind === 'channel' ? record.channel.conversationId : record.id,
          }).catch(error => console.warn('reminder.history.failed', record.id, error));
        }
      },
    })
    : null;
  if (reminderRuntime && deps.ai) {
    deps.ai.bindReminderSink((dueAt, sentence, speakText) => reminderRuntime.add(dueAt, sentence, { kind: 'desktop' }, speakText,
      deps.config.activeModelPath ? { modelPath: deps.config.activeModelPath } : undefined));
    reminderRuntime.start();
  }
  const ai = new AiHost(
    createDefaultConversationExecutor(deps.config, deps.log, {
      onReminder: (request, context, options, origin) => {
        if (!reminderRuntime) throw new Error('提醒运行时不可用');
        return reminderRuntime.add(request.dueAt, request.sentence, {
          kind: 'channel', channelId: context.channelId, source: options.source, conversationId: context.conversationId, requestId: context.requestId,
        }, request.speakText, deps.config.activeModelPath && origin.memoryArchive
          ? { modelPath: deps.config.activeModelPath, archive: origin.memoryArchive, sender: origin.sender } : undefined);
      },
    }),
    () => {
      const models = getLlmModels();
      const chat = loadLlmSelection(models, 'chat');
      return models.map(({ id, efforts }) => ({ id, efforts: [...efforts], ...(id === chat.model ? { chatEffort: chat.effort } : {}) }));
    },
    (listener) => reaction(() => JSON.stringify([getLlmModels(), deps.controlPanel?.aiSettings.model,
      deps.controlPanel?.aiSettings.reasoningEffort]), () => listener()),
    async () => {
      const modelPath = deps.config.activeModelPath;
      if (!modelPath) return null;
      const memory = await window.MemoryAPI?.get?.({ modelPath });
      if (deps.config.activeModelPath !== modelPath) return null;
      const userAddress = deps.config.modelConfig?.persona?.userAddress;
      return { line: memory?.relationship?.line ?? '',
        userAddress: typeof userAddress === 'string' ? userAddress.trim() : '' };
    },
  );
  const reminders = reminderRuntime ? {
    add: (dueAt: number, sentence: string, channel?: { readonly kind: 'desktop' } | { readonly kind: 'channel'; readonly channelId: string; readonly source: string; readonly conversationId: string }) => reminderRuntime.add(dueAt, sentence, channel ?? { kind: 'desktop' }),
    registerChannel: (channelId: string, deliver: ReminderChannelDelivery) => reminderRuntime.registerChannel(channelId, deliver),
    confirmDelivery: (reminderId: string, delivered: boolean, source = '') => reminderRuntime.confirmDelivery(reminderId, delivered, source),
    retryDue: () => reminderRuntime.retryDue(),
  } : undefined;
  const hosts: Partial<PluginHostApiMap> = {
    ai,
    desktopNotifications: createDesktopNotificationsHost(),
    ...(reminders ? { reminders } : {}),
    desktopWindow: createDesktopWindowHost(deps.electron),
    ...(deps.windowKind === 'pet' && deps.live2d ? { live2d: createLive2dHost(deps.live2d) } : {}),
    ...(deps.windowKind === 'control-panel' && deps.controlPanel
      ? { controlPanel: createControlPanelHost(deps.controlPanel) }
      : {}),
  };
  return {
    hosts,
    dispose() {
      ai.dispose();
      reminderRuntime?.dispose();
    },
  };
};
