import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ userData: '', handlers: new Map() }));
vi.mock('electron', () => ({
  app: { isReady: () => true, getPath: () => runtime.userData },
  ipcMain: { handle: (channel, handler) => runtime.handlers.set(channel, handler) },
}));

import { JsonModelMemoryRepository } from '../../infrastructure/persistence/JsonModelMemoryRepository.js';
import { ModelEnvironmentService } from '../../modules/modelenv/application/ModelEnvironmentService.js';
import { getModelConfigDirFor } from '../../dao/configDao.js';
import { registerMemoryIpc } from './registerMemoryIpc.js';

let root;
let modelPath;
let broadcasts;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-ipc-'));
  runtime.userData = path.join(root, 'userData');
  runtime.handlers.clear();
  modelPath = path.join(root, 'model');
  fs.mkdirSync(modelPath, { recursive: true });
  broadcasts = [];
  const modelEnvironmentService = new ModelEnvironmentService({
    repository: {},
    memoryRepository: new JsonModelMemoryRepository(),
    log: {},
  });
  registerMemoryIpc({
    live2dEnvironmentService: { root: { currentModelPath: modelPath } },
    modelEnvironmentService,
    sendAll: (channel, payload) => broadcasts.push({ channel, payload }),
  });
});

afterEach(() => {
  runtime.handlers.clear();
  fs.rmSync(root, { recursive: true, force: true });
});

const invoke = (channel, payload = {}) => runtime.handlers.get(channel)(null, payload);

describe('model memory IPC persistence', () => {
  it('routes append, consolidation, core editing and action chat through ModelEnvironmentService to DAO files', () => {
    const initial = invoke('ddd:modelenv:memory:get');
    expect(initial.coreText).toContain('# 核心记忆');
    expect(invoke('ddd:modelenv:memory:append', {
      userText: '我偏好简洁回答', assistantText: '我记下了。', at: new Date(2026, 9, 20, 9).getTime(),
    }).state.conversationCount).toBe(1);
    expect(invoke('ddd:modelenv:memory:episodes:recall', {
      dates: ['2026-10-20'], query: '简洁回答', speaker: 'user',
    }).text).toContain('我偏好简洁回答');

    const consolidated = invoke('ddd:modelenv:memory:consolidate', {
      content: '# 核心记忆\n\n## 稳定偏好\n- 偏好简洁回答', processedThroughCount: 1,
    });
    expect(consolidated.coreText).toContain('偏好简洁回答');
    expect(consolidated.state.lastConsolidatedCount).toBe(1);

    invoke('ddd:modelenv:memory:update-core', { content: '# 核心记忆\n\n## 偏好\n- 使用日语语音' });
    invoke('ddd:modelenv:memory:action-chat:replace', { content: '### user\n\n请增加害羞反应' });
    expect(broadcasts.map(({ channel }) => channel)).toEqual([
      'ddd:modelenv:memory:changed',
      'ddd:modelenv:memory:changed',
      'ddd:modelenv:memory:changed',
    ]);
    const memoryDir = path.join(getModelConfigDirFor(modelPath), 'memory');
    expect(fs.readFileSync(path.join(memoryDir, 'MEMORY.md'), 'utf8'))
      .toContain('使用日语语音');
    const episodeDate = new Date(2026, 9, 20, 9).toLocaleDateString('sv-SE');
    expect(fs.readFileSync(path.join(memoryDir, 'episodes', `${episodeDate}.md`), 'utf8'))
      .toContain('我偏好简洁回答');
    expect(fs.readFileSync(path.join(memoryDir, 'action-catalog-chat.md'), 'utf8'))
      .toContain('请增加害羞反应');
  });
});
