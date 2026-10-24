import { parseActionIntent } from '../../../../live2d/modules/actions/domain/schema';
import { stage2LlmReplySchema } from './schema';
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
  private lineStart = true;
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
      const actionIntent = parseActionIntent(parsed.action_intent);
      if ('action_intent' in parsed) {
        // 动作必须属于带文本的句子；独立动作行没有可靠播放边界，明确记录丢弃原因。
        if (!speakText && !displayText) this.diagnose({ state: 'dropped', reason: 'missing-sentence-text', actionId: actionIntent?.actionId });
        else if (!actionIntent) this.diagnose({ state: 'dropped', reason: 'invalid-action', sentenceIndex: this.getSentenceIndex() });
        else this.diagnose({ state: 'parsed', sentenceIndex: this.getSentenceIndex(), actionId: actionIntent.actionId });
      }
      if (speakText || displayText) {
        events.push({ type: 'sentence-complete', sentence: {
          sentenceIndex: this.getSentenceIndex(), speakText, displayText: displayText || speakText,
          actionIntent,
        } });
      }
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

export type ReplyParseDiagnostic =
  | { state: 'json-lines'; recordCount: number; skippedLineCount: number }
  | { state: 'dropped'; lineNumber: number; reason: 'invalid-json' | 'invalid-record'; message: string };

// 解析 LLM 完整回复（兼容单对象 JSON 与 JSON Lines 两种格式）
export const parseStage2Reply = (
  rawText: string,
  onDiagnostic?: (diagnostic: ReplyParseDiagnostic) => void,
): Stage2LLMReply => {
  const text = String(rawText ?? '').trim();
  const diagnose = (diagnostic: ReplyParseDiagnostic) => {
    if (!onDiagnostic) {
      if (diagnostic.state === 'dropped') console.warn('[parseStage2Reply] 跳过无效回复记录', diagnostic);
      return;
    }
    try { onDiagnostic(diagnostic); }
    catch (error) { console.warn('[parseStage2Reply] 回复解析诊断日志写入失败', diagnostic, error); }
  };

  // 单对象兼容路径可能遇到合法的 JSON Lines；语法不匹配时继续逐行解析。
  const candidate = extractJsonCandidate(text);
  let singleObjectError: unknown;
  try {
    const parsed: unknown = JSON.parse(candidate);
    const checked = stage2LlmReplySchema.safeParse(parsed);
    if (checked.success) return checked.data;
    singleObjectError = checked.error;
  } catch (error) {
    // 保留失败原因；若逐行解析也没有有效文本，作为最终错误的 cause 抛出。
    singleObjectError = error;
  }
  // JSON Lines 路径：合并所有行的 speak_text / display_text
  const lines = text.split('\n');
  const allSpeak: string[] = [];
  const allDisplay: string[] = [];
  let lastActionIntent: Stage2LLMReply['action_intent'] | undefined;
  let recordCount = 0;
  let skippedLineCount = 0;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      skippedLineCount++;
      diagnose({ state: 'dropped', lineNumber: index + 1, reason: 'invalid-json',
        message: error instanceof Error ? error.message : String(error) });
      continue;
    }
    const speakText = typeof parsed.speak_text === 'string' ? parsed.speak_text.trim() : '';
    const displayText = typeof parsed.display_text === 'string' ? parsed.display_text.trim() : '';
    if (!speakText && !displayText) {
      skippedLineCount++;
      diagnose({ state: 'dropped', lineNumber: index + 1, reason: 'invalid-record', message: '记录不包含有效的语音或显示文本' });
      continue;
    }
    if (speakText) allSpeak.push(speakText);
    if (displayText) allDisplay.push(displayText);
    lastActionIntent = parseActionIntent(parsed.action_intent) ?? lastActionIntent;
    recordCount++;
  }

  if (!allSpeak.length && !allDisplay.length) {
    throw new Error('LLM 输出不是合法 JSON', { cause: singleObjectError });
  }
  diagnose({ state: 'json-lines', recordCount, skippedLineCount });

  return {
    display_text: allDisplay.join('\n') || allSpeak.join('\n') || '',
    speak_text: allSpeak.join('') || '',
    action_intent: lastActionIntent,
  };
};
