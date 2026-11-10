export const PRESENCE_EXPRESSIONS = [
  'absent', 'sleepy', 'yawn', 'laugh', 'surprised', 'frown', 'squint', 'pout', 'smile', 'away', 'attentive', 'neutral',
] as const;

export type PresenceExpression = (typeof PRESENCE_EXPRESSIONS)[number];

export const PRESENCE_STABLE_MS = 1000;
export const FROWN_HOLD_MS = 30_000;
export const SLEEPY_HOLD_MS = 15_000;
export const YAWN_REPEAT = 2;
export const YAWN_WINDOW_MS = 3 * 60 * 1000;
export const ABSENCE_MS = 3 * 60 * 1000;
export const RETURN_HOLD_MS = 5_000;
export const RECENT_CHAT_MS = 3 * 60 * 1000;
export const PROACTIVE_QUIET_MS = 15 * 60 * 1000;

const LABELS: Record<PresenceExpression, string> = {
  absent: '不在画面',
  sleepy: '闭眼发困',
  yawn: '在打哈欠',
  laugh: '在笑',
  surprised: '有些惊讶',
  frown: '皱着眉',
  squint: '眯着眼',
  pout: '嘟着嘴',
  smile: '在微笑',
  away: '看向别处',
  attentive: '正看着屏幕',
  neutral: '表情平静',
};

const score = (scores: Record<string, number>, name: string): number => scores[name] ?? 0;
const pair = (scores: Record<string, number>, left: string, right: string): number => (score(scores, left) + score(scores, right)) / 2;

/** 一张脸的动作系数收成一个状态。没有脸时传入 null。 */
export const classifyFace = (scores: Record<string, number> | null): PresenceExpression => {
  if (!scores) return 'absent';
  const blink = pair(scores, 'eyeBlinkLeft', 'eyeBlinkRight');
  const jaw = score(scores, 'jawOpen');
  const smile = pair(scores, 'mouthSmileLeft', 'mouthSmileRight');
  const wide = pair(scores, 'eyeWideLeft', 'eyeWideRight');
  const browUp = score(scores, 'browInnerUp');
  const browDown = pair(scores, 'browDownLeft', 'browDownRight');
  const frown = pair(scores, 'mouthFrownLeft', 'mouthFrownRight');
  const squint = pair(scores, 'eyeSquintLeft', 'eyeSquintRight');
  const look = Math.max(
    pair(scores, 'eyeLookOutLeft', 'eyeLookOutRight'),
    pair(scores, 'eyeLookInLeft', 'eyeLookInRight'),
    pair(scores, 'eyeLookUpLeft', 'eyeLookUpRight'),
    pair(scores, 'eyeLookDownLeft', 'eyeLookDownRight'),
  );
  if (blink > 0.55) return 'sleepy';
  if (jaw > 0.55) return 'yawn';
  if (smile > 0.4 && jaw > 0.2) return 'laugh';
  if (wide > 0.45 && browUp > 0.35) return 'surprised';
  if (browDown > 0.4 || frown > 0.35) return 'frown';
  if (squint > 0.45) return 'squint';
  if (score(scores, 'mouthPucker') > 0.45 || score(scores, 'mouthFunnel') > 0.45) return 'pout';
  if (smile > 0.3) return 'smile';
  if (look > 0.55) return 'away';
  if (look < 0.25) return 'attentive';
  return 'neutral';
};

export const formatPresenceLine = (expression: PresenceExpression): string => (
  `眼前状态：${LABELS[expression]}。只在用得上时提起，不要每句都点评表情。`
);

const cue = (reason: string): string => `${reason}。用角色的口吻主动说一句短话，不要说明你在识别表情。`;

/**
 * 主动开口看情况是否已经持续了一会儿。短促的表情变化只留给下一轮用户对话。
 * blocked 时不说话，并把已经成立的这一次情况记下，避免一空出来就补说。
 */
export class PresenceWatch {
  private expression: PresenceExpression | null = null;
  private since = 0;
  private frownSpoken = false;
  private drowsySpoken = false;
  private yawns: number[] = [];
  private absentSince: number | null = null;
  private pendingReturn = false;
  private attentiveSince: number | null = null;
  private quietUntil = 0;

  observe(expression: PresenceExpression, now: number, blocked = false): string | null {
    if (expression !== this.expression) {
      this.expression = expression;
      this.since = now;
    }
    if (expression !== 'frown') this.frownSpoken = false;
    if (expression !== 'sleepy' && expression !== 'yawn') this.drowsySpoken = false;
    this.yawns = this.yawns.filter((at) => now - at <= YAWN_WINDOW_MS);
    if (expression === 'yawn' && this.since === now) this.yawns.push(now);

    if (expression === 'absent') {
      this.absentSince ??= now;
      this.pendingReturn = false;
      this.attentiveSince = null;
    } else if (this.absentSince !== null) {
      this.pendingReturn = now - this.absentSince >= ABSENCE_MS;
      this.absentSince = null;
      this.attentiveSince = null;
    }
    if (this.pendingReturn && expression === 'attentive') this.attentiveSince ??= now;
    else this.attentiveSince = null;

    const reason = this.reason(expression, now);
    if (!reason) return null;
    this.consume(reason.kind);
    if (blocked || now < this.quietUntil) return null;
    this.quietUntil = now + PROACTIVE_QUIET_MS;
    return cue(reason.text);
  }

  private reason(expression: PresenceExpression, now: number): { kind: 'frown' | 'drowsy' | 'return'; text: string } | null {
    if (expression === 'frown' && !this.frownSpoken && now - this.since >= FROWN_HOLD_MS) {
      return { kind: 'frown', text: '用户已经皱眉好一会儿' };
    }
    const repeatedYawn = this.yawns.length >= YAWN_REPEAT;
    const sleepyHeld = expression === 'sleepy' && now - this.since >= SLEEPY_HOLD_MS;
    if (!this.drowsySpoken && (repeatedYawn || sleepyHeld)) return { kind: 'drowsy', text: '用户看起来累了好一会儿' };
    if (this.pendingReturn && this.attentiveSince !== null && now - this.attentiveSince >= RETURN_HOLD_MS) {
      return { kind: 'return', text: '用户离开一段时间后回到屏幕前' };
    }
    return null;
  }

  reset(): void {
    this.expression = null;
    this.since = 0;
    this.frownSpoken = false;
    this.drowsySpoken = false;
    this.yawns = [];
    this.absentSince = null;
    this.pendingReturn = false;
    this.attentiveSince = null;
    this.quietUntil = 0;
  }

  private consume(kind: 'frown' | 'drowsy' | 'return'): void {
    if (kind === 'frown') this.frownSpoken = true;
    if (kind === 'drowsy') {
      this.drowsySpoken = true;
      this.yawns = [];
    }
    if (kind === 'return') {
      this.pendingReturn = false;
      this.attentiveSince = null;
    }
  }
}

export interface PresenceChange {
  previous: PresenceExpression | null;
  next: PresenceExpression;
}

/**
 * 同一个状态要稳住约一秒才送出，并且和上次送出的状态相同就不再送。
 * 送出的状态只给下一轮提示词使用一次。
 */
export class PresenceGate {
  private candidate: PresenceExpression | null = null;
  private since = 0;
  private lastDelivered: PresenceExpression | null = null;
  private pending: PresenceExpression | null = null;

  observe(expression: PresenceExpression, now: number): PresenceChange | null {
    if (expression !== this.candidate) {
      this.candidate = expression;
      this.since = now;
      return null;
    }
    if (now - this.since < PRESENCE_STABLE_MS) return null;
    if (expression === this.lastDelivered) return null;
    const previous = this.lastDelivered;
    this.lastDelivered = expression;
    this.pending = expression;
    return { previous, next: expression };
  }

  consumePrompt(): string | null {
    if (!this.pending) return null;
    const line = formatPresenceLine(this.pending);
    this.pending = null;
    return line;
  }

  reset(): void {
    this.candidate = null;
    this.since = 0;
    this.lastDelivered = null;
    this.pending = null;
  }
}
