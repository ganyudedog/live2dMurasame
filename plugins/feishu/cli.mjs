import { registerApp } from '@larksuiteoapi/node-sdk';

import { startService } from './main.mjs';
let stopService;
export function activate(host) { stopService?.(); stopService = startService(host.storage, host.report); }
export function dispose() { stopService?.(); stopService = undefined; }

const API = 'https://open.feishu.cn/open-apis';
const getCredentials = async (host) => {
  const credentials = await host.storage.get('settings');
  if (!credentials?.appId || !credentials?.appSecret) throw new Error('飞书插件未配置 App ID 和 App Secret');
  return credentials;
};
const token = async (credentials) => {
  const response = await fetch(`${API}/auth/v3/tenant_access_token/internal`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret }) });
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw new Error(`飞书鉴权失败: ${body.msg ?? response.status}`);
  return body.tenant_access_token;
};
const request = async (credentials, path, init = {}) => {
  const accessToken = await token(credentials);
  const response = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
  const body = await response.json();
  if (!response.ok || body.code !== 0) throw Object.assign(new Error(`飞书接口失败 (${body.code ?? response.status}): ${body.msg ?? response.status}`), { code: body.code });
  return body.data ?? body;
};
let registering = false;
async function createApplication({ name, description }, _context, _invocationId, host) {
  if (_context.source === 'plugin:live2d.feishu') {
    const incoming = _context.requestId?.startsWith('feishu:') && host.storage.get(`message.${_context.requestId.slice(7)}`);
    if (!(incoming?.isOwner || incoming?.isDeveloper) || incoming.senderId !== _context.senderId || incoming.conversationId !== _context.conversationId) throw new Error('创建应用需要开发者身份');
  }
  if (registering) throw new Error('已有应用正在等待飞书授权');
  registering = true;
  try {
    const result = await registerApp({
      createOnly: true,
      appPreset: { name, desc: description },
      addons: { preset: false },
      onQRCodeReady({ url, expireIn }) {
        host.storage.set('registrationApproval', { name, url, expiresAt: Date.now() + expireIn * 1000 });
      },
    });
    host.storage.set('settings', { ...host.storage.get('settings'), appId: result.client_id, appSecret: result.client_secret });
    return { appId: result.client_id };
  } catch (error) {
    if (error?.code === 'access_denied') throw new Error('用户已拒绝创建飞书应用');
    if (error?.code === 'expired_token') throw new Error('飞书应用创建授权已过期');
    throw error;
  } finally {
    registering = false;
    host.storage.delete('registrationApproval');
  }
}
async function readDocument({ document, pageToken }, _context, _invocationId, host) {
  const credentials = await getCredentials(host);
  let documentId = document.trim();
  let wiki = false;
  if (!/^[a-zA-Z0-9]+$/.test(documentId)) {
    const url = new URL(documentId);
    const match = url.pathname.match(/^\/(wiki|docx)\/([a-zA-Z0-9]+)\/?$/);
    if (url.protocol !== 'https:' || !/(^|\.)(feishu\.cn|larksuite\.com)$/.test(url.hostname) || !match) throw new Error('请提供飞书 docx 或 wiki 链接或文档 ID');
    documentId = match[2];
    wiki = match[1] === 'wiki';
  }
  const params = new URLSearchParams({ page_size: '20' });
  if (pageToken) params.set('page_token', pageToken);
  const blocks = id => request(credentials, `/docx/v1/documents/${encodeURIComponent(id)}/blocks?${params}`);
  let page;
  try {
    page = await blocks(documentId);
  } catch (error) {
    if (!wiki || ![1770002, 1770004, 1770007, 1770032].includes(error.code)) throw error;
    const { node } = await request(credentials, `/wiki/v2/spaces/get_node?token=${documentId}`);
    if (node.obj_type !== 'docx') throw new Error(`该知识库节点的类型为 ${node.obj_type}`);
    documentId = node.obj_token;
    page = await blocks(documentId);
  }
  return { documentId, ...page };
}
async function updateDocument({ documentId, blockId, block }, _context, _invocationId, host) {
  const id = block.block_id;
  if (typeof id !== 'string' || !id.trim()) throw new Error('请传入读取结果中带 block_id 的完整块');
  if (blockId !== undefined && blockId !== id) throw new Error('blockId 与目标块的 block_id 不一致');
  const content = Object.entries(block).find(([key]) => /^(page|text|heading[1-9]|bullet|ordered|code|quote|todo)$/.test(key))?.[1];
  if (!Array.isArray(content?.elements)) throw new Error('该块没有可更新的文本元素');
  return request(await getCredentials(host), `/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ update_text_elements: { elements: content.elements } }),
  });
}
export const commands = [
  {
    name: 'feishu.docx.read', skill: 'feishu', description: '读取飞书文档链接或 ID，返回正文块和可用于编辑的 block_id。',
    instructions: '遇到飞书 docx 或 wiki 文档链接时，用 feishu.docx.read 读取目标。按需用 pageToken 翻页。只有用户明确要求修改时，才修改目标块 elements 中的文字，保留其余元素，然后把 documentId 和修改后的完整块传给 feishu.docx.update。',
    parameters: { type: 'object', required: ['document'], properties: { document: { type: 'string' }, pageToken: { type: 'string' } }, additionalProperties: false },
    execute: readDocument,
  },
  {
    name: 'feishu.docx.update', skill: 'feishu', description: '更新已读取文档块的文本元素。传入 documentId 和修改后的完整块。',
    parameters: { type: 'object', required: ['documentId', 'block'], properties: {
      documentId: { type: 'string' }, blockId: { type: 'string', description: '可省略，若提供须与 block.block_id 一致' },
      block: { type: 'object', description: 'feishu.docx.read 返回的一个完整文本类块，保留 block_id 和修改后的 elements' },
    }, additionalProperties: false },
    execute: updateDocument,
  },
  { name: 'feishu.app.create', skill: 'feishu', description: '调用飞书开放平台创建应用', parameters: { type: 'object', required: ['name', 'description'], properties: { name: { type: 'string' }, description: { type: 'string' } }, additionalProperties: false }, execute: createApplication },
];
