import { useEffect, useState } from 'react';
import type { PluginStorage } from './types';
import { ASTRBOT_PROTOCOL_VERSION } from './protocol';
import type { BridgeRuntimeStatus } from './status';

const CONNECTION_LABEL = {
  idle: '未连接',
  connecting: '正在连接',
  ready: '已连接',
  closed: '已断开',
  protocol_mismatch: '协议不一致',
} as const;

/** Shows the pet window's last bridge status. The stored record has no message text or secrets. */
export function AstrBotStatusLine({ storage }: { storage: PluginStorage }) {
  const [status, setStatus] = useState<BridgeRuntimeStatus | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      void storage.get<BridgeRuntimeStatus>('status').then((value) => { if (active) setStatus(value ?? null); });
    };
    load();
    const stop = storage.subscribe((key) => { if (key === 'status') load(); });
    return () => { active = false; stop(); };
  }, [storage]);

  if (!status) return <p className="text-[11px] text-muted-foreground">桌面端尚未上报连接状态。</p>;
  const connection = CONNECTION_LABEL[status.connection] ?? '未知';
  const tone = status.connection === 'ready' ? 'bg-success'
    : status.connection === 'connecting' ? 'bg-warning animate-pulse'
      : status.connection === 'idle' ? 'bg-muted-foreground/50' : 'bg-danger';
  return <p className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[11px] leading-snug text-muted-foreground" role="status">
    <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${tone}`} />
    <span className="min-w-0">
      桥接{connection} · 协议 {status.protocol}/{status.expectedProtocol || ASTRBOT_PROTOCOL_VERSION}
      {status.lastRequestId ? ` · 最近请求 ${status.lastRequestId}` : ''}
      {status.lastError ? ` · ${status.lastError.code} ${status.lastError.diagnosticId}` : ''}
    </span>
  </p>;
}
