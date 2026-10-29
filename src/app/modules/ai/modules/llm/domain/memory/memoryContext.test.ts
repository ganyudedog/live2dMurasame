import { describe, expect, it } from 'vitest';
import {
  buildMemoryContext,
  buildPersonaPrompt,
  currentRelationshipLine,
  ensureRelationshipSection,
  normalizePersona,
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
    expect(currentRelationshipLine('')).toContain('阶段：亲近');
  });

  it('pins the relationship section and keeps it out of recalled memory', () => {
    const coreText = [
      '## 当前关系',
      '- 阶段：信赖。可以提起一起修过的那个 bug。',
      '',
      '## 稳定偏好',
      '- 喜欢日语语音',
    ].join('\n');
    expect(currentRelationshipLine(coreText)).toContain('阶段：信赖');
    const recalled = buildMemoryContext({ coreText } as PetModelMemoryState, '', '日语');
    expect(recalled).toContain('喜欢日语语音');
    expect(recalled).not.toContain('当前关系');
    expect(recalled).not.toContain('信赖');
  });

  it('replaces an unknown stage and preserves one allowed line', () => {
    expect(ensureRelationshipSection('# 核心记忆\n- 喜欢茶')).toContain('阶段：亲近');
    expect(ensureRelationshipSection('## 当前关系\n- 阶段：讨厌。别说话。\n\n## 其他\n- 记得生日')).toContain('阶段：亲近');
    const kept = ensureRelationshipSection('## 当前关系\n- 阶段：亲密。可以叫小名。\n\n## 其他\n- 记得生日');
    expect(kept).toContain('阶段：亲密。可以叫小名。');
    expect(kept).toContain('记得生日');
    expect(kept.indexOf('## 当前关系')).toBeLessThan(kept.indexOf('## 其他'));
  });
});
