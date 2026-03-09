export interface BuildPromptInput {
  userText: string;
  ragContext?: string;
}

const OUTPUT_CONTRACT = `{
  "reply_text": "string",
  "action_intent": {
    "kind": "shake_head|blink|mouth",
    "intensity": "number(0..1)",
    "durationMs": "number(80..1200)",
    "priority": "number(0..100)",
    "cooldownMs": "number(0..3000)",
    "reason": "optional string"
  },
  "meta": {
    "model": "optional string"
  }
}`;

export const buildStage2SystemPrompt = (): string => {
  return [
    '你是 Live2D 桌宠的动作驱动助手。',
    '你的输出必须是严格 JSON，不允许 markdown、注释、代码块。',
    '动作只允许三种 kind: shake_head, blink, mouth。',
    '如果提供了 RAG 上下文，你必须优先遵守其中的人设、关系、禁忌、世界观与知识片段。',
    '如果语义不确定，优先输出 blink 或 mouth 的低强度动作。',
    '请保持 reply_text 简短自然，适合桌宠一句话回复。',
    '输出 JSON 契约如下：',
    OUTPUT_CONTRACT,
  ].join('\n');
};

export const buildStage2UserPrompt = (input: BuildPromptInput): string => {
  const parts = [];
  if (input.ragContext) {
    parts.push('以下是可用 RAG 上下文，仅在相关时引用，不要编造未出现的信息：');
    parts.push(input.ragContext);
  }
  parts.push(`用户输入：${input.userText}`);
  return parts.join('\n\n');
};
