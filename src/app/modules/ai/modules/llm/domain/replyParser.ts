import { stage2LlmReplySchema } from './schema';
import type { ActionIntentInput } from '../../../../live2d/modules/actions/domain/types';
import type { Stage2LLMReply } from './types';

/** 流式解析出的业务句子，与输出文本的物理行号无关。 */
export interface ParsedSentence {
  speakText: string;
  displayText: string;
  actionIntent?: ActionIntentInput;
  /** 该句在当前回复中的连续编号（0-based）。 */
  sentenceIndex: number;
}

export type SentenceStreamEvent =
  | { type: 'speech-ready'; sentenceIndex: number; speakText: string }
  | { type: 'display-ready'; sentenceIndex: number; displayText: string }
  | { type: 'sentence-complete'; sentence: ParsedSentence };

/** 每次请求独立使用：只扫描新增字符，完整字符串就绪后立即产出，整句完成后再提交句子。 */
export class SentenceStreamParser {
  private nextSentenceIndex = 0;
  private sentenceIndex: number | null = null;
  private record = '';
  private depth = 0;
  private inString = false;
  private escaped = false;
  private stringStart = 0;
  private fieldName = '';
  private fieldState: 'key' | 'value' | 'other' = 'key';
  private lineStart = true;
  private speechReady = false;
  private displayReady = false;

  push(deltaText: string): SentenceStreamEvent[] {
    const events: SentenceStreamEvent[] = [];
    for (const char of deltaText) {
      if (!this.depth) {
        if (char === '{' && this.lineStart) {
          this.record = '{';
          this.depth = 1;
          this.fieldState = 'key';
          this.fieldName = '';
        }
        if (char === '\n') this.lineStart = true;
        else if (!/\s/.test(char)) this.lineStart = false;
        continue;
      }

      this.record += char;
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (char === '\\') this.escaped = true;
        else if (char === '"') {
          this.inString = false;
          if (this.depth === 1) this.closeString(events);
        }
        continue;
      }
      if (char === '"') {
        this.inString = true;
        this.stringStart = this.record.length - 1;
      } else if (char === '{' || char === '[') {
        this.depth++;
      } else if (char === '}' || char === ']') {
        this.depth--;
        if (this.depth === 0) this.completeSentence(events);
      } else if (this.depth === 1 && char === ':') {
        this.fieldState = 'value';
      } else if (this.depth === 1 && char === ',') {
        this.fieldState = 'key';
        this.fieldName = '';
      }
    }
    return events;
  }

  private getSentenceIndex(): number {
    return this.sentenceIndex ??= this.nextSentenceIndex++;
  }

  private closeString(events: SentenceStreamEvent[]): void {
    let value: string;
    try { value = JSON.parse(this.record.slice(this.stringStart)); }
    catch { this.fieldState = 'other'; return; }
    if (this.fieldState === 'key') {
      this.fieldName = value;
    } else if (this.fieldState === 'value' && value.trim()) {
      if ((this.fieldName === 'speak_text' || this.fieldName === 'speakText') && !this.speechReady) {
        this.speechReady = true;
        events.push({ type: 'speech-ready', sentenceIndex: this.getSentenceIndex(), speakText: value.trim() });
      } else if ((this.fieldName === 'display_text' || this.fieldName === 'displayText') && !this.displayReady) {
        this.displayReady = true;
        events.push({ type: 'display-ready', sentenceIndex: this.getSentenceIndex(), displayText: value.trim() });
      }
    }
    this.fieldState = 'other';
  }

  private completeSentence(events: SentenceStreamEvent[]): void {
    try {
      const parsed = JSON.parse(this.record);
      const speakText = typeof (parsed.speak_text ?? parsed.speakText) === 'string'
        ? (parsed.speak_text ?? parsed.speakText).trim() : '';
      const displayText = typeof (parsed.display_text ?? parsed.displayText) === 'string'
        ? (parsed.display_text ?? parsed.displayText).trim() : '';
      if (speakText || displayText) {
        events.push({ type: 'sentence-complete', sentence: {
          sentenceIndex: this.getSentenceIndex(), speakText, displayText: displayText || speakText,
          actionIntent: parsed.action_intent ? { ...parsed.action_intent, kind: parsed.action_intent.kind ?? 'blink' } : undefined,
        } });
      }
    } catch { /* 不完整或无效的记录不提交为完整句子。 */ }
    this.record = '';
    this.sentenceIndex = null;
    this.speechReady = false;
    this.displayReady = false;
  }
}

const extractJsonCandidate = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch?.[1]) {
    const block = codeBlockMatch[1].trim();
    if (block.startsWith('{') && block.endsWith('}')) return block;
  }

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
};

// 解析 LLM 完整回复（兼容单对象 JSON 与 JSON Lines 两种格式）
export const parseStage2Reply = (rawText: string): Stage2LLMReply => {
  const text = String(rawText ?? '').trim();

  // 先尝试标准单对象 JSON 路径
  const candidate = extractJsonCandidate(text);
  try {
    const parsed = JSON.parse(candidate);
    const checked = stage2LlmReplySchema.safeParse(parsed);
    if (checked.success) return checked.data;
  } catch { /* 非标准单对象格式，尝试 JSON Lines */ }

  // JSON Lines 路径：合并所有行的 speak_text / display_text
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
  const allSpeak: string[] = [];
  const allDisplay: string[] = [];
  let lastActionIntent: Stage2LLMReply['action_intent'] | undefined;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.speak_text === 'string' && parsed.speak_text.trim()) {
        allSpeak.push(parsed.speak_text.trim());
      }
      if (typeof parsed.display_text === 'string' && parsed.display_text.trim()) {
        allDisplay.push(parsed.display_text.trim());
      }
      if (parsed.action_intent && typeof parsed.action_intent === 'object') {
        lastActionIntent = {
          kind: parsed.action_intent.kind ?? 'blink',
          intensity: parsed.action_intent.intensity,
          durationMs: parsed.action_intent.durationMs,
          priority: parsed.action_intent.priority,
          cooldownMs: parsed.action_intent.cooldownMs,
          reason: parsed.action_intent.reason,
        };
      }
    } catch { /* 跳过无法解析的行 */ }
  }

  if (!allSpeak.length && !allDisplay.length) {
    throw new Error('LLM 输出不是合法 JSON');
  }

  return {
    display_text: allDisplay.join('\n') || allSpeak.join('\n') || '',
    speak_text: allSpeak.join('') || '',
    action_intent: lastActionIntent ?? { kind: 'blink' },
  };
};
