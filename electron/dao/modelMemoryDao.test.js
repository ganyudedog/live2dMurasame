import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { isReady: () => true, getPath: () => runtime.userData } }));

import { getLegacyModelMemoryFilePathsFor, getModelConfigDirFor } from './configDao.js';
import {
  appendModelMemoryConversation,
  getModelMemoryEpisodeAgeBand,
  loadModelMemoryDocuments,
  recallModelMemoryEpisodes,
  replaceActionCatalogChat,
  saveModelMemoryConsolidation,
  updateModelMemoryCore,
} from './modelMemoryDao.js';

let root;
let modelPath;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'model-memory-'));
  runtime.userData = path.join(root, 'userData');
  modelPath = path.join(root, 'model');
  fs.mkdirSync(modelPath, { recursive: true });
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('Markdown model memory persistence', () => {
  it('appends daily episodes and exposes a bounded consolidation cursor', () => {
    let memory;
    for (let index = 1; index <= 9; index++) {
      memory = appendModelMemoryConversation(modelPath, {
        userText: `用户消息 ${index}`,
        assistantText: `角色回复 ${index}`,
        at: new Date(2026, 9, 20, 12, index).getTime(),
      });
    }
    expect(memory.state.conversationCount).toBe(9);
    expect(memory.pendingThroughCount).toBe(8);
    expect(memory.pendingEpisodeText).toContain('用户消息 1');
    expect(memory.pendingEpisodeText).not.toContain('用户消息 9');
    expect(memory.episodes).toHaveLength(0);
    expect(memory.episodeDates).toHaveLength(1);
    const recalled = recallModelMemoryEpisodes(modelPath, { dates: ['2026-10-20'], query: '用户消息 9' });
    expect(recalled.status).toBe('ok');
    expect(recalled.text).toContain('用户消息 9');

    const saved = saveModelMemoryConsolidation(modelPath, {
      content: '# 核心记忆\n\n## 稳定偏好\n- 喜欢简洁回答\n',
      processedThroughCount: 8,
    });
    expect(saved.state.lastConsolidatedCount).toBe(8);
    expect(saved.coreText).toContain('喜欢简洁回答');
    expect(saved.pendingThroughCount).toBe(9);
  });

  it('enforces the core memory size limits and replaces the action chat transcript', () => {
    expect(() => updateModelMemoryCore(modelPath, '字'.repeat(16000))).toThrow('30 KB');
    expect(() => updateModelMemoryCore(modelPath, Array.from({ length: 2000 }, () => 'x').join('\n'))).not.toThrow();
    expect(() => updateModelMemoryCore(modelPath, Array.from({ length: 2001 }, () => 'x').join('\n'))).toThrow('2000 行');
    const memory = replaceActionCatalogChat(modelPath, '### user\n\n生成一个自然的点头动作\n\n### assistant\n\n已更新动作表');
    expect(memory.actionCatalogChat).toContain('生成一个自然的点头动作');
    expect(memory.actionCatalogChat).toContain('已更新动作表');
    expect(fs.readFileSync(path.join(getModelConfigDirFor(modelPath), 'memory', 'action-catalog-chat.md'), 'utf8'))
      .toContain('# 动作表配置对话');
  });

  it('migrates legacy JSON memory once without creating empty legacy files', () => {
    const legacyPaths = getLegacyModelMemoryFilePathsFor(modelPath);
    fs.mkdirSync(legacyPaths.memoryDir, { recursive: true });
    fs.writeFileSync(legacyPaths.summaryPath, JSON.stringify({ summary: '用户喜欢日语语音', facts: ['不喜欢过度寒暄'], open_loops: [] }));
    fs.writeFileSync(legacyPaths.recentPath, JSON.stringify({ messages: [
      { role: 'user', text: '请记住我偏好日语语音', ts: new Date(2026, 9, 19, 8).getTime() },
    ] }));
    const memory = loadModelMemoryDocuments(modelPath);
    expect(memory.coreText).toContain('用户喜欢日语语音');
    const recalled = recallModelMemoryEpisodes(modelPath, { dates: ['2026-10-19'], query: '日语语音' });
    expect(recalled.text).toContain('请记住我偏好日语语音');
    expect(memory.state.legacyMigratedAt).toBeGreaterThan(0);
    expect(fs.existsSync(legacyPaths.metaPath)).toBe(false);
  });

  it('derives four retention age bands from episode dates', () => {
    const now = new Date(2026, 9, 20, 12).getTime();
    const date = (daysAgo) => {
      const value = new Date(now);
      value.setDate(value.getDate() - daysAgo);
      return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
    };
    expect(getModelMemoryEpisodeAgeBand(date(0), now)).toBe(1);
    expect(getModelMemoryEpisodeAgeBand(date(2), now)).toBe(3);
    expect(getModelMemoryEpisodeAgeBand(date(4), now)).toBe(5);
    expect(getModelMemoryEpisodeAgeBand(date(6), now)).toBe(7);
    expect(getModelMemoryEpisodeAgeBand(date(8), now)).toBeNull();
  });

  it('deletes episode files older than seven days', () => {
    appendModelMemoryConversation(modelPath, {
      userText: '七天以前的闲聊', assistantText: '已经过期。',
      at: new Date(2026, 9, 10, 12).getTime(),
    });
    const originalNow = Date.now;
    Date.now = () => new Date(2026, 9, 20, 12).getTime();
    try {
      const memory = loadModelMemoryDocuments(modelPath);
      expect(memory.episodeDates).toEqual([]);
      expect(fs.readdirSync(path.join(getModelConfigDirFor(modelPath), 'memory', 'episodes'))).toEqual([]);
    } finally {
      Date.now = originalNow;
    }
  });
});
