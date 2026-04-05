export interface BuildPromptInput {
  userText: string;
  ragContext?: string;
  displayLang?: 'zh' | 'en' | 'ja' | 'ko';
  speakLang?: string;
}

const OUTPUT_CONTRACT = `{
  "display_text": "string (前端显示文本，默认中文)",
  "speak_text": "string (TTS合成文本，可为日文等目标语种)",
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

const mapDisplayLangName = (lang?: 'zh' | 'en' | 'ja' | 'ko'): string => {
  if (lang === 'en') return '英语';
  if (lang === 'ja') return '日语';
  if (lang === 'ko') return '韩语';
  return '中文';
};

const mapSpeakLangName = (lang?: string): string => {
  if (lang === 'zh') return '中文';
  if (lang === 'en') return '英语';
  if (lang === 'ja') return '日语';
  if (lang === 'ko') return '韩语';
  if (lang === 'yue') return '粤语';
  return lang && lang.trim() ? lang : '日语';
};

export const buildStage2SystemPrompt = (input?: { displayLang?: 'zh' | 'en' | 'ja' | 'ko'; speakLang?: string }): string => {
  const displayLangName = mapDisplayLangName(input?.displayLang);
  const speakLangName = mapSpeakLangName(input?.speakLang);
  return [
    '你是 Live2D 桌宠的动作驱动助手。',
    '你的输出必须是严格 JSON，不允许 markdown、注释、代码块。',
    '请优先输出 display_text（给前端展示）与 speak_text（给 TTS 合成）。',
    `display_text 必须使用${displayLangName}。`,
    `speak_text 必须使用${speakLangName}。`,
    '为兼容旧链路，reply_text 保留且建议与 display_text 一致。',
    '动作只允许三种 kind: shake_head, blink, mouth。',
    '如果提供了 RAG 上下文，你必须优先遵守其中的人设、关系、禁忌、世界观、最近对话记忆与知识片段。',
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
