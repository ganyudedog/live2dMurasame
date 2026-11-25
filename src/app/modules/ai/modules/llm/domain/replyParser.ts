import { parseActionIntent } from '../../../../live2d/modules/actions/domain/schema';
import { sentenceSchema, stage2LlmReplySchema } from './schema';
import type { ActionIntentInput, ActionSelection } from '../../../../live2d/modules/actions/domain/types';
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

/** 动作诊断独立于文本事件，不能改变句子编号或语音提交时机。 */
export interface ParsedActionDiagnostic {
  state: 'parsed' | 'dropped';
  sentenceIndex?: number;
  reason?: 'invalid-action' | 'missing-sentence-text' | 'invalid-json' | 'incomplete-json';
  actionId?: ActionSelection;
}

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
  private envelope: 'prefix' | 'item' | 'separator' | 'closed' = 'prefix';
  private prefix = '';
  private speechReady = false;
  private displayReady = false;
  private readonly onActionDiagnostic?: (diagnostic: ParsedActionDiagnostic) => void;

  constructor(onActionDiagnostic?: (diagnostic: ParsedActionDiagnostic) => void) {
    this.onActionDiagnostic = onActionDiagnostic;
  }

  /** 流结束时记录被截断的动作对象，不尝试猜测或修复其所属句子。 */
  finish(): void {
    if (this.depth && this.record.includes('action_intent')) this.diagnose({
      state: 'dropped', reason: 'incomplete-json', sentenceIndex: this.sentenceIndex ?? undefined,
    });
  }

  push(deltaText: string): SentenceStreamEvent[] {
    const events: SentenceStreamEvent[] = [];
    for (const char of deltaText) {
      if (!this.depth) {
        if (this.envelope === 'prefix') {
          this.prefix += char;
          if (char === '[') {
            // Decode the root key with JSON rules (including Unicode escapes).
            try {
              const root = JSON.parse(`${this.prefix}]}`);
              this.envelope = Object.keys(root).length === 1 && Array.isArray(root.sentences) ? 'item' : 'closed';
            } catch { this.envelope = 'closed'; }
            this.prefix = '';
          }
        } else if (/\s/.test(char)) continue;
        else if (this.envelope === 'item' && char === '{') {
          this.record = '{';
          this.depth = 1;
          this.fieldState = 'key';
          this.fieldName = '';
          this.envelope = 'separator';
        } else if (this.envelope === 'separator' && char === ',') this.envelope = 'item';
        else this.envelope = 'closed';
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
      if (this.fieldName === 'speak_text' && !this.speechReady) {
        this.speechReady = true;
        events.push({ type: 'speech-ready', sentenceIndex: this.getSentenceIndex(), speakText: value.trim() });
      } else if (this.fieldName === 'display_text' && !this.displayReady) {
        this.displayReady = true;
        events.push({ type: 'display-ready', sentenceIndex: this.getSentenceIndex(), displayText: value.trim() });
      }
    }
    this.fieldState = 'other';
  }

  private completeSentence(events: SentenceStreamEvent[]): void {
    try {
      const parsed = sentenceSchema.parse(JSON.parse(this.record));
      const speakText = parsed.speak_text ?? '';
      const displayText = parsed.display_text;
      const actionIntent = parseActionIntent(parsed.action_intent);
      if ('action_intent' in parsed) {
        if (!actionIntent) this.diagnose({ state: 'dropped', reason: 'invalid-action', sentenceIndex: this.getSentenceIndex() });
        else this.diagnose({ state: 'parsed', sentenceIndex: this.getSentenceIndex(), actionId: actionIntent.actionId });
      }
      events.push({ type: 'sentence-complete', sentence: {
        sentenceIndex: this.getSentenceIndex(), speakText, displayText, actionIntent,
      } });
    } catch {
      if (this.record.includes('action_intent')) this.diagnose({
        state: 'dropped', reason: 'invalid-json', sentenceIndex: this.sentenceIndex ?? undefined,
      });
    }
    this.record = '';
    this.sentenceIndex = null;
    this.speechReady = false;
    this.displayReady = false;
  }

  private diagnose(diagnostic: ParsedActionDiagnostic): void {
    try { this.onActionDiagnostic?.(diagnostic); }
    catch (error) {
      console.warn('[SentenceStreamParser] 动作诊断日志写入失败', error);
    }
  }
}

export const parseStage2Reply = (rawText: string): Stage2LLMReply => {
  try {
    const { sentences } = stage2LlmReplySchema.parse(JSON.parse(rawText));
    return {
      display_text: sentences.map(item => item.display_text).join('\n'),
      speak_text: sentences.map(item => item.speak_text ?? '').join(''),
      action_intent: sentences.map(item => parseActionIntent(item.action_intent)).filter(Boolean).at(-1),
    };
  } catch (cause) {
    throw new Error('LLM 输出不是合法 JSON sentences 对象', { cause });
  }
};
