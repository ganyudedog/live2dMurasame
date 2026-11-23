import { useEffect, useState } from 'react';
import { BadgeCheck, Copy, Eye, EyeOff, KeyRound, ListChecks } from 'lucide-react';
import type { UiRenderContext } from '../../../src/app/modules/plugin';
import { Field, LoadingCard, SaveFeedback, Section, StatusBanner, SwitchRow, type StatusTone } from '../../ui-kit/layout';
import { BUTTON, GHOST_BUTTON_XS, HINT, INPUT, PRIMARY_BUTTON } from '../../ui-kit/styles';
import { useFeishuState, type FeishuSettings, type FeishuState } from '../ui/useFeishuState';

const describeConnection = (state: FeishuState): { tone: StatusTone; title: string; detail: string } => {
  if (!state.settings?.enabled) {
    return { tone: 'neutral', title: '长连接已关闭', detail: '打开「启用长连接」并应用配置后，飞书里的消息才会转到丛雨这里。' };
  }
  if (!state.petActive) {
    return { tone: 'warning', title: '等待桌宠窗口', detail: '长连接只在桌宠运行时建立，打开桌宠后会自动连上。' };
  }
  switch (state.connection) {
    case 'connected': return { tone: 'success', title: '已连接飞书', detail: '私聊直接回复；群聊里 @ 机器人才会回复。' };
    case 'connecting': return { tone: 'busy', title: '正在连接飞书…', detail: '正在用当前凭据建立长连接。' };
    case 'reconnecting': return { tone: 'warning', title: '连接断开，正在重连', detail: '期间生成的回复会排队，连上后补发。' };
    case 'idle': return { tone: 'neutral', title: '未连接', detail: '应用配置后开始连接。' };
    default: return {
      tone: 'danger',
      title: '连接失败',
      detail: `${state.connection === 'error' ? '' : `${state.connection}。`}请检查 App ID、App Secret，以及下方开发者平台里的准备项。`,
    };
  }
};

const SETUP_STEPS: ReadonlyArray<{ title: string; detail: string }> = [
  { title: '添加「机器人」应用能力', detail: '没有机器人能力时，飞书不会把消息推给应用。' },
  { title: '事件订阅选择「使用长连接接收事件」', detail: '并添加「接收消息」事件，这里不需要公网回调地址。' },
  { title: '开通收发消息的权限', detail: '读取单聊消息、读取群里 @ 机器人的消息，以及以应用身份回复。' },
  { title: '发布版本', detail: '权限和事件改动要发布新版本后才会生效。' },
];

const formatExpiry = (expiresAt: number) => new Date(expiresAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

function ConnectionView({ context }: { context: UiRenderContext }) {
  const state = useFeishuState(context.storage);
  const [draft, setDraft] = useState<FeishuSettings | null>(null);
  const [revealSecret, setRevealSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!saved) return undefined;
    const timer = setTimeout(() => setSaved(false), 1600);
    return () => clearTimeout(timer);
  }, [saved]);

  if (!state.settings) return <LoadingCard>正在读取飞书配置…</LoadingCard>;
  // 没动过草稿时跟随存储，扫码创建应用写回的凭据会直接出现在表单里。
  const form = draft ?? state.settings;
  const dirty = draft !== null && (draft.appId !== state.settings.appId || draft.appSecret !== state.settings.appSecret
    || draft.enabled !== state.settings.enabled);
  const missingCredentials = !form.appId.trim() || !form.appSecret.trim();
  const status = describeConnection(state);

  const update = (patch: Partial<FeishuSettings>) => setDraft({ ...form, ...patch });
  const apply = async () => {
    setSaving(true); setSaveError('');
    try {
      await context.storage.set('settings', form);
      setDraft(null);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally { setSaving(false); }
  };
  const copyApproval = async () => {
    if (!state.approval) return;
    try { await navigator.clipboard.writeText(state.approval.url); } catch { return; }
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return <div className="space-y-4">
    <StatusBanner tone={status.tone} title={status.title} detail={status.detail} />

    {state.approval && <Section icon={<BadgeCheck />} title={`等待授权创建「${state.approval.name}」`}
      description={`把链接复制到浏览器，用飞书扫码确认；${formatExpiry(state.approval.expiresAt)} 前有效，通过后凭据会自动填进来。`}>
      <div className="flex gap-2">
        <input aria-label="授权链接" readOnly value={state.approval.url} className={`${INPUT} flex-1 font-mono`}
          onFocus={(event) => event.currentTarget.select()} />
        <button type="button" className={BUTTON} onClick={() => { void copyApproval(); }}>
          <Copy aria-hidden="true" />
          {copied ? '已复制' : '复制链接'}
        </button>
      </div>
    </Section>}

    <Section icon={<KeyRound />} title="应用凭据"
      description="在飞书开发者后台「凭证与基础信息」里找到；也可以在对话里让丛雨帮你创建一个应用。">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="App ID" htmlFor="feishu-app-id">
          <input id="feishu-app-id" className={`${INPUT} font-mono`} value={form.appId} placeholder="cli_xxxxxxxxxxxx"
            spellCheck={false} autoComplete="off" onChange={(event) => update({ appId: event.target.value })} />
        </Field>
        <Field label="App Secret" htmlFor="feishu-app-secret">
          <div className="relative">
            <input id="feishu-app-secret" className={`${INPUT} w-full pr-8 font-mono`} value={form.appSecret}
              type={revealSecret ? 'text' : 'password'} spellCheck={false} autoComplete="off"
              onChange={(event) => update({ appSecret: event.target.value })} />
            <button type="button" aria-label={revealSecret ? '隐藏 App Secret' : '显示 App Secret'}
              onClick={() => setRevealSecret((value) => !value)}
              className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-md
                text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-3.5">
              {revealSecret ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
            </button>
          </div>
        </Field>
      </div>
      <div className="border-t border-border pt-4">
        <SwitchRow label="启用长连接" checked={form.enabled} onCheckedChange={(enabled) => update({ enabled })}
          description="关闭后不再接收飞书消息，已经排队的回复也会等到下次连接再发。" />
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
        {missingCredentials && form.enabled
          ? <span className="mr-auto text-[11px] text-warning">缺少 App ID 或 App Secret，长连接会启动失败。</span>
          : dirty ? <span className={`mr-auto ${HINT}`}>有未应用的修改</span> : null}
        {dirty && <button type="button" className={GHOST_BUTTON_XS} onClick={() => setDraft(null)}>还原</button>}
        <button type="button" className={PRIMARY_BUTTON} disabled={!dirty || saving} onClick={() => { void apply(); }}>
          {saving ? '正在应用…' : '应用配置'}
        </button>
      </div>
    </Section>

    <Section icon={<ListChecks />} title="开发者平台准备" bodyClassName="p-0"
      description="连不上或收不到消息时，按顺序核对这几项。">
      <ol className="divide-y divide-border">
        {SETUP_STEPS.map((step, index) => <li key={step.title} className="flex gap-3 px-4 py-3">
          <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[10px]
            font-semibold tabular-nums text-muted-foreground">
            {index + 1}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">{step.title}</p>
            <p className={`mt-0.5 ${HINT}`}>{step.detail}</p>
          </div>
        </li>)}
      </ol>
    </Section>

    <SaveFeedback saved={saved} saveError={saveError} />
  </div>;
}

export const ConnectionPage = (context: UiRenderContext) => <ConnectionView context={context} />;
