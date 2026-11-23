import { describe, expect, it, vi } from 'vitest';
import { registerApp } from '@larksuiteoapi/node-sdk';
import { commands } from './cli.mjs';

vi.mock('@larksuiteoapi/node-sdk', () => ({ registerApp: vi.fn() }));
const create = commands.find(command => command.name === 'feishu.app.create').execute;
const args = { name: 'Demo', description: 'Example' };

describe('feishu.app.create', () => {
  it('publishes the authorization link and returns only the approved app ID', async () => {
    const storage = new Map([['settings', { enabled: true, appId: 'old' }]]);
    registerApp.mockImplementationOnce(async options => {
      expect(options.appPreset).toEqual({ name: 'Demo', desc: 'Example' });
      expect(options.createOnly).toBe(true);
      options.onQRCodeReady({ url: 'https://example.test/approve', expireIn: 60 });
      expect(storage.get('registrationApproval').url).toBe('https://example.test/approve');
      return { client_id: 'sample', client_secret: 'secret' };
    });
    await expect(create(args, {}, '1', { storage })).resolves.toEqual({ appId: 'sample' });
    expect(storage.get('settings')).toEqual({ enabled: true, appId: 'sample', appSecret: 'secret' });
    expect([...storage.keys()]).toEqual(['settings']);
    expect(storage.has('registrationApproval')).toBe(false);
  });
  it.each(['access_denied', 'expired_token'])('clears pending approval after %s', async code => {
    const storage = new Map();
    registerApp.mockImplementationOnce(async options => {
      options.onQRCodeReady({ url: 'https://example.test/approve', expireIn: 60 });
      throw Object.assign(new Error(), { code });
    });
    await expect(create(args, {}, '2', { storage })).rejects.toThrow(code === 'access_denied' ? /拒绝/ : /过期/);
    expect(storage.size).toBe(0);
  });
});

describe('feishu.docx.update', () => {
  const update = commands.find(command => command.name === 'feishu.docx.update').execute;
  const host = { storage: new Map([['settings', { appId: 'app', appSecret: 'secret' }]]) };
  it('converts a heading block into a text patch and preserves rich text elements', async () => {
    const elements = [{ text_run: { content: 'edited', text_element_style: { bold: true } } }];
    const block = { block_id: 'heading', parent_id: 'doc', block_type: 3, heading1: { elements, style: {} } };
    const fetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ code: 0, tenant_access_token: 'token' }))
      .mockResolvedValueOnce(Response.json({ code: 0, data: { block } }));
    try {
      await expect(update({ documentId: 'doc', block }, {}, '1', host)).resolves.toEqual({ block });
      const [url, init] = fetch.mock.calls[1];
      expect(url).toMatch(/\/documents\/doc\/blocks\/heading$/);
      expect(init.method).toBe('PATCH');
      expect(JSON.parse(init.body)).toEqual({ update_text_elements: { elements } });
    } finally { fetch.mockRestore(); }
  });
  it('rejects conflicting IDs and unsupported blocks before submission', async () => {
    const args = { documentId: 'doc', block: { block_id: 'table', table: {} } };
    await expect(update({ ...args, blockId: 'other' }, {}, '2', host)).rejects.toThrow(/不一致/);
    await expect(update(args, {}, '3', host)).rejects.toThrow(/文本元素/);
  });
});
