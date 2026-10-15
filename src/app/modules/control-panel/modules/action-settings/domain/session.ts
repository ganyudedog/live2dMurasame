export interface ActionCatalogMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  status: 'done' | 'sending' | 'error';
  resetsContext?: boolean;
}

export interface ActionCatalogSession {
  draft: string;
  messages: ActionCatalogMessage[];
}

export const ACTION_SESSION_MESSAGE_LIMIT = 40;

/** 引用使用稳定 ID，显示名修改后仍能指向同一个动作。 */
export function actionMention(id: string): string { return `@action:${id}`; }

export function referencedActionIds(text: string): string[] {
  return [...new Set(Array.from(text.matchAll(/(?:^|[^\w@:-])@(?:action:)?([a-z0-9_-]+)(?![a-z0-9_:-])/g),
    (match) => match[1]))];
}

export function activeMention(text: string, cursor: number): { start: number; query: string } | null {
  cursor = Math.min(text.length, Math.max(0, cursor));
  const prefix = text.slice(0, cursor);
  const start = prefix.lastIndexOf('@');
  if (start < 0 || (start > 0 && /[\w@:-]/.test(prefix[start - 1]))) return null;
  const match = /^(?:action:)?([^\s@，。！？、,!?;；:]*)$/i.exec(prefix.slice(start + 1));
  return match ? { start, query: match[1].toLowerCase() } : null;
}
