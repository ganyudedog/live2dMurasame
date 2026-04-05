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
