import { Readable } from 'node:stream';
import { it, expect, vi } from 'vitest';
import { LarkChannel } from '@larksuiteoapi/node-sdk';
import { startService } from './main.mjs';
import { feishuPlugin } from './index.tsx';

it('dispatches two adjacent raw private messages as distinct turns', async () => {
  let dispatcher;
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64');
  const download = vi.fn(async () => ({ getReadableStream: () => Readable.from([bytes]) }));
  vi.spyOn(LarkChannel.prototype, 'fetchBotIdentity').mockResolvedValue({ openId: 'ou_bot', name: 'bot' });
  vi.spyOn(LarkChannel.prototype, 'connectWebSocket').mockImplementation(async function () { dispatcher = this.dispatcher;
    vi.spyOn(this.rawClient.im.messageResource, 'get').mockImplementation(download);
    vi.spyOn(this.rawClient.application.applicationCollaborators, 'get').mockResolvedValue({ code: 0, data: { collaborators: [{ user_id: 'ou_sender', type: 'owner' }, { user_id: 'ou_dev', type: 'developer' }] } }); });
  const listeners = new Set();
  const values = new Map([['settings', { enabled: true, appId: 'app', appSecret: 'test' }]]);
  const storage = {
    get: key => values.get(key),
    getTransient: key => values.get(`transient:${key}`),
    deleteTransient: key => values.delete(`transient:${key}`),
    delete: key => values.delete(key),
    setTransient: (key, value) => values.set(`transient:${key}`, value),
    set(key, value) { values.set(key, value); listeners.forEach(fn => fn(key)); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  const stop = startService(storage);
  const sendText = vi.fn(() => ({ accepted: true }));
  const disposers = [];
  try {
    await feishuPlugin.activate({ storage, windowKind: 'pet', subscriptions: { add: fn => disposers.push(fn) }, host: { ai: { openChannel: () => ({ sendText, dispose() {}, onResponse: () => () => {} }) } } });
    await vi.waitFor(() => expect(storage.get('connection')).toBe('connected'));
    for (const id of ['one', 'two', 'two', 'three']) {
      await dispatcher.invoke({ schema: '2.0', header: { event_type: 'im.message.receive_v1', event_id: `event_${id}` }, event: {
        sender: { sender_type: 'user', sender_id: { open_id: id === 'one' ? 'ou_sender' : id === 'three' ? 'ou_dev' : 'ou_guest' } },
        message: { message_id: `om_${id}`, chat_id: 'oc_chat', chat_type: 'p2p', message_type: 'text', create_time: String(Date.now()), content: JSON.stringify({ text: id }) },
      } }, { needCheck: false });
    }
    await vi.waitFor(() => expect(sendText.mock.calls.map(([request]) => [request.requestId, request.text])).toEqual([['feishu:om_one', 'one'], ['feishu:om_two', 'two'], ['feishu:om_three', 'three']]));
    expect(sendText.mock.calls[0][0].personalMemory).toEqual({ userText: 'one' });
    expect(sendText.mock.calls[1][0].personalMemory).toBeUndefined();
    expect(sendText.mock.calls[2][0].personalMemory).toBeUndefined();
    expect(sendText.mock.calls.map(([turn]) => turn.isOwner)).toEqual([true, false, false]);
    await dispatcher.invoke({ schema: '2.0', header: { event_type: 'im.message.receive_v1', event_id: 'event_image' }, event: {
      sender: { sender_type: 'user', sender_id: { open_id: 'ou_guest' } },
      message: { message_id: 'om_photo', chat_id: 'oc_chat', chat_type: 'p2p', message_type: 'image',
        create_time: String(Date.now()), content: JSON.stringify({ image_key: 'img_test' }) },
    } }, { needCheck: false });
    await vi.waitFor(() => expect(sendText.mock.lastCall[0]).toMatchObject({ requestId: 'feishu:om_photo', images: [`data:image/png;base64,${bytes.toString('base64')}`] }));
    expect(download).toHaveBeenCalledWith({ path: { message_id: 'om_photo', file_key: 'img_test' }, params: { type: 'image' } });
    expect(JSON.stringify([...values])).not.toContain('base64');
  } finally {
    disposers.forEach(dispose => dispose()); stop(); vi.restoreAllMocks();
  }
});
