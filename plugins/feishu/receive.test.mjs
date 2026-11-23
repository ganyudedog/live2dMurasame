import { it, expect, vi } from 'vitest';
import { LarkChannel } from '@larksuiteoapi/node-sdk';
import { startService } from './main.mjs';
import { feishuPlugin } from './index';

it('dispatches two adjacent raw private messages as distinct turns', async () => {
  let dispatcher;
  vi.spyOn(LarkChannel.prototype, 'fetchBotIdentity').mockResolvedValue({ openId: 'ou_bot', name: 'bot' });
  vi.spyOn(LarkChannel.prototype, 'connectWebSocket').mockImplementation(async function () { dispatcher = this.dispatcher; });
  const listeners = new Set();
  const values = new Map([['settings', { enabled: true, appId: 'app', appSecret: 'test' }]]);
  const storage = {
    get: key => values.get(key),
    set(key, value) { values.set(key, value); listeners.forEach(fn => fn(key)); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const stop = startService(storage);
  const sendText = vi.fn(() => ({ accepted: true }));
  const disposers = [];
  try {
    await feishuPlugin.activate({ storage, windowKind: 'pet', subscriptions: { add: fn => disposers.push(fn) }, host: { ai: { openChannel: () => ({ sendText, dispose() {}, onResponse: () => () => {} }) } } });
    await vi.waitFor(() => expect(storage.get('connection')).toBe('connected'));
    for (const id of ['one', 'two', 'two']) {
      await dispatcher.invoke({ schema: '2.0', header: { event_type: 'im.message.receive_v1', event_id: `event_${id}` }, event: {
        sender: { sender_type: 'user', sender_id: { open_id: 'ou_sender' } },
        message: { message_id: `om_${id}`, chat_id: 'oc_chat', chat_type: 'p2p', message_type: 'text', create_time: String(Date.now()), content: JSON.stringify({ text: id }) },
      } }, { needCheck: false });
    }
    await vi.waitFor(() => expect(sendText.mock.calls.map(([request]) => [request.requestId, request.text])).toEqual([['feishu:om_one', 'one'], ['feishu:om_two', 'two']]));
  } finally {
    disposers.forEach(dispose => dispose()); stop(); vi.restoreAllMocks();
  }
});
