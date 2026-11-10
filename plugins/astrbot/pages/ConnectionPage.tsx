import { useState } from 'react';
import { Cable, Check, Eye, EyeOff, Workflow } from 'lucide-react';
import type { AstrBotUiContext } from '../types';
import { AstrBotStatusLine } from '../AstrBotStatusLine';
import { HINT, INPUT, TEXTAREA } from '../styles';
import { normalizeWakeWords, type AstrBotBridgeSettings } from '../settings';
import { Field, LoadingCard, SaveFeedback, Section } from '../ui/layout';
import { useBridgeSettings, type BridgeSettingsStore } from '../ui/useBridgeSettings';

const MODES: ReadonlyArray<{
  value: AstrBotBridgeSettings['interactionMode'];
  label: string;
  description: string;
}> = [
  { value: 'queue', label: '排队', description: '所有会话共用一条队列，同一会话也不会并行' },
  { value: 'concurrent', label: '并发', description: '不同会话可以同时生成，同一会话仍按顺序处理' },
  { value: 'interrupt', label: '打断', description: '同一会话的新消息打断正在生成的回复，其他会话不受影响' },
];

/** 连接与触发：桥接地址、令牌，以及哪些消息会被回复、多个会话怎么排队。 */
export function AstrBotConnectionPage(context: AstrBotUiContext) {
  const store = useBridgeSettings(context);
  if (!store.loaded) return <LoadingCard>正在读取插件配置…</LoadingCard>;
  return <ConnectionForm store={store} context={context} />;
}

/** 配置读完才挂载，输入草稿直接用已读到的值初始化。 */
function ConnectionForm({ store, context }: { store: BridgeSettingsStore; context: AstrBotUiContext }) {
  const { settings, update } = store;
  const [revealToken, setRevealToken] = useState(false);
  const [connectionDraft, setConnectionDraft] = useState({ bridgeUrl: settings.bridgeUrl, token: settings.token });
  const [wakeDraft, setWakeDraft] = useState(settings.wakeWords.join('\n'));
  // 数字项也走草稿：每敲一个字符就落盘会让桌面端反复重连。
  const [numberDraft, setNumberDraft] = useState({ maxConcurrent: settings.maxConcurrent, maxQueued: settings.maxQueued });
  const wakeDirty = wakeDraft !== settings.wakeWords.join('\n');

  const commitConnection = () => {
    update({ bridgeUrl: connectionDraft.bridgeUrl, token: connectionDraft.token });
  };

  const commitNumbers = () => {
    update({ maxConcurrent: numberDraft.maxConcurrent, maxQueued: numberDraft.maxQueued });
  };

  return <div className="space-y-4">
    <Section icon={<Cable />} title="桥接连接" description="地址和令牌按回车或离开输入框后生效。">
      <AstrBotStatusLine storage={context.storage} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="桥接地址">
          <input className={`${INPUT} w-full font-mono`} value={connectionDraft.bridgeUrl}
            spellCheck={false} placeholder="ws://127.0.0.1:6198/ws"
            onChange={(event) => setConnectionDraft((current) => ({ ...current, bridgeUrl: event.target.value }))}
            onBlur={commitConnection}
            onKeyDown={(event) => { if (event.key === 'Enter') commitConnection(); }} />
        </Field>

        <Field label="访问令牌">
          <div className="relative">
            <input className={`${INPUT} w-full pr-9 font-mono`} value={connectionDraft.token}
              type={revealToken ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder="可留空"
              onChange={(event) => setConnectionDraft((current) => ({ ...current, token: event.target.value }))}
              onBlur={commitConnection}
              onKeyDown={(event) => { if (event.key === 'Enter') commitConnection(); }} />
            <button type="button" title={revealToken ? '隐藏' : '显示'}
              aria-label={revealToken ? '隐藏访问令牌' : '显示访问令牌'}
              onClick={() => setRevealToken((value) => !value)}
              className="absolute inset-y-0 right-0 flex w-9 cursor-pointer items-center justify-center rounded-r-lg
                text-muted-foreground/70 transition-colors hover:text-foreground">
              {revealToken ? <EyeOff aria-hidden="true" className="size-3.5" /> : <Eye aria-hidden="true" className="size-3.5" />}
            </button>
          </div>
        </Field>
      </div>
    </Section>

    <Section icon={<Workflow />} title="触发与调度" description="决定哪些消息会被回复，以及多个会话同时说话时怎么排。">
      <Field label="群聊唤醒词" hint="一行一个。群聊需要 @ 本机器人，或文本以这里的词开头。只引用、@全体成员、单独 @其他人不会触发。私聊无需唤醒词，仅回复「QQ 用户」页白名单中的用户，主人默认允许。ASCII 词区分边界且不区分大小写；中文词按开头匹配。">
        <textarea className={`${TEXTAREA} h-20 w-full resize-y`} value={wakeDraft}
          aria-label="唤醒词" placeholder={'例如：\n丛雨\n/ai'}
          onChange={(event) => setWakeDraft(event.target.value)}
          onBlur={() => {
            const wakeWords = normalizeWakeWords(wakeDraft);
            setWakeDraft(wakeWords.join('\n'));
            if (wakeDirty) update({ wakeWords });
          }} />
      </Field>

      <Field label="交互策略">
        <div role="radiogroup" aria-label="交互策略" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {MODES.map((item) => {
            const active = item.value === settings.interactionMode;
            return <button key={item.value} type="button" role="radio" aria-checked={active}
              onClick={() => update({ interactionMode: item.value })}
              className={`flex cursor-pointer flex-col gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors ${active
                ? 'border-primary/60 bg-primary/8' : 'border-border hover:border-foreground/25 hover:bg-muted/50'}`}>
              <span className={`flex items-center justify-between gap-2 text-xs font-medium ${active ? 'text-primary' : 'text-foreground'}`}>
                {item.label}
                {active ? <Check aria-hidden="true" className="size-3.5" /> : null}
              </span>
              <span className={HINT}>{item.description}</span>
            </button>;
          })}
        </div>
      </Field>

      <div className="grid grid-cols-2 gap-4 sm:max-w-md">
        <Field label="同时生成上限" hint={settings.interactionMode === 'queue' ? '排队模式固定为 1' : '1 到 8'}>
          <input className={`${INPUT} w-full`} type="number" min={1} max={8}
            aria-label="最大并发"
            value={settings.interactionMode === 'queue' ? 1 : numberDraft.maxConcurrent}
            disabled={settings.interactionMode === 'queue'}
            onChange={(event) => setNumberDraft((current) => ({ ...current, maxConcurrent: Number(event.target.value) }))}
            onBlur={commitNumbers} />
        </Field>
        <Field label="排队上限" hint="0 到 100">
          <input className={`${INPUT} w-full`} type="number" min={0} max={100}
            aria-label="最大排队数" value={numberDraft.maxQueued}
            onChange={(event) => setNumberDraft((current) => ({ ...current, maxQueued: Number(event.target.value) }))}
            onBlur={commitNumbers} />
        </Field>
      </div>
    </Section>

    <SaveFeedback saved={store.saved} saveError={store.saveError} />
  </div>;
}
