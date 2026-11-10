import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acceptRelationshipProposals,
  applyManualAdjustment,
  evaluateRelationshipGrowth,
  migrateRelationship,
  normalizeStoredRelationship,
  recordInteractionDay,
  toPublicRelationship,
  type GrowthThreshold,
} from '../modules/modelenv/domain/relationship.js';
import { getModelConfigDirFor } from './configDao.js';
import {
  adjustModelMemoryRelationship,
  appendModelMemoryConversation,
  loadModelMemoryDocuments,
  loadRecentModelMemoryTurns,
  saveModelMemoryConsolidation,
  updateModelMemoryCore,
} from './modelMemoryDao.js';

const runtime = vi.hoisted(() => ({ userData: '' }));
vi.mock('electron', () => ({ app: { isReady: () => true, getPath: () => runtime.userData } }));

const at = (day: string) => Date.parse(`${day}T04:00:00.000Z`);
const shift = (day: string, count: number) => new Date(at(day) + count * 86400000).toISOString().slice(0, 10);
const rule = (minInteractionDays: number, minExperiences: number, minStageAgeDays: number): GrowthThreshold => ({
  minInteractionDays, minExperiences, minStageAgeDays,
});
const easy = {
  疏远: rule(1, 1, 0), 认识: rule(1, 1, 0), 亲近: rule(1, 1, 0), 信赖: rule(1, 1, 0), 亲密: null,
};
const zero = {
  疏远: rule(0, 0, 0), 认识: rule(0, 0, 0), 亲近: rule(0, 0, 0), 信赖: rule(0, 0, 0), 亲密: null,
};

let root!: string;
let modelPath!: string;
const originalNow = Date.now;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'relationship-growth-'));
  runtime.userData = path.join(root, 'userData');
  modelPath = path.join(root, 'model');
  fs.mkdirSync(modelPath, { recursive: true });
});

afterEach(() => {
  Date.now = originalNow;
  fs.rmSync(root, { recursive: true, force: true });
});

const memoryDir = () => path.join(getModelConfigDirFor(modelPath), 'memory');
const rewriteCore = (core: string) => {
  loadModelMemoryDocuments(modelPath);
  const statePath = path.join(memoryDir(), 'state.json');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
  delete state.relationship;
  fs.writeFileSync(statePath, JSON.stringify(state));
  fs.writeFileSync(path.join(memoryDir(), 'MEMORY.md'), core);
};

describe('relationship growth rules', () => {
  it('drops legacy audit history while preserving evidence deduplication', () => {
    const state = normalizeStoredRelationship({
      ...migrateRelationship('', at('2026-11-01')),
      events: [
        { kind: 'shared-experience', experienceId: 'e11111111', excerpt: '一起看过西湖', reason: '旧记录' },
        { kind: 'evidence-rejected', reason: '不再保存' },
      ],
    })!;
    expect(state).not.toHaveProperty('events');
    expect(toPublicRelationship(state)).not.toHaveProperty('events');
    expect(state.knownExperiences).toEqual([{ id: 'e11111111', excerpt: '一起看过西湖' }]);
    const replayed = acceptRelationshipProposals(state, [
      { kind: 'shared-experience', summary: '一起看过西湖' },
    ], {
      priorMemory: '一起看过西湖',
      candidateTurns: [{ conversationCount: 2, userText: '今天又聊起一起看过西湖' }],
    });
    expect(replayed.progress.experiences).toEqual([]);
    expect(replayed.revision).toBe(state.revision);
  });

  it('advances only one stage when every gate is open, then keeps growing after a manual change', () => {
    let state = migrateRelationship('', at('2026-11-01'));
    const jumped = evaluateRelationshipGrowth(state, at('2026-11-01'), zero);
    expect(jumped.stage).toBe('信赖');
    expect(jumped.progress.interactionDays).toEqual([]);

    state = recordInteractionDay(state, at('2026-11-01'));
    state = recordInteractionDay(state, at('2026-11-01'));
    expect(state.progress.interactionDays).toEqual(['2026-11-01']);
    state = acceptRelationshipProposals(state, [
      { kind: 'shared-experience', experienceId: 'lake', summary: '一起看过西湖' },
      { kind: 'stage-change', stage: '亲密' },
      { kind: 'shared-experience', experienceId: 'mars', summary: '火星基地' },
    ], {
      priorMemory: '一起看过西湖',
      candidateTurns: [{ conversationCount: 2, userText: '我们又说起一起看过西湖' }],
    });
    expect(state.progress.experiences).toHaveLength(1);
    expect(state.progress.experiences[0]?.id).not.toBe('lake');
    const growing = evaluateRelationshipGrowth(state, at('2026-11-02'), easy);
    expect(growing.stage).toBe('信赖');
    expect(growing.stage).not.toBe('亲密');

    const adjusted = applyManualAdjustment(state, {
      expectedRevision: state.revision, stage: '认识', conversationCount: 4,
    }, at('2026-11-02'));
    expect(adjusted.changed).toBe(true);
    expect(adjusted.relationship.stage).toBe('认识');
    expect(adjusted.relationship.progress.experiences).toEqual([]);
    expect(adjusted.relationship.evidenceAfterCount).toBe(4);
    expect(adjusted.relationship.knownExperiences.some((item) => item.excerpt.includes('一起看过西湖'))).toBe(true);
    const stale = acceptRelationshipProposals(adjusted.relationship, [
      { kind: 'shared-experience', summary: '一起修过灯' },
    ], {
      priorMemory: '一起修过灯',
      candidateTurns: [{ conversationCount: 4, userText: '我们又说起一起修过灯' }],
    });
    expect(stale.progress.experiences).toEqual([]);
    let resumed = recordInteractionDay(adjusted.relationship, at('2026-11-03'));
    resumed = acceptRelationshipProposals(resumed, [
      { kind: 'shared-experience', summary: '一起修过灯' },
    ], {
      priorMemory: '一起修过灯',
      candidateTurns: [{ conversationCount: 5, userText: '我们又说起一起修过灯' }],
    });
    expect(resumed.progress.experiences).toHaveLength(1);
    expect(evaluateRelationshipGrowth(resumed, at('2026-11-03'), easy).stage).toBe('亲近');
  });

  it('requires the stage to be old enough and does not decay or downgrade', () => {
    let state = migrateRelationship('## 当前关系\n- 阶段：信赖。可以提起那次。', at('2026-11-01'));
    state = recordInteractionDay(state, at('2026-11-01'));
    const gated = {
      疏远: rule(1, 0, 2), 认识: rule(1, 0, 2), 亲近: rule(1, 0, 2), 信赖: rule(1, 0, 2), 亲密: null,
    };
    expect(evaluateRelationshipGrowth(state, at('2026-11-02'), gated).stage).toBe('信赖');
    expect(evaluateRelationshipGrowth(state, at('2026-11-03'), gated).stage).toBe('亲密');
    const later = evaluateRelationshipGrowth(state, at('2027-05-01'));
    expect(later.stage).toBe('信赖');
    expect(later.progress.interactionDays).toEqual(['2026-11-01']);
  });

  it('changes stage from the revision alone and loads a fixed record without resetting evidence', () => {
    const migrated = migrateRelationship('## 当前关系\n- 阶段：信赖。可以提起那次修灯。', at('2026-11-01'));
    expect(JSON.stringify(normalizeStoredRelationship(JSON.parse(JSON.stringify(migrated)))))
      .toBe(JSON.stringify(migrated));
    expect(migrated.progress.interactionDays).toEqual([]);
    const adjusted = applyManualAdjustment(migrated, {
      expectedRevision: migrated.revision, stage: '疏远', conversationCount: 4,
    }, at('2026-11-02'));
    expect(adjusted.changed).toBe(true);
    expect(adjusted.relationship.stage).toBe('疏远');
    expect(adjusted.relationship.line).toContain('阶段：疏远');
    expect(adjusted.relationship.progress.interactionDays).toEqual([]);
    expect(adjusted.relationship.evidenceAfterCount).toBe(4);
    expect(adjusted.relationship).not.toHaveProperty('events');
    expect(adjusted.relationship).not.toHaveProperty('mode');
    expect(adjusted.relationship).not.toHaveProperty('manualCheckpoint');
    expect(toPublicRelationship(adjusted.relationship)).not.toHaveProperty('undoAvailable');
    expect(toPublicRelationship(adjusted.relationship)).not.toHaveProperty('mode');
    expect(() => applyManualAdjustment(adjusted.relationship, {
      expectedRevision: migrated.revision, stage: '亲近',
    }, at('2026-11-03'))).toThrow(/revision conflict/);

    const legacy = normalizeStoredRelationship({
      version: 1,
      stage: '信赖',
      mode: 'fixed',
      revision: 5,
      stageChangedAt: at('2026-10-01'),
      needsSelection: false,
      legacyText: '',
      line: '阶段：信赖。可以提起那次修灯。',
      progress: {
        interactionDays: ['2026-10-02'],
        experiences: [{ id: 'e11111111', summary: '一起看过西湖' }],
      },
      evidenceAfterCount: 3,
      knownExperiences: [{ id: 'e11111111', excerpt: '一起看过西湖' }],
      events: [{
        id: 'migration:1', at: at('2026-10-01'), kind: 'migration', source: 'migration', stage: '信赖',
        mode: 'fixed', fromMode: 'growth', reason: '沿用记忆里已经写下的阶段。', revision: 1,
      }],
      manualCheckpoint: {
        revision: 5,
        previous: { stage: '亲近', mode: 'growth', progress: { interactionDays: ['2026-09-01'], experiences: [] } },
      },
    });
    expect(legacy?.stage).toBe('信赖');
    expect(legacy?.revision).toBe(5);
    expect(legacy?.progress.interactionDays).toEqual(['2026-10-02']);
    expect(legacy?.progress.experiences).toEqual([{ id: 'e11111111', summary: '一起看过西湖' }]);
    expect(legacy?.evidenceAfterCount).toBe(3);
    expect(legacy?.knownExperiences).toEqual([{ id: 'e11111111', excerpt: '一起看过西湖' }]);
    expect(legacy).not.toHaveProperty('events');
    expect(legacy).not.toHaveProperty('mode');
    expect(legacy).not.toHaveProperty('manualCheckpoint');
    expect(evaluateRelationshipGrowth(legacy!, at('2026-12-01'), easy).stage).toBe('亲密');
  });
});

describe('desktop relationship persistence', () => {
  it('migrates a known stage without inventing progress and keeps an unknown stage for selection', () => {
    rewriteCore('## 当前关系\n- 阶段：信赖。可以提起那次修灯。\n\n# 核心记忆\n- 喜欢茶\n');
    const known = loadModelMemoryDocuments(modelPath);
    expect(known.relationship?.stage).toBe('信赖');
    expect(known.relationship?.line).toContain('修灯');
    expect(known.relationship?.progress.interactionDays).toEqual([]);
    expect(known.relationship?.progress.experiences).toEqual([]);
    expect(known.coreText).toContain('喜欢茶');
    const again = loadModelMemoryDocuments(modelPath);
    expect(again.relationship?.revision).toBe(known.relationship?.revision);
    expect(again.relationship?.stage).toBe('信赖');

    rewriteCore('## 当前关系\n- 阶段：讨厌。别说话。\n\n# 核心记忆\n- 喜欢茶\n');
    const unknown = loadModelMemoryDocuments(modelPath);
    expect(unknown.relationship?.needsSelection).toBe(true);
    expect(unknown.relationship?.stage).toBe('');
    expect(unknown.relationship?.legacyText).toContain('别说话');
    expect(unknown.coreText).toContain('别说话');
    expect(unknown.coreText).not.toContain('阶段：亲近');
    expect(unknown.relationship?.progress.interactionDays).toEqual([]);
  });

  it('counts one meaningful desktop day, ignores greetings, and ignores QQ archives', () => {
    Date.now = () => at('2026-11-07');
    const initial = loadModelMemoryDocuments(modelPath);
    appendModelMemoryConversation(modelPath, { userText: '你好', assistantText: '在的。', at: at('2026-11-07') });
    expect(loadModelMemoryDocuments(modelPath).relationship?.progress.interactionDays).toEqual([]);
    appendModelMemoryConversation(modelPath, { userText: '今天认真聊了安排', assistantText: '我记下了。', at: at('2026-11-07') });
    appendModelMemoryConversation(modelPath, { userText: '今天再认真聊一会儿安排', assistantText: '还在。', at: at('2026-11-07') });
    const counted = loadModelMemoryDocuments(modelPath);
    expect(counted.relationship?.progress.interactionDays).toEqual(['2026-11-07']);
    appendModelMemoryConversation(modelPath, {
      archive: { platform: 'qq', scope: 'group', id: 'room' },
      userText: '今天在群里认真聊了很久的安排', assistantText: '群里的回复。', at: at('2026-11-08'),
    });
    const afterArchive = loadModelMemoryDocuments(modelPath);
    expect(afterArchive.relationship?.revision).toBe(counted.relationship?.revision);
    expect(afterArchive.relationship?.progress.interactionDays).toEqual(['2026-11-07']);
    expect(afterArchive.state.conversationCount).toBe(counted.state.conversationCount);
    expect(initial.relationship?.stage).toBe('亲近');
  });

  it('rejects a stale revision and keeps growing after the manual stage change', () => {
    rewriteCore('## 当前关系\n- 阶段：信赖。可以提起那次修灯。\n\n# 核心记忆\n');
    const current = loadModelMemoryDocuments(modelPath);
    const revision = current.relationship?.revision ?? 0;
    expect(() => adjustModelMemoryRelationship(modelPath, {
      expectedRevision: revision - 1, stage: '亲密', mode: 'fixed', reason: '不会写进去',
    })).toThrow(/revision conflict/);
    expect(loadModelMemoryDocuments(modelPath).relationship?.stage).toBe('信赖');
    adjustModelMemoryRelationship(modelPath, {
      expectedRevision: revision, stage: '疏远', mode: 'fixed', reason: '先拉开一点',
    });
    const adjusted = loadModelMemoryDocuments(modelPath);
    expect(adjusted.relationship?.stage).toBe('疏远');
    expect(adjusted.relationship?.line).toContain('阶段：疏远');
    expect(adjusted.relationship).not.toHaveProperty('events');
    expect(adjusted.relationship).not.toHaveProperty('mode');
    expect(adjusted.relationship).not.toHaveProperty('undoAvailable');
    expect(adjusted.relationship?.progress.interactionDays).toEqual([]);
    const disk = JSON.parse(fs.readFileSync(path.join(memoryDir(), 'state.json'), 'utf8')) as {
      relationship: { mode?: string; manualCheckpoint?: unknown; stage: string };
    };
    expect(disk.relationship.stage).toBe('疏远');
    expect(disk.relationship.mode).toBeUndefined();
    expect(disk.relationship.manualCheckpoint).toBeUndefined();

    Date.now = () => at('2026-11-08');
    appendModelMemoryConversation(modelPath, { userText: '今天认真聊了安排', assistantText: '我记下了。', at: at('2026-11-08') });
    const counted = loadModelMemoryDocuments(modelPath);
    expect(counted.relationship?.stage).toBe('疏远');
    expect(counted.relationship?.progress.interactionDays).toEqual(['2026-11-08']);
    const stored = normalizeStoredRelationship(JSON.parse(fs.readFileSync(path.join(memoryDir(), 'state.json'), 'utf8')).relationship);
    const resumed = acceptRelationshipProposals(stored!, [
      { kind: 'shared-experience', summary: '一起修过灯' },
    ], {
      priorMemory: '一起修过灯',
      candidateTurns: [{
        conversationCount: counted.state.conversationCount + 1,
        userText: '今天又说起一起修过灯',
      }],
    });
    expect(resumed.progress.experiences).toHaveLength(1);
    expect(evaluateRelationshipGrowth(resumed, at('2026-11-08'), easy).stage).toBe('认识');
  });

  it('loads a persisted fixed relationship into automatic growth without resetting its evidence', () => {
    loadModelMemoryDocuments(modelPath);
    const statePath = path.join(memoryDir(), 'state.json');
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    state.relationship = {
      version: 1,
      stage: '信赖',
      mode: 'fixed',
      revision: 6,
      stageChangedAt: at('2026-10-01'),
      needsSelection: false,
      legacyText: '',
      line: '阶段：信赖。可以提起那次修灯。',
      progress: {
        interactionDays: ['2026-10-02', '2026-10-03'],
        experiences: [{ id: 'e33333333', summary: '一起修过灯' }],
      },
      evidenceAfterCount: 4,
      knownExperiences: [{ id: 'e33333333', excerpt: '一起修过灯' }],
      events: [{
        id: 'migration:1', at: at('2026-10-01'), kind: 'migration', source: 'migration', stage: '信赖',
        mode: 'fixed', fromMode: 'growth', reason: '沿用记忆里已经写下的阶段。', revision: 1,
      }],
      manualCheckpoint: { revision: 6, previous: { stage: '亲近', mode: 'growth' } },
    };
    fs.writeFileSync(statePath, JSON.stringify(state));
    fs.writeFileSync(path.join(memoryDir(), 'MEMORY.md'), '# 核心记忆\n- 喜欢茶\n');
    const loaded = loadModelMemoryDocuments(modelPath);
    expect(loaded.relationship?.stage).toBe('信赖');
    expect(loaded.relationship?.line).toContain('修灯');
    expect(loaded.relationship?.progress.interactionDays).toEqual(['2026-10-02', '2026-10-03']);
    expect(loaded.relationship?.progress.experiences).toEqual([{ id: 'e33333333', summary: '一起修过灯' }]);
    expect(loaded.relationship?.evidenceAfterCount).toBe(4);
    expect(loaded.relationship?.knownExperiences).toEqual([{ id: 'e33333333', excerpt: '一起修过灯' }]);
    expect(loaded.relationship).not.toHaveProperty('mode');
    expect(loaded.relationship).not.toHaveProperty('undoAvailable');
    expect(loaded.relationship).not.toHaveProperty('manualCheckpoint');
    expect(loaded.coreText).toContain('喜欢茶');
    const rewritten = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      relationship: {
        mode?: string;
        manualCheckpoint?: unknown;
        progress: { interactionDays: string[] };
      };
    };
    expect(rewritten.relationship).not.toHaveProperty('events');
    expect(rewritten.relationship.mode).toBeUndefined();
    expect(rewritten.relationship.manualCheckpoint).toBeUndefined();
    expect(rewritten.relationship.progress.interactionDays).toEqual(['2026-10-02', '2026-10-03']);
    const grown = normalizeStoredRelationship(rewritten.relationship);
    expect(evaluateRelationshipGrowth(grown!, at('2026-12-01'), easy).stage).toBe('亲密');
  });

  it('does not let an in-flight consolidation replace a manual stage or accept invented evidence', () => {
    const current = loadModelMemoryDocuments(modelPath);
    adjustModelMemoryRelationship(modelPath, {
      expectedRevision: current.relationship?.revision, stage: '信赖',
    });
    updateModelMemoryCore(modelPath, '# 核心记忆\n\n## 经历\n- 一起看过西湖\n');
    appendModelMemoryConversation(modelPath, {
      userText: '今天又聊起一起看过西湖', assistantText: '那次很安静。', at: Date.now(),
    });
    const pending = loadModelMemoryDocuments(modelPath);
    expect(pending.pendingEpisodeText).toContain('今天又聊起一起看过西湖');
    expect(pending.relationship?.progress.interactionDays).toHaveLength(1);
    expect(loadRecentModelMemoryTurns(modelPath).turns.at(-1)?.userText).toBe('今天又聊起一起看过西湖');
    const saved = saveModelMemoryConsolidation(modelPath, {
      content: '## 当前关系\n- 阶段：亲密。我们在一起。\n\n# 核心记忆\n\n## 经历\n- 一起看过西湖\n',
      processedThroughCount: pending.pendingThroughCount,
      relationshipEvents: [
        { kind: 'stage-change', stage: '亲密' },
        { kind: 'shared-experience', experienceId: 'fake', summary: '火星基地', stage: '亲密' },
        { kind: 'shared-experience', experienceId: 'lake', summary: '一起看过西湖' },
      ],
    });
    expect(saved.relationship?.stage).toBe('信赖');
    expect(saved.coreText).toContain('阶段：信赖');
    expect(saved.coreText).not.toContain('阶段：亲密');
    expect(saved.coreText).toContain('一起看过西湖');
    expect(saved.relationship?.progress.experiences).toHaveLength(1);
    expect(saved.relationship?.progress.experiences[0]?.id).not.toBe('lake');
    expect(saved.relationship?.stage).not.toBe('亲密');
  });

  it('advances one desktop stage only after days, experiences and age all pass', () => {
    Date.now = () => at('2026-11-01');
    loadModelMemoryDocuments(modelPath);
    updateModelMemoryCore(modelPath, '# 核心记忆\n\n## 经历\n- 一起看过西湖\n- 一起修过灯\n- 一起听过雨\n');
    for (let index = 0; index < 4; index += 1) {
      const day = shift('2026-11-01', index);
      Date.now = () => at(day);
      appendModelMemoryConversation(modelPath, {
        userText: index === 3
          ? '今天又聊起一起看过西湖，也聊起一起修过灯，还聊起一起听过雨'
          : `今天认真聊了 ${day} 的安排`,
        assistantText: '我记下了。',
        at: at(day),
      });
    }
    const before = loadModelMemoryDocuments(modelPath);
    const consolidated = saveModelMemoryConsolidation(modelPath, {
      content: '# 核心记忆\n\n## 经历\n- 一起看过西湖\n- 一起修过灯\n- 一起听过雨\n',
      processedThroughCount: before.pendingThroughCount,
      relationshipEvents: [
        { kind: 'shared-experience', experienceId: 'lake', summary: '一起看过西湖' },
        { kind: 'shared-experience', experienceId: 'lamp', summary: '一起修过灯' },
        { kind: 'shared-experience', experienceId: 'rain', summary: '一起听过雨' },
      ],
    });
    expect(consolidated.relationship?.stage).toBe('亲近');
    expect(consolidated.relationship?.progress.experiences).toHaveLength(3);
    expect(consolidated.relationship?.progress.interactionDays).toHaveLength(4);
    Date.now = () => at('2026-11-05');
    const advanced = appendModelMemoryConversation(modelPath, {
      userText: '今天认真聊了后面的安排', assistantText: '我记下了。', at: at('2026-11-05'),
    });
    expect(advanced.relationship?.stage).toBe('信赖');
    expect(advanced.relationship?.stage).not.toBe('亲密');
    expect(advanced.relationship?.progress.interactionDays).toEqual([]);
    expect(advanced.relationship?.evidenceAfterCount).toBe(advanced.state.conversationCount);
    expect(advanced.coreText).toContain('阶段：信赖');
    expect(advanced.coreText).toContain('也会主动关心');
  });

  it('requires a prior user revisit inside the cursor and does not replay that evidence', () => {
    updateModelMemoryCore(modelPath, '# 核心记忆\n\n## 经历\n- 一起看过西湖\n- 一起修过灯\n');
    appendModelMemoryConversation(modelPath, {
      conversationId: 'assist-only', userText: '今天认真聊了安排', assistantText: '你说过一起看过西湖', at: at('2026-11-07'),
    });
    const assistantOnly = saveModelMemoryConsolidation(modelPath, {
      content: '# 核心记忆\n\n## 经历\n- 一起看过西湖\n- 一起修过灯\n',
      processedThroughCount: 1,
      relationshipEvents: [{ kind: 'shared-experience', experienceId: 'lake', summary: '一起看过西湖' }],
    });
    expect(assistantOnly.relationship?.progress.experiences).toEqual([]);

    appendModelMemoryConversation(modelPath, {
      conversationId: 'future-turn', userText: '今天又聊起一起看过西湖', assistantText: '那次很安静。', at: at('2026-11-08'),
    });
    const beyondCursor = saveModelMemoryConsolidation(modelPath, {
      content: '# 核心记忆\n\n## 经历\n- 一起看过西湖\n- 一起修过灯\n',
      processedThroughCount: 1,
      relationshipEvents: [{ kind: 'shared-experience', experienceId: 'later', summary: '一起看过西湖' }],
    });
    expect(beyondCursor.relationship?.progress.experiences).toEqual([]);

    const accepted = saveModelMemoryConsolidation(modelPath, {
      content: '# 核心记忆\n\n## 经历\n- 一起看过西湖\n- 一起修过灯\n',
      processedThroughCount: 2,
      relationshipEvents: [{ kind: 'shared-experience', experienceId: 'lake', summary: '一起看过西湖' }],
    });
    expect(accepted.relationship?.progress.experiences).toHaveLength(1);
    expect(accepted.relationship?.knownExperiences[0]?.excerpt).toContain('一起看过西湖');
    expect(accepted.relationship?.progress.experiences[0]?.id).not.toBe('lake');

    appendModelMemoryConversation(modelPath, {
      conversationId: 'lamp-turn', userText: '今天又聊起一起修过灯', assistantText: '灯修好了。', at: at('2026-11-09'),
    });
    const beforeReset = loadModelMemoryDocuments(modelPath);
    adjustModelMemoryRelationship(modelPath, {
      expectedRevision: beforeReset.relationship?.revision, stage: '疏远',
    });
    const stale = saveModelMemoryConsolidation(modelPath, {
      content: '# 核心记忆\n\n## 经历\n- 一起看过西湖\n- 一起修过灯\n',
      processedThroughCount: beforeReset.state.conversationCount,
      relationshipEvents: [{ kind: 'shared-experience', experienceId: 'lamp', summary: '一起修过灯' }],
    });
    expect(stale.relationship?.stage).toBe('疏远');
    expect(stale.relationship?.progress.experiences).toEqual([]);

    appendModelMemoryConversation(modelPath, {
      conversationId: 'lake-again', userText: '后来又说起看过西湖', assistantText: '记得。', at: at('2026-11-10'),
    });
    const replayed = saveModelMemoryConsolidation(modelPath, {
      content: '# 核心记忆\n\n## 经历\n- 一起看过西湖\n- 一起修过灯\n',
      processedThroughCount: loadModelMemoryDocuments(modelPath).state.conversationCount,
      relationshipEvents: [{ kind: 'shared-experience', experienceId: 'lake-2', summary: '看过西湖' }],
    });
    expect(replayed.relationship?.progress.experiences).toEqual([]);
    expect(replayed.relationship?.knownExperiences.some((item) => item.excerpt.includes('一起看过西湖'))).toBe(true);
  });
});
