import { Cable, MessagesSquare } from 'lucide-react';
import type { PluginDefinition } from '../../src/app/modules/plugin';
import { ConnectionPage } from './pages/ConnectionPage';
import { MessagingPage } from './pages/MessagingPage';

export const feishuPlugin: PluginDefinition = {
  manifest: { id: 'live2d.feishu', name: '飞书', version: '0.1.0', apiVersion: '1.0.0', hosts: ['desktop'], permissions: ['ai', 'control-panel.navigation', 'settings.storage'], activationEvents: ['onRendererReady'] },
  activate: async (context) => {
    if (context.windowKind === 'control-panel') {
      context.ui.register({ id: 'feishu.settings', slot: 'control-panel', placement: 'page', group: '飞书', title: '连接设置',
        description: '飞书机器人的凭据、长连接状态和开发者平台准备项。', icon: Cable, order: 40, render: ConnectionPage });
      context.ui.register({ id: 'feishu.messaging', slot: 'control-panel', placement: 'page', group: '飞书', title: '消息与文档',
        description: '回复怎么发回飞书、谁算主人，以及云文档工具的前提。', icon: MessagesSquare, order: 41, render: MessagingPage });
      return;
    }
    if (context.windowKind !== 'pet' || !context.host.ai) return;
    const { storage } = context;
    const channel = context.host.ai.openChannel({ source: 'feishu', conversationId: 'feishu', interaction: { mode: 'concurrent', maxConcurrent: 4, maxQueued: 8 }, speakLang: 'auto' });
    type Message = { messageId: string; conversationId: string; conversationType: 'private' | 'group'; senderId: string; senderName?: string; text: string; isOwner?: boolean; isDeveloper?: boolean; userText?: string };
    let active = true;
    const consume = async (key: string) => {
      const message = await storage.get<Message | true | { replyMessageId: string } | { rejected: string }>(key);
      if (!active || !message || message === true || !('messageId' in message)) return;
      const relationship = message.isOwner ? await context.host.ai?.getRelationship?.().catch(() => null) : null;
      if (!active) return;
      const result = channel.sendText({ isOwner: message.isOwner === true,
        memberCommands: message.isDeveloper ? ['feishu.docx.read', 'feishu.docx.update', 'feishu.app.create'] : ['feishu.docx.read', 'feishu.docx.update'], text: message.text, requestId: `feishu:${message.messageId}`, conversationId: message.conversationId,
        ...(message.isOwner && message.userText ? { personalMemory: { userText: message.userText } } : {}),
        ...(relationship?.line ? { systemPrompt: relationship.line } : {}),
        sender: { id: message.senderId, displayName: message.senderName }, memoryArchive: { platform: 'feishu', scope: message.conversationType, id: message.conversationId } });
      if (!result.accepted && result.reason !== 'duplicate') {
        await storage.set(`reply.${message.messageId}`, { messageId: message.messageId, conversationId: message.conversationId, text: '当前无法接收这轮对话，请稍后重试。' });
      }
    };
    context.subscriptions.add(storage.subscribe(key => { if (key.startsWith('message.')) void consume(key); }));
    const unsubscribeResponse = channel.onResponse(response => {
      if (response.status === 'streaming') return;
      const text = response.status === 'done' ? response.text?.trim() || '这轮对话没有生成文字回复。'
        : response.status === 'cancelled' ? '这轮对话已取消。' : '这轮对话处理失败。';
      const messageId = response.requestId.slice('feishu:'.length);
      void storage.set(`reply.${messageId}`, { messageId, conversationId: response.conversationId, text });
    });
    context.subscriptions.add(() => { active = false; channel.dispose(); unsubscribeResponse(); void storage.set('petActive', false); });
    await storage.set('petActive', true);
  },
};
export default feishuPlugin;
