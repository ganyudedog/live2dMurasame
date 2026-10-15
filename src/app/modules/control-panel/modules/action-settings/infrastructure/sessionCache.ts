import { ACTION_SESSION_MESSAGE_LIMIT, type ActionCatalogMessage, type ActionCatalogSession } from '../domain/session';

const STORAGE_KEY = 'pet:action-catalog:sessions';

function readSessions(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

export function readActionSession(modelPath: string): ActionCatalogSession {
  const value = readSessions()[modelPath];
  if (!value || typeof value !== 'object') return { draft: '', messages: [] };
  const session = value as Partial<ActionCatalogSession>;
  const messages = (Array.isArray(session.messages) ? session.messages : []).flatMap((item): ActionCatalogMessage[] => {
    if (!item || typeof item.id !== 'string' || typeof item.text !== 'string'
      || !['user', 'assistant', 'system'].includes(item.role)) return [];
    // 关闭窗口后旧请求不会恢复，避免缓存中的气泡永久显示“处理中”。
    return [{ id: item.id, role: item.role,
      text: item.status === 'sending' ? '上次调整未完成，请重新发送。' : item.text,
      resetsContext: item.resetsContext === true,
      status: item.status === 'sending' || item.status === 'error' ? 'error' : 'done' }];
  }).slice(-ACTION_SESSION_MESSAGE_LIMIT);
  return { draft: typeof session.draft === 'string' ? session.draft : '', messages };
}

export function writeActionSession(modelPath: string, session: ActionCatalogSession): void {
  if (!modelPath) return;
  const sessions = readSessions();
  Object.defineProperty(sessions, modelPath, { value: {
    draft: session.draft, messages: session.messages.slice(-ACTION_SESSION_MESSAGE_LIMIT),
  }, enumerable: true, configurable: true });
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}
