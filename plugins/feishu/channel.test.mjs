import { describe, it, expect, vi } from 'vitest';
import { startService } from './main.mjs';
import { feishuPlugin } from './index';


const sdk = vi.hoisted(() => ({ handlers: new Map(), reply: vi.fn() }));
vi.mock('@larksuiteoapi/node-sdk', () => ({ LarkChannel: class {
  rawClient = { im: { message: { reply: sdk.reply } } };
  on(name, listener) { sdk.handlers.set(name, listener); }
  async connect() {}
  async disconnect() {}
} }));

describe('Feishu channel', () => {
  it('routes allowed messages once and keeps a disconnected reply until acknowledgement', async () => {
    const listeners = new Set();
    const values = new Map();
    const storage = {
      get: key => values.get(key),
      getTransient: key => values.get(`transient:${key}`),
      setTransient(key, value) { values.set(`transient:${key}`, value); listeners.forEach(fn => fn(key)); },
      set(key, value) { values.set(key, value); listeners.forEach(fn => fn(key)); },
      delete(key) { values.delete(key); listeners.forEach(fn => fn(key)); },
      deleteTransient(key) { const deleted = values.delete(`transient:${key}`); if (deleted) listeners.forEach(fn => fn(key)); return deleted; },
      subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    };
    const report = vi.fn();
    const stopService = startService(storage, report);
    storage.set('settings', { enabled: true, appId: 'demo', appSecret: 'example' });
    const sendText = vi.fn(() => ({ accepted: true }));
    let respond;
    const channel = { sendText, onResponse: fn => { respond = fn; return () => {}; }, dispose: vi.fn() };
    const disposers = [];
    const context = { windowKind: 'pet', host: { ai: { openChannel: () => channel } }, storage, subscriptions: { add: fn => disposers.push(fn) }, logger: { warn: vi.fn() } };
    try {
      await feishuPlugin.activate(context);
      const message = { messageId: 'om_in', chatId: 'oc_chat', senderId: 'owner', content: 'hello', chatType: 'group', mentionedBot: false };
      sdk.handlers.get('message')(message);

      expect(sendText).not.toHaveBeenCalled();
      const dm = { ...message, chatType: 'p2p' };
      sdk.handlers.get('message')(dm);
      sdk.handlers.get('message')(dm);
      await vi.waitFor(() => expect(sendText).toHaveBeenCalledTimes(1));
      expect(sendText.mock.calls[0][0]).toMatchObject({ text: 'hello', conversationId: 'oc_chat', sender: { id: 'owner' } });
      sdk.handlers.get('reconnecting')();
      expect(report).toHaveBeenCalledWith('connection.reconnecting', {}, false);
      respond({ requestId: 'feishu:om_in', status: 'done', text: 'done' });
      await vi.waitFor(async () => expect(await storage.get('pendingReplies')).toHaveLength(1));
      expect(sdk.reply).not.toHaveBeenCalled();
      let rejectFirst;
      sdk.reply.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
      let accept;
      sdk.reply.mockImplementationOnce(() => new Promise(resolve => { accept = resolve; }));
      sdk.handlers.get('reconnected')();
      sdk.handlers.get('reconnected')();
      expect(report).toHaveBeenCalledWith('connection.reconnected', {}, false);
      expect(sdk.reply).toHaveBeenCalledTimes(1);
      expect(sdk.reply.mock.calls[0][0]).toMatchObject({ path: { message_id: 'om_in' }, data: { content: JSON.stringify({ text: 'done' }) } });
      rejectFirst(new Error('connection lost'));
      await vi.waitFor(() => expect(sdk.reply).toHaveBeenCalledTimes(2));
      expect(report).toHaveBeenCalledWith('delivery.failed', expect.objectContaining({ messageId: 'om_in', reason: 'connection lost', attempt: 1 }), true);
      expect(sdk.reply.mock.calls[1][0].data.uuid).toBe(sdk.reply.mock.calls[0][0].data.uuid);
      accept({ code: 0, data: { message_id: 'om_out' } });
      await vi.waitFor(async () => expect(await storage.get('pendingReplies')).toEqual([]));
      expect(report).toHaveBeenCalledWith('delivery.succeeded', expect.objectContaining({ messageId: 'om_in', attempt: 1 }), false);
      expect(storage.get('message.om_in')).toEqual({ replyMessageId: 'om_out' });
      storage.set('reply.om_in', { messageId: 'om_in', text: 'done' });
      sdk.handlers.get('reconnected')();
      expect(sdk.reply).toHaveBeenCalledTimes(2);
      for (const [status, text, expected] of [
        ['error', '', '这轮对话处理失败。'],
        ['cancelled', '', '这轮对话已取消。'],
        ['done', '   ', '这轮对话没有生成文字回复。'],
      ]) {
        const messageId = `om_${status}`;
        sdk.handlers.get('message')({ ...dm, messageId });
        await vi.waitFor(() => expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ requestId: `feishu:${messageId}` })));
        expect(storage.get(`message.${messageId}`).text).toBe('hello');
        sdk.reply.mockRejectedValueOnce(new Error('temporary failure'));
        sdk.reply.mockResolvedValueOnce({ code: 0, data: { message_id: `receipt_${status}` } });
        respond({ requestId: `feishu:${messageId}`, status, text });
        await vi.waitFor(() => expect(storage.get('deliveryError')).toBe('temporary failure'));
        expect(storage.get(`message.${messageId}`).text).toBe('hello');
        expect(storage.get('pendingReplies')[0].text).toBe(expected);
        await vi.waitFor(() => expect(storage.get(`message.${messageId}`)).toEqual({ replyMessageId: `receipt_${status}` }), { timeout: 2000 });
      }
      disposers.splice(0).forEach(dispose => dispose());
      await feishuPlugin.activate(context);
      sdk.handlers.get('message')(dm);
      expect(sendText).toHaveBeenCalledTimes(4);
    } finally {
      disposers.forEach(dispose => dispose());
      stopService();
    }
  });
});
