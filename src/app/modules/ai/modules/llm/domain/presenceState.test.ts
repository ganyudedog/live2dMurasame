import { describe, expect, it } from 'vitest';
import { buildStage2UserPrompt } from './prompt';
import {
  ABSENCE_MS,
  FROWN_HOLD_MS,
  PresenceGate,
  PresenceWatch,
  PRESENCE_STABLE_MS,
  PROACTIVE_QUIET_MS,
  RETURN_HOLD_MS,
  SLEEPY_HOLD_MS,
  classifyFace,
} from './presenceState';

describe('face presence state', () => {
  it('picks one expression by priority', () => {
    expect(classifyFace(null)).toBe('absent');
    expect(classifyFace({ eyeBlinkLeft: 0.8, eyeBlinkRight: 0.8, mouthSmileLeft: 0.9, mouthSmileRight: 0.9 })).toBe('sleepy');
    expect(classifyFace({ jawOpen: 0.7 })).toBe('yawn');
    expect(classifyFace({ mouthSmileLeft: 0.6, mouthSmileRight: 0.6, jawOpen: 0.3 })).toBe('laugh');
    expect(classifyFace({ eyeWideLeft: 0.6, eyeWideRight: 0.6, browInnerUp: 0.5 })).toBe('surprised');
    expect(classifyFace({ browDownLeft: 0.5, browDownRight: 0.5 })).toBe('frown');
    expect(classifyFace({ eyeSquintLeft: 0.6, eyeSquintRight: 0.6 })).toBe('squint');
    expect(classifyFace({ mouthPucker: 0.6 })).toBe('pout');
    expect(classifyFace({ mouthSmileLeft: 0.4, mouthSmileRight: 0.4 })).toBe('smile');
    expect(classifyFace({ eyeLookOutLeft: 0.8, eyeLookOutRight: 0.8 })).toBe('away');
    expect(classifyFace({})).toBe('attentive');
    expect(classifyFace({ eyeLookOutLeft: 0.4, eyeLookOutRight: 0.4 })).toBe('neutral');
  });

  it('delivers a stable expression once and keeps it out of later prompts', () => {
    const gate = new PresenceGate();
    expect(gate.observe('frown', 0)).toBeNull();
    expect(gate.observe('frown', PRESENCE_STABLE_MS - 1)).toBeNull();
    expect(gate.observe('frown', PRESENCE_STABLE_MS)).toEqual({ previous: null, next: 'frown' });
    expect(gate.observe('frown', PRESENCE_STABLE_MS * 3)).toBeNull();
    expect(gate.consumePrompt()).toContain('皱着眉');
    expect(gate.consumePrompt()).toBeNull();
    expect(buildStage2UserPrompt({ userText: '在吗', presenceLine: '眼前状态：皱着眉。只在用得上时提起，不要每句都点评表情。' }))
      .toContain('眼前状态：皱着眉');
    expect(buildStage2UserPrompt({ userText: '在吗' })).not.toContain('眼前状态');
  });

  it('speaks only after a situation has lasted, then stays quiet', () => {
    const watch = new PresenceWatch();
    expect(watch.observe('smile', 0)).toBeNull();
    expect(watch.observe('yawn', 1_000)).toBeNull();
    const frownAt = 2_000;
    expect(watch.observe('frown', frownAt)).toBeNull();
    expect(watch.observe('frown', frownAt + FROWN_HOLD_MS - 1)).toBeNull();
    const spokeAt = frownAt + FROWN_HOLD_MS;
    expect(watch.observe('frown', spokeAt)).toContain('皱眉好一会儿');
    expect(watch.observe('frown', spokeAt + 5_000)).toBeNull();
    expect(watch.observe('attentive', spokeAt + 6_000)).toBeNull();
    expect(watch.observe('frown', spokeAt + 7_000)).toBeNull();
    expect(watch.observe('frown', spokeAt + 7_000 + FROWN_HOLD_MS)).toBeNull();
    const again = spokeAt + PROACTIVE_QUIET_MS;
    expect(watch.observe('attentive', again)).toBeNull();
    expect(watch.observe('frown', again + 1_000)).toBeNull();
    expect(watch.observe('frown', again + 1_000 + FROWN_HOLD_MS)).toContain('皱眉好一会儿');
  });

  it('treats one yawn as nothing and a held sleepy face as tired', () => {
    const yawns = new PresenceWatch();
    expect(yawns.observe('yawn', 0)).toBeNull();
    expect(yawns.observe('attentive', 1_000)).toBeNull();
    expect(yawns.observe('yawn', 2_000)).toContain('累了好一会儿');

    const sleepy = new PresenceWatch();
    expect(sleepy.observe('sleepy', 0)).toBeNull();
    expect(sleepy.observe('sleepy', SLEEPY_HOLD_MS)).toContain('累了好一会儿');
  });

  it('greets only after a long absence and a steady look back', () => {
    const watch = new PresenceWatch();
    expect(watch.observe('absent', 0)).toBeNull();
    expect(watch.observe('attentive', 2_000)).toBeNull();
    expect(watch.observe('attentive', 2_000 + RETURN_HOLD_MS)).toBeNull();
    expect(watch.observe('absent', 10_000)).toBeNull();
    expect(watch.observe('attentive', 10_000 + ABSENCE_MS)).toBeNull();
    expect(watch.observe('attentive', 10_000 + ABSENCE_MS + RETURN_HOLD_MS)).toContain('回到屏幕前');
  });

  it('drops a situation that matures while conversation is busy', () => {
    const watch = new PresenceWatch();
    expect(watch.observe('frown', 0, true)).toBeNull();
    expect(watch.observe('frown', FROWN_HOLD_MS, true)).toBeNull();
    expect(watch.observe('frown', FROWN_HOLD_MS + 1_000, false)).toBeNull();
  });
});
