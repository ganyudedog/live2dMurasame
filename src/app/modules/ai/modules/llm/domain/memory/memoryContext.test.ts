import { describe, expect, it } from 'vitest';
import { buildStage2SystemPrompt } from '../prompt';
import {
  buildMemoryContext,
  buildPersonaPrompt,
  buildRelationshipPrompt,
  normalizePersona,
  promptLineFromMemory,
} from './memoryContext';

describe('character card and relationship stage', () => {
  it('reads the character card and starts the relationship at 亲近', () => {
    const persona = normalizePersona({
      name: '丛雨', voice: '傲娇\n短句', boundaries: '不编造经历', notes: '学园都市',
      personal: '不会再读', relation: '青梅竹马',
    });
    expect(persona.name).toBe('丛雨');
    expect(persona.voice).toBe('傲娇\n短句');
    expect(persona.boundaries).toBe('不编造经历');
    expect(persona.notes).toBe('学园都市');
    expect(buildPersonaPrompt(persona)).toContain('[性格与口吻]\n傲娇');
    expect(buildPersonaPrompt(persona)).not.toContain('青梅竹马');
    expect(promptLineFromMemory(null)).toContain('阶段：亲近');
  });

  it('pins the relationship section and keeps it out of recalled memory', () => {
    const coreText = [
      '## 当前关系',
      '- 阶段：信赖。可以提起一起修过的那个 bug。',
      '',
      '## 稳定偏好',
      '- 喜欢日语语音',
    ].join('\n');
    expect(promptLineFromMemory({ coreText })).toContain('阶段：信赖');
    const recalled = buildMemoryContext({ coreText } as PetModelMemoryState, '', '日语');
    expect(recalled).toContain('喜欢日语语音');
    expect(recalled).not.toContain('当前关系');
    expect(recalled).not.toContain('信赖');
  });

  it('uses the same relationship line in the prompt and refuses to let intimacy replace boundaries', () => {
    const line = promptLineFromMemory({ coreText: '## 当前关系\n- 阶段：信赖。可以提起那次。\n\n## 其他\n- 茶' });
    expect(buildRelationshipPrompt(line)).toContain(line);
    const prompt = buildStage2SystemPrompt({ relationshipStage: line });
    const block = prompt.slice(prompt.indexOf('[当前关系]'), prompt.indexOf('角色卡和当前关系优先'));
    expect(block).toContain('阶段：信赖。可以提起那次。');
    expect(block).not.toContain('阶段：亲近');
    expect(block).toContain('不能用亲密代替那些限制');
    const ambiguous = promptLineFromMemory({
      coreText: '## 当前关系\n- 阶段：亲密。我们在一起。',
      relationship: { needsSelection: true, legacyText: '阶段：讨厌。别说话。', line: '' },
    });
    expect(ambiguous).toContain('别说话');
    expect(buildRelationshipPrompt(ambiguous)).not.toContain('阶段：亲近');
    expect(promptLineFromMemory({
      coreText: '## 当前关系\n- 阶段：亲密。我们在一起。',
      relationship: { needsSelection: false, line: '阶段：信赖。可以提起一起经历过的事。' },
    })).toContain('信赖');
  });
});
