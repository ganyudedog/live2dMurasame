import React from 'react';
import { Settings2 } from 'lucide-react';
import type { PluginDefinition, UiRenderContext } from '../../src/app/modules/plugin';

type Settings = { appId: string; appSecret: string; enabled: boolean };
const readSettings = async (storage: UiRenderContext['storage']): Promise<Settings> => {
  const saved = await storage.get<Settings>('settings');
  return { appId: saved?.appId ?? '', appSecret: saved?.appSecret ?? '', enabled: saved?.enabled ?? false };
};
const FeishuPage = (context: UiRenderContext) => <FeishuSettings context={context} />;
function FeishuSettings({ context }: { context: UiRenderContext }) {
  const [settings, setSettings] = React.useState<Settings | null>(null);
  const [deliveryError, setDeliveryError] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [approval, setApproval] = React.useState<{ name: string; url: string; expiresAt: number } | null>(null);
  React.useEffect(() => {
    let active = true;
    async function refreshSettings() {
      const value = await readSettings(context.storage);
      if (active) setSettings(value);
    }
    async function refresh() {
      const value = await context.storage.get<NonNullable<typeof approval>>('registrationApproval');
      if (active) setApproval(value && value.expiresAt > Date.now() ? value : null);
    }
    async function refreshConnection() {
      const value = await context.storage.get<string>('connection');
      if (active && value) setStatus(value);
    }
    async function refreshDeliveryError() {
      const value = await context.storage.get<string>('deliveryError');
      if (active) setDeliveryError(value ?? '');
    }
    const unsubscribe = context.storage.subscribe(key => {
      if (key === 'deliveryError') void refreshDeliveryError();
      if (key === 'registrationApproval') void refresh();
      if (key === 'settings') void refreshSettings();
      if (key === 'connection') void refreshConnection();
    });
    void refresh();
    void refreshConnection();
    void refreshSettings();
    void refreshDeliveryError();
    return () => { active = false; unsubscribe(); };
  }, [context.storage]);
  if (!settings) return <div className="p-6">正在读取飞书配置…</div>;
  const update = (patch: Partial<Settings>) => { const next = { ...settings, ...patch }; setSettings(next); };
  return <div className="max-w-xl space-y-4 p-6">
    <h2 className="text-lg font-semibold">飞书连接</h2>
    {approval && <label className="block">请复制链接到浏览器，授权创建「{approval.name}」<input className="w-full rounded border p-2" readOnly value={approval.url} onFocus={e => e.currentTarget.select()} /></label>}
    <label className="block">App ID<input className="mt-1 w-full rounded border p-2" value={settings.appId} onChange={e => update({ appId: e.target.value })} /></label>
    <label className="block">App Secret<input className="mt-1 w-full rounded border p-2" type="password" value={settings.appSecret} onChange={e => update({ appSecret: e.target.value })} /></label>
    <label className="flex gap-2"><input type="checkbox" checked={settings.enabled} onChange={e => update({ enabled: e.target.checked })} />启用长连接</label>
    <button className="rounded bg-blue-600 px-3 py-2 text-white" onClick={() => { void context.storage.set('settings', settings).catch(error => setStatus(String(error))); }}>应用配置</button>
    <span className="ml-3 text-sm">状态：{status}</span>
    {deliveryError && <p role="status" className="break-words text-sm">回复待发送。{deliveryError}</p>}
  </div>;
}

export const feishuPlugin: PluginDefinition = {
  manifest: { id: 'live2d.feishu', name: '飞书', version: '0.1.0', apiVersion: '1.0.0', hosts: ['desktop'], permissions: ['ai', 'control-panel.navigation', 'settings.storage'], activationEvents: ['onRendererReady'] },
  activate: async (context) => {
    if (context.windowKind === 'control-panel') {
      context.ui.register({ id: 'feishu.settings', slot: 'control-panel', placement: 'page', group: '飞书', title: '连接设置', icon: Settings2, render: FeishuPage });
      return;
    }
    if (context.windowKind !== 'pet' || !context.host.ai) return;
    const { storage } = context;
    const channel = context.host.ai.openChannel({ source: 'feishu', conversationId: 'feishu', interaction: { mode: 'concurrent', maxConcurrent: 4, maxQueued: 8 }, speakLang: 'auto' });
    type Message = { messageId: string; conversationId: string; conversationType: 'private' | 'group'; senderId: string; senderName?: string; text: string };
    let active = true;
    const consume = async (key: string) => {
      const message = await storage.get<Message | true | { replyMessageId: string } | { rejected: string }>(key);
      if (!active || !message || message === true || !('messageId' in message)) return;
      const result = channel.sendText({ text: message.text, requestId: `feishu:${message.messageId}`, conversationId: message.conversationId,
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
