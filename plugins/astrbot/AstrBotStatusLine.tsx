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

const CHIP = 'rounded-md bg-card/70 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground';

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

  if (!status) {
    return <div role="status" className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-muted-foreground/40" />
      <span className="text-[11px] text-muted-foreground">桌面端尚未上报连接状态。</span>
    </div>;
  }
  const connection = CONNECTION_LABEL[status.connection] ?? '未知';
  const tone = status.connection === 'ready' ? { dot: 'bg-success ring-success/20', box: 'bg-success/8' }
    : status.connection === 'connecting' ? { dot: 'animate-pulse bg-warning ring-warning/20', box: 'bg-warning/10' }
      : status.connection === 'idle' ? { dot: 'bg-muted-foreground/50 ring-muted-foreground/15', box: 'bg-muted' }
        : { dot: 'bg-danger ring-danger/20', box: 'bg-danger/8' };
  return <div role="status" className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg px-3 py-2.5 ${tone.box}`}>
    <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ring-3 ${tone.dot}`} />
    <span className="text-xs font-medium text-foreground">桥接{connection}</span>
    <span className="flex min-w-0 flex-wrap gap-1.5">
      <span className={CHIP}>协议 {status.protocol}/{status.expectedProtocol || ASTRBOT_PROTOCOL_VERSION}</span>
      {status.lastRequestId ? <span className={CHIP}>最近请求 {status.lastRequestId}</span> : null}
      {status.lastError
        ? <span className={`${CHIP} text-danger`}>{status.lastError.code} {status.lastError.diagnosticId}</span>
        : null}
    </span>
  </div>;
}
