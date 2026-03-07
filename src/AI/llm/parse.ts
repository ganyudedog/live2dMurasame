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
