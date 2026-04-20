import { stage2LlmReplySchema } from '../types/llm.schema';
import type { Stage2LLMReply } from '../types/llm';


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
): Partial<Pick<Stage2LLMReply, 'display_text' | 'speak_text' | 'reply_text'>> => {
  const candidate = extractJsonCandidate(rawText);
  const displayText = extractPartialStringField(candidate, 'display_text');
  const speakText = extractPartialStringField(candidate, 'speak_text');
  const replyText = extractPartialStringField(candidate, 'reply_text');

  return {
    display_text: displayText || undefined,
    speak_text: speakText || undefined,
    reply_text: replyText || undefined,
  };
};

// 解析LLM输出的文本，提取其中的JSON部分，并验证其结构是否符合预期的Stage2LLMReply格式，如果不合法则抛出相应的错误。
export const parseStage2Reply = (rawText: string): Stage2LLMReply => {
  const candidate = extractJsonCandidate(rawText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error('LLM 输出不是合法 JSON');
  }

  const checked = stage2LlmReplySchema.safeParse(parsed);
  if (!checked.success) {
    const issue = checked.error.issues[0]?.message ?? 'unknown validation error';
    throw new Error(`LLM 输出字段校验失败: ${issue}`);
  }

  return checked.data;
};
