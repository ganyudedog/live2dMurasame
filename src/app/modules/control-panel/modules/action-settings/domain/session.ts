import type { GenerationTaskState } from '@app/modules/ai/modules/llm/domain/action-catalog/generation';

export interface ActionCatalogMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  status: 'done' | 'sending' | 'error';
  resetsContext?: boolean;
  /** 保存后的表现建议，属于编辑会话，不进入运行时动作协议。 */
  reviewNotes?: Array<{ actionId: string; message: string }>;
  /** 长任务运行状态，便于刷新后继续理解当前版本和待处理问题。 */
  task?: GenerationTaskState & { currentStep?: string };
  reasoningSummary?: string;
}

export interface ActionCatalogSession {
  draft: string;
  messages: ActionCatalogMessage[];
  /** 本会话选择的推理深度；缺省视为关闭。 */
  reasoningEffort?: PetReasoningEffort;
}

export const ACTION_SESSION_MESSAGE_LIMIT = 40;

/**
 * 输入框里的引用：整体是一个标签，插入的文本就是显示名（不带 @），
 * 排版长度按显示名计算、整块删除；稳定 ID 只在发送给模型前还原。
 */
export function actionMention(action: { id: string; label: string }): string {
  return action.label.trim() || action.id;
}

export function referencedActionIds(text: string,
  actions: ReadonlyArray<{ id: string; label: string }> = []): string[] {
  const ids = new Set(Array.from(text.matchAll(/(?:^|[^\w@:-])@(?:action:)?([a-z0-9_-]+)(?![a-z0-9_:-])/g),
    (match) => match[1]));
  // 标签文本是显示名：按名称回填稳定 ID；未知名称交给服务层校验。
  for (const action of actions) {
    const label = action.label.trim();
    if (label && text.includes(label)) ids.add(action.id);
  }
  return [...ids];
}

/** 交给模型的指令把显示名标签还原成 @action:<id>，与动作目录的书写保持一致。 */
export function replaceMentionsWithIds(text: string,
  actions: ReadonlyArray<{ id: string; label: string }>): string {
  let result = text;
  for (const action of [...actions].sort((left, right) => right.label.length - left.label.length)) {
    const label = action.label.trim();
    if (label) result = result.replaceAll(label, `@action:${action.id}`);
  }
  return result;
}

export function activeMention(text: string, cursor: number): { start: number; query: string } | null {
  cursor = Math.min(text.length, Math.max(0, cursor));
  const prefix = text.slice(0, cursor);
  const start = prefix.lastIndexOf('@');
  if (start < 0 || (start > 0 && /[\w@:-]/.test(prefix[start - 1]))) return null;
  const match = /^(?:action:)?([^\s@，。！？、,!?;；:]*)$/i.exec(prefix.slice(start + 1));
  return match ? { start, query: match[1].toLowerCase() } : null;
}
