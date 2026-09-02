export interface BuildPromptInput {
  userText: string;
  ragContext?: string;
  displayLang?: 'zh' | 'en' | 'ja' | 'ko';
  speakLang?: 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto';
}

/**
 * JSON Lines 输出契约：每行一个独立 JSON 对象，行间用 \n 分隔。
 * speak_text 必须排在 display_text 前面，便于流式场景下优先发送 TTS。
 * action_intent 可选，仅在需要动作的句子附带（通常放在最后一句）。
 * 最终行后面不能有逗号或数组包裹。
 */
const OUTPUT_CONTRACT = [
  '你的回复必须按句末标点（。！？. ! ?）拆分为多句，每句作为一行独立的 JSON 对象输出。',
  '行与行之间**必须**输出字面换行符（\\n），不要用数组 [] 包裹，不要把多句合成一行。',
  '每行的 JSON 结构如下：',
  '',
  '{ "speak_text": "一句 TTS 文本", "display_text": "对应的显示文本" }',
  '',
  'speak_text 在前、display_text 在后。speak_text 是给 TTS 合成的一句话，',
  'display_text 是给前端展示的对应文本。',
  'speak_text 必须严格控制长度，每句 20 字以内（约 2~3 个短语），display_text 同样简洁。',
  '每句话意思完整，不要半句话截断。',
  '',
  '正确示例（注意：每行都是独立的 JSON，行间有换行）：',
  '{"speak_text":"好きって言ってくれたの？","display_text":"又说喜欢我了？"}',
  '{"speak_text":"本当に嬉しいな","display_text":"我真的好开心呢"}',
  '{"speak_text":"ありがとう","display_text":"谢谢你呢","action_intent":{"kind":"blink"}}',
  '',
  '错误示例（严禁）：',
  '{"speak_text":"好きって言ってくれたの？本当に嬉しいな～ありがとう","display_text":"又说喜欢我了？真的超级开心呢～谢谢"}',
  '→ 单行长 JSON 会导致 TTS 语音抖动，绝对不要这样写！',
  '',
  '最后一行可以附带可选的 action_intent。',
].join('\n');

const mapDisplayLangName = (lang?: 'zh' | 'en' | 'ja' | 'ko'): string => {
  if (lang === 'en') return '英语';
  if (lang === 'ja') return '日语';
  if (lang === 'ko') return '韩语';
  return '中文';
};

const mapSpeakLangName = (lang?: 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto'): string => {
  if (lang === 'all_zh') return '中文';
  if (lang === 'all_en') return '英语';
  if (lang === 'all_ja') return '日语';
  if (lang === 'all_ko') return '韩语';
  if (lang === 'all_yue') return '粤语';
  return lang && lang.trim() ? lang : '日语';
};

export const buildStage2SystemPrompt = (input?: { displayLang?: 'zh' | 'en' | 'ja' | 'ko'; speakLang?: 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto' }): string => {
  const displayLangName = mapDisplayLangName(input?.displayLang);
  const speakLangName = mapSpeakLangName(input?.speakLang);
  return [
    '你是 Live2D 桌宠的角色对话助手。',
    '你的输出必须是严格的 JSON，不要包裹在 markdown 代码块（```）中，不要添加额外的注释或说明文字。',
    '根据用户输入的内容自然回复，可以是一句简短回应，也可以是多句展开描述——不要刻意控制句数。',
    `display_text 必须使用${displayLangName}。`,
    `speak_text 是给 TTS 语音合成用的，**必须**使用${speakLangName}（即使用户输入是其他语言）。如果 speak_text 用了错误的语言，TTS 合成会失败。`,
    '动作只允许三种 kind: shake_head, blink, mouth。',
    '如果语义不确定，优先输出 blink 或 mouth 的低强度动作。',
    '回复内容保持自然亲切，适合桌宠对话场景。',
    '如果提供了 RAG 上下文，你必须优先遵守其中的人设、关系、禁忌、世界观、最近对话记忆与知识片段。',
    '输出格式（JSON Lines）：',
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
