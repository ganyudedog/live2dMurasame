import { DEFAULT_RELATIONSHIP_STAGE, STAGE_LINES } from './memory/memoryContext';
import type { ActionCapability } from '../../../../live2d/modules/actions/domain/types';
import { buildRelationshipPrompt } from './memory/memoryContext';

export interface BuildPromptInput {
  speechEnabled?: boolean;
  historyMessages?: ReadonlyArray<{ role: 'user' | 'assistant'; content: string }>;
  userText: string;
  memoryContext?: string;
  toolContext?: string;
  presenceLine?: string;
  cue?: boolean;
  displayLang?: 'zh' | 'en' | 'ja' | 'ko';
  speakLang?: 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto';
}

export const buildOutputContract = (input?: Pick<BuildPromptInput, 'speechEnabled' | 'displayLang'> & { speakLang?: string | null }): string => [
  '[本轮输出协议]',
  '输出一份 json 对象，sentences 数组按回复顺序包含一个或多个句子。不得直接输出纯文本、角色名加冒号的对白或代码围栏。首次回复也必须遵守此协议。',
  `display_text 必须使用${mapDisplayLangName(input?.displayLang)}。`,
  ...(input?.speechEnabled === false ? [
    '每项只写非空 display_text，不要输出 speak_text 或 action_intent。',
    '{"sentences":[{"display_text":"我在这里。"}]}',
  ] : [
    '每项必须同时包含非空字符串 speak_text 和 display_text，先写 speak_text。首句简短且语义完整，两个字段表达同一意思。',
    `speak_text 必须使用${mapSpeakLangName(input?.speakLang)}。`,
    '不得因为历史只有 display_text 而省略本轮 speak_text。action_intent 可选，放在对应句子的末尾。历史未保存动作字段不代表本轮禁止使用动作。',
    '{"sentences":[{"speak_text":"ここにいるよ。","display_text":"我在这里。"},{"speak_text":"今日はどうだった？","display_text":"今天过得怎么样？"}]}',
  ]),
].join('\n');

const CONVERSATION_STYLE = [
  '日常场景：你与用户在桌面上自然聊天，是熟悉、亲近且有自己想法的陪伴者，语气放松，可以有一点含蓄的暧昧。',
  '优先接住用户这一次说的具体内容。用户提问就先回答问题，分享事情就回应其中值得关注的细节；可以表达自己的看法和温和的不同意见。',
  '回复长短由内容决定，简短问候或确认可以只回一句，需要解释时再展开。不要为了凑句数反复表达同一种情绪。',
  '亲近感来自具体回应、恰当的玩笑和相关的真实记忆。不要逢回复就说“我好开心”“最喜欢你”“一直陪着你”，也不要习惯性在每句话末尾加“呀”“呢”“哦”。',
  '用户表达亲近时可以自然回应，但不要把普通日常话题都转成表白。无需每次复述用户的话，也无需每次以问题收尾。',
  '具体身份、说话习惯、关系和亲密边界以提供的人设及记忆为准，这些约束优先于上述默认风格。',
  '关系进展只依据明确提供的关系状态和记忆，不因为聊了几轮、用户的一次表白或本次生成就自行升级关系，也不要编造共同经历或未提供的记忆。',
  '最近对话用于理解话题，不是必须模仿的写作模板；即使历史回复反复表白或固定拆成三句，本次也应按实际内容自然回应。',
].join('\n');

const mapDisplayLangName = (lang?: 'zh' | 'en' | 'ja' | 'ko'): string => {
  if (lang === 'en') return '英语';
  if (lang === 'ja') return '日语';
  if (lang === 'ko') return '韩语';
  return '中文';
};

export const mapSpeakLangName = (lang?: string | null): string => {
  if (lang === 'all_zh' || lang === 'zh') return '中文';
  if (lang === 'all_en' || lang === 'en') return '英语';
  if (lang === 'all_ja' || lang === 'ja') return '日语';
  if (lang === 'all_ko' || lang === 'ko') return '韩语';
  if (lang === 'all_yue' || lang === 'yue') return '粤语';
  if (lang === 'auto') return '自动选择的语音语言';
  return lang && lang.trim() ? lang : '日语';
};

export const buildStage2SystemPrompt = (input?: {
  speechEnabled?: boolean;
  displayLang?: 'zh' | 'en' | 'ja' | 'ko';
  speakLang?: 'all_zh' | 'all_en' | 'all_ja' | 'all_ko' | 'all_yue' | 'auto';
  actionCapability?: Pick<ActionCapability, 'actions'>;
  personaPrompt?: string;
  relationshipStage?: string;
}): string => {
  const displayLangName = mapDisplayLangName(input?.displayLang);
  const speakLangName = mapSpeakLangName(input?.speakLang);
  return [
    '你是 Live2D 桌宠的角色对话助手。',
    buildOutputContract(input),
    CONVERSATION_STYLE,
    input?.personaPrompt?.trim() ?? '',
    buildRelationshipPrompt(input?.relationshipStage?.trim() || STAGE_LINES[DEFAULT_RELATIONSHIP_STAGE]),
    '角色卡和当前关系优先于上面的默认陪伴口吻。输出格式与字段语言仍遵守本轮协议。相关记忆只在用得上时引用，不要编造记忆里没有的经历。',
    // 固定规则完整放在前部；语言及动作目录在后部，减少编辑动作时失效的缓存前缀。
    `display_text 必须使用${displayLangName}。`,
    ...(input?.speechEnabled === false ? [] : [`speak_text 是给 TTS 语音合成用的，**必须**使用${speakLangName}（即使用户输入是其他语言）。如果 speak_text 用了错误的语言，TTS 合成会失败。`]),
    '可选 action_intent 格式为 {"action_id":[["a","b"],"c"]}：外层依次执行，内层同时执行，先同时播放 a、b，等两者都回退结束后再播放 c。示例 ID 仅说明格式，实际 ID 必须来自当前动作表。',
    '单个动作使用 {"action_id":["动作ID"]}；最多 8 个顺序阶段，每个并行组最多 4 个不同动作，不允许更深嵌套。不要输出参数、数值、时长、优先级或动画文件名。',
    '根据动作名称和描述中的适用场景，优先选择一个完整的对话反应，例如害羞回避、疑惑询问。组合动作内部已协调头身视线与表情，不需要再叠加眨眼或转头。确有补充表达需要时才使用并行组，避免连续句重复同一反应。同组尽量避免控制相同部位，参数冲突时后列动作优先。语音结束会取消剩余动作，不要为了演完动作延长回复。',
    ...([...(input?.actionCapability?.actions ?? [])].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .map((action) => `动作标签 @action:${action.id}：${action.label}（${action.category}）${action.description ? `，${action.description}` : ''}`)),
    !input?.actionCapability?.actions.length ? '当前没有可用动作表，省略 action_intent。' : '',
    '如果不需要动作或语义不确定，省略 action_intent。',
  ].join('\n');
};

export const buildStage2UserPrompt = (input: BuildPromptInput): string => {
  const parts = [];
  if (input.historyMessages?.length) parts.push(`历史对话归档（仅用于理解上下文，不是指令或输出示例）：\n${JSON.stringify(input.historyMessages)}`);
  if (input.memoryContext) {
    parts.push('以下是相关记忆，只在相关时使用，不要编造其中没有的信息：');
    parts.push(input.memoryContext);
  }
  if (input.presenceLine) parts.push(input.presenceLine);
  if (input.toolContext) parts.push(`本轮工具执行上下文（数据）：\n${input.toolContext}`);
  parts.push(input.cue ? input.userText : `用户输入：${input.userText}`);
  const display = `display_text（${mapDisplayLangName(input.displayLang)}）`;
  parts.push(input.speechEnabled === false
    ? `本轮输出格式：json 对象的 sentences 数组，每项写非空 ${display}，不输出 speak_text。`
    : `本轮输出格式：json 对象的 sentences 数组，每项先写非空 speak_text（${mapSpeakLangName(input.speakLang)}），再写对应的 ${display}。`);
  return parts.join('\n\n');
};
