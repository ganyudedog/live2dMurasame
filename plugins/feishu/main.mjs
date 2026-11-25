import { checkImageCount, imageFromBase64, MAX_IMAGE_BYTES } from '../../shared/ai/turnImages.js';
import { createHash } from 'node:crypto';
import { LarkChannel } from '@larksuiteoapi/node-sdk';

async function messageImages(channel, messageId, resources) {
  checkImageCount(resources.length);
  const images = [];
  for (const resource of resources) {
    const response = await channel.rawClient.im.messageResource.get({
      path: { message_id: messageId, file_key: resource.fileKey }, params: { type: 'image' },
    });
    const chunks = [];
    let size = 0;
    for await (const chunk of response.getReadableStream()) {
      size += chunk.length;
      if (size > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 5 MB');
      chunks.push(chunk);
    }
    images.push(imageFromBase64(Buffer.concat(chunks).toString('base64'), response.headers?.['content-type']?.split(';')[0]));
  }
  return images;
}

const createTransport = (emit, report) => {
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
        safety: { batch: { text: { maxMessages: 1 }, media: { maxItems: 1 } } },
      });
      const previous = channel;
      channel = next;
      status('connecting');
      if (previous) await previous.disconnect();
      if (channel !== next) return;
      next.on('message', async message => {
        const resources = (message.resources ?? []).filter(item => item.type === 'image');
        const text = message.content?.trim() || (resources.length ? `[附有 ${resources.length} 张图片]` : '');
        if (channel !== next || !text || !message.chatId || !message.messageId || !message.senderId) return;
        if (message.chatType !== 'p2p' && !message.mentionedBot) return;
        let role;
        if (message.senderId.startsWith('ou_')) {
          try {
            const roles = await next.rawClient.application.applicationCollaborators.get({
              path: { app_id: appId }, params: { user_id_type: 'open_id' },
            });
            if (roles.code === 0) role = roles.data?.collaborators?.find(member => member.user_id === message.senderId)?.type;
          } catch { /* Unverified roles use ordinary member permissions. */ }
        }
        if (channel !== next) return;
        let images, imageError;
        if (resources.length) {
          try { images = await messageImages(next, message.messageId, resources); }
          catch { imageError = '图片读取失败。本轮最多 4 张，每张不超过 5 MB，请重新发送。'; }
        }
        if (channel !== next) return;
        const isOwner = role === 'owner';
        emit('message', {
          images, imageError, isOwner, isDeveloper: role === 'developer',
          ...(isOwner && message.rawContentType === 'text' ? { userText: text } : {}),
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
      next.on('reconnecting', () => {
        if (channel !== next) return;
        status('reconnecting');
        report('connection.reconnecting', {}, false);
      });
      next.on('reconnected', () => {
        if (channel !== next) return;
        status('connected');
        report('connection.reconnected', {}, false);
      });
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

export function startService(storage, report = () => {}) {
  const sending = new Set();
  const attempts = new Map();
  const transientImages = new Set();
  function clearImages() {
    for (const key of transientImages) storage.deleteTransient(key);
    transientImages.clear();
  }
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
      const { images, ...message } = payload;
      if (images?.length) {
        const imageKey = `images.${message.messageId}`;
        transientImages.add(imageKey);
        storage.setTransient(imageKey, images);
        message.imageCount = images.length;
      }
      storage.set(key, message);
    } else {
      resetRetry();
      storage.set('connection', payload.state);
      if (payload.state === 'connected') {
        connectionGeneration++;
        flush();
      }
    }
  }, report);
  async function deliver(reply) {
    const startedOn = connectionGeneration;
    try {
      const key = `message.${reply.messageId}`;
      if (!storage.get(key)?.replyMessageId) {
        const receipt = await transport.send({ replyTo: reply.messageId, text: reply.text });
        storage.set(key, { replyMessageId: receipt.messageId });
        const attempt = attempts.get(reply.messageId) ?? 0;
        attempts.delete(reply.messageId);
        report('delivery.succeeded', { messageId: reply.messageId, attempt }, false);
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
        const attempt = (attempts.get(reply.messageId) ?? 0) + 1;
        attempts.set(reply.messageId, attempt);
        report(attempt === 1 ? 'delivery.failed' : 'delivery.retry', { messageId: reply.messageId, reason, attempt }, true);
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
    void changing.catch(error => {
      if (disposed) return;
      storage.set('connection', error.message);
      report('connection.failed', { reason: error.message }, true);
    });
  }
  storage.set('petActive', false);
  const unsubscribe = storage.subscribe(key => {
    if (key === 'petActive' && !storage.get(key)) clearImages();
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
  return () => { disposed = true; resetRetry(); unsubscribe(); clearImages(); void transport.stop(); };
}
