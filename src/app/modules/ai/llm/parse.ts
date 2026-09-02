import { stage2LlmReplySchema } from '../types/llm.schema';
import type { ActionIntentInput } from '../types/action';
import type { Stage2LLMReply } from '../types/llm';

/** 流式解析出的单句（JSON Lines 中的一行） */
export interface ParsedSentence {
  speakText: string;
  displayText: string;
  actionIntent?: ActionIntentInput;
  /** 该句在流式输出中的行索引（0-based） */
  lineIndex: number;
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

const safeDecodePartialJsonString = (value: string): string => {
  const raw = String(value ?? '');
  if (!raw) return '';

  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    // 兼容流式中间态：处理不完整的转义片段，避免解析失败。
    let normalized = raw;
    normalized = normalized.replace(/\\u[0-9a-fA-F]{0,3}$/g, '');
    normalized = normalized.replace(/\\$/g, '');
    normalized = normalized.replace(/\\n/g, '\n');
    normalized = normalized.replace(/\\r/g, '\r');
    normalized = normalized.replace(/\\t/g, '\t');
    normalized = normalized.replace(/\\"/g, '"');
    normalized = normalized.replace(/\\\\/g, '\\');
    return normalized;
  }
};

const extractPartialStringField = (rawText: string, key: string): string => {
  const source = String(rawText ?? '');
  if (!source) return '';
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`, 'i');
  const matched = source.match(pattern);
  if (!matched?.[1]) return '';
  return safeDecodePartialJsonString(matched[1]).trim();
};

// 从流式增量文本中提取可预览字段（允许 JSON 尚未闭合）。
export const parseStage2StreamPreview = (
  rawText: string,
): Partial<Pick<Stage2LLMReply, 'display_text' | 'speak_text'>> => {
  const candidate = extractJsonCandidate(rawText);
  const displayText = extractPartialStringField(candidate, 'display_text');
  const speakText = extractPartialStringField(candidate, 'speak_text');

  return {
    display_text: displayText || undefined,
    speak_text: speakText || undefined,
  };
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

/**
 * 从流式 JSON Lines 输出中提取已完成的行。
 *
 * 策略：按 \n 分割，对每行尝试 JSON.parse。
 * 解析失败的行视为不完整（流式中间态），不产出。
 * 通过 processedCount 跳已处理行避免重复解析。
 */
export const parseSentenceStreamPreview = (
  aggregateText: string,
  processedCount: number,
): ParsedSentence[] => {
  const raw = String(aggregateText ?? '');
  const lines = raw.split('\n');
  const sentences: ParsedSentence[] = [];

  for (let i = processedCount; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (!line || !line.startsWith('{')) continue;

    try {
      const parsed = JSON.parse(line);
      const speakText = String(parsed.speak_text ?? parsed.speakText ?? '').trim();
      const displayText = String(parsed.display_text ?? parsed.displayText ?? '').trim();
      if (!speakText && !displayText) continue;

      const sentence: ParsedSentence = {
        speakText,
        displayText: displayText || speakText,
        lineIndex: i,
      };

      // action_intent 可选
      if (parsed.action_intent && typeof parsed.action_intent === 'object') {
        sentence.actionIntent = {
          kind: parsed.action_intent.kind ?? 'blink',
          intensity: parsed.action_intent.intensity,
          durationMs: parsed.action_intent.durationMs,
          priority: parsed.action_intent.priority,
          cooldownMs: parsed.action_intent.cooldownMs,
          reason: parsed.action_intent.reason,
        };
      }

      sentences.push(sentence);
    } catch {
      // 不完整 JSON → 跳过，等待下一个 delta 补全
    }
  }

  return sentences;
};
