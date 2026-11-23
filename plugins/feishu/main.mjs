import { createHash } from 'node:crypto';
import { LarkChannel } from '@larksuiteoapi/node-sdk';

const createTransport = (emit) => {
  let channel;
  let state = 'idle';
  function status(next) {
    state = next;
    emit('status', { state });
  }
  async function stop() {
    const previous = channel;
    channel = undefined;
    status('idle');
    if (previous) await previous.disconnect();
  }
  return {
    async start(config) {
      const appId = config?.appId?.trim();
      const appSecret = config?.appSecret?.trim();
      if (!appId || !appSecret) throw new Error('飞书 App ID 和 App Secret 不能为空');
      const next = new LarkChannel({
        appId, appSecret, transport: 'websocket', loggerLevel: 2,
        safety: { batch: { text: { maxMessages: 1 } } },
      });
      const previous = channel;
      channel = next;
      status('connecting');
      if (previous) await previous.disconnect();
      if (channel !== next) return;
      next.on('message', message => {
        const text = message.content?.trim();
        if (channel !== next || !text || !message.chatId || !message.messageId || !message.senderId) return;
        emit('message', {
          messageId: message.messageId,
          conversationId: message.chatId,
          conversationType: message.chatType === 'p2p' ? 'private' : 'group',
          senderId: message.senderId,
          senderName: message.senderName,
          text: /^https:\/\/(?:[a-z0-9-]+\.)*(?:feishu\.cn|larksuite\.com)\/(?:wiki|docx)\/[a-z0-9]+\/?(?:[?#][^\s]*)?$/i.test(text)
            ? `请使用飞书文档工具查看该链接，确认能否读取：${text}` : text,
          mentionsBot: message.mentionedBot,
        });
      });
      next.on('reconnecting', () => { if (channel === next) status('reconnecting'); });
      next.on('reconnected', () => { if (channel === next) status('connected'); });
      try {
        await next.connect();
        if (channel === next) status('connected');
        else await next.disconnect();
      } catch (error) {
        if (channel === next) { channel = undefined; status('error'); }
        await next.disconnect();
        throw error;
      }
    },
    stop,
    async send({ replyTo, text }) {
      if (!channel || state !== 'connected') throw new Error('飞书长连接未连接');
      const uuid = createHash('sha256').update(replyTo).digest('hex').slice(0, 32);
      const result = await channel.rawClient.im.message.reply({
        path: { message_id: replyTo },
        data: { msg_type: 'text', content: JSON.stringify({ text }), uuid },
      });
      if (result.code !== 0 || !result.data?.message_id) throw new Error(result.msg || '飞书未返回回复回执');
      return { messageId: result.data.message_id };
    },
  };
};

export function startService(storage) {
  const sending = new Set();
  let disposed = false;
  let connectionGeneration = 0;
  let retryTimer;
  let retryDelay = 1000;
  function resetRetry() {
    clearTimeout(retryTimer);
    retryTimer = undefined;
    retryDelay = 1000;
  }
  function scheduleRetry() {
    if (retryTimer || storage.get('connection') !== 'connected') return;
    retryTimer = setTimeout(() => {
      retryTimer = undefined;
      flush();
    }, retryDelay);
    retryDelay = Math.min(60000, retryDelay * 2);
  }
  const transport = createTransport((event, payload) => {
    if (disposed) return;
    if (event === 'message') {
      if (payload.conversationType === 'group' && !payload.mentionsBot) return;
      const key = `message.${payload.messageId}`;
      if (storage.get(key) !== undefined || (storage.get('seenMessages') ?? []).includes(payload.messageId)) return;
      storage.set(key, payload);
    } else {
      resetRetry();
      storage.set('connection', payload.state);
      if (payload.state === 'connected') {
        connectionGeneration++;
        flush();
      }
    }
  });
  async function deliver(reply) {
    const startedOn = connectionGeneration;
    try {
      const key = `message.${reply.messageId}`;
      if (!storage.get(key)?.replyMessageId) {
        const receipt = await transport.send({ replyTo: reply.messageId, text: reply.text });
        storage.set(key, { replyMessageId: receipt.messageId });
      }
      const remaining = (storage.get('pendingReplies') ?? []).filter(item => item.messageId !== reply.messageId);
      storage.set('pendingReplies', remaining);
      if (!remaining.length) {
        resetRetry();
        if (storage.get('deliveryError')) storage.delete('deliveryError');
      }
    } catch (error) {
      const detail = error.response?.data;
      const reason = detail?.code && detail?.msg ? `飞书 ${detail.code} · ${detail.msg}` : error.message;
      if (!disposed) {
        storage.set('deliveryError', reason);
        if (startedOn === connectionGeneration) scheduleRetry();
      }
    } finally {
      sending.delete(reply.messageId);
      // A reconnect may have occurred while the old request still awaited its receipt.
      if (!disposed && startedOn !== connectionGeneration) flush();
    }
  }
  function flush() {
    if (storage.get('connection') !== 'connected') return;
    for (const reply of storage.get('pendingReplies') ?? []) {
      if (sending.has(reply.messageId)) continue;
      sending.add(reply.messageId);
      void deliver(reply);
    }
  }
  function configure() {
    const config = storage.get('settings');
    const changing = config?.enabled && storage.get('petActive') ? transport.start(config) : transport.stop();
    void changing.catch(error => { if (!disposed) storage.set('connection', error.message); });
  }
  storage.set('petActive', false);
  const unsubscribe = storage.subscribe(key => {
    if (key === 'settings' || key === 'petActive') configure();
    if (key.startsWith('reply.')) {
      const reply = storage.get(key);
      if (!reply) return;
      const queued = storage.get('pendingReplies') ?? [];
      if (!queued.some(item => item.messageId === reply.messageId)) storage.set('pendingReplies', [...queued, reply]);
      storage.delete(key);
      flush();
    }
  });
  return () => { disposed = true; resetRetry(); unsubscribe(); void transport.stop(); };
}
