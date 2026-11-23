import { useEffect, useState } from 'react';
import type { UiRenderContext } from '../../../src/app/modules/plugin';

export type FeishuSettings = { appId: string; appSecret: string; enabled: boolean };
export type RegistrationApproval = { name: string; url: string; expiresAt: number };
type PendingReply = { messageId: string };

export interface FeishuState {
  settings: FeishuSettings | null;
  /** idle / connecting / connected / reconnecting / error，启动失败时是错误原文。 */
  connection: string;
  petActive: boolean;
  deliveryError: string;
  pendingReplies: number;
  approval: RegistrationApproval | null;
}

const readSettings = (saved: Partial<FeishuSettings> | undefined): FeishuSettings => ({
  appId: saved?.appId ?? '', appSecret: saved?.appSecret ?? '', enabled: saved?.enabled ?? false,
});

/** 主进程服务写进插件存储的状态，在窗口里只读；只有「应用配置」会写回 settings。 */
export function useFeishuState(storage: UiRenderContext['storage']): FeishuState {
  const [state, setState] = useState<FeishuState>({
    settings: null, connection: 'idle', petActive: false, deliveryError: '', pendingReplies: 0, approval: null,
  });
  useEffect(() => {
    let active = true;
    const patch = (next: Partial<FeishuState>) => { if (active) setState((current) => ({ ...current, ...next })); };
    const readers: Record<string, () => Promise<void>> = {
      settings: async () => patch({ settings: readSettings(await storage.get<Partial<FeishuSettings>>('settings')) }),
      connection: async () => patch({ connection: (await storage.get<string>('connection')) || 'idle' }),
      petActive: async () => patch({ petActive: (await storage.get<boolean>('petActive')) === true }),
      deliveryError: async () => patch({ deliveryError: (await storage.get<string>('deliveryError')) ?? '' }),
      pendingReplies: async () => patch({ pendingReplies: (await storage.get<PendingReply[]>('pendingReplies'))?.length ?? 0 }),
      registrationApproval: async () => {
        const value = await storage.get<RegistrationApproval>('registrationApproval');
        patch({ approval: value && value.expiresAt > Date.now() ? value : null });
      },
    };
    const unsubscribe = storage.subscribe((key) => { void readers[key]?.(); });
    for (const read of Object.values(readers)) void read();
    return () => { active = false; unsubscribe(); };
  }, [storage]);
  return state;
}
