export interface BuildPromptInput {
  userText: string;
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
    '如果语义不确定，优先输出 blink 或 mouth 的低强度动作。',
    '请保持 reply_text 简短自然，适合桌宠一句话回复。',
    '输出 JSON 契约如下：',
    OUTPUT_CONTRACT,
  ].join('\n');
};

export const buildStage2UserPrompt = (input: BuildPromptInput): string => {
  return `用户输入：${input.userText}`;
};
