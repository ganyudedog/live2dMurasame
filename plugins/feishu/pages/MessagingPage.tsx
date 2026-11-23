import type { ReactNode } from 'react';
import { AtSign, FileText, Link2, MessageCircle, Send, TriangleExclamationPoint, UserCheck } from 'lucide-react';
import type { UiRenderContext } from '../../../src/app/modules/plugin';
import { LoadingCard, Section } from '../../ui-kit/layout';
import { ERROR_NOTICE, HINT } from '../../ui-kit/styles';
import { useFeishuState } from '../ui/useFeishuState';

const RULES: ReadonlyArray<{ icon: ReactNode; title: string; detail: string }> = [
  { icon: <MessageCircle />, title: '私聊', detail: '每条消息都会回复。' },
  { icon: <AtSign />, title: '群聊', detail: '只回复 @ 机器人的消息，其余消息不进对话。' },
  { icon: <Link2 />, title: '单独发来的文档链接', detail: '交给云文档工具读取，读完再回答。' },
];

const DOC_TOOLS: ReadonlyArray<{ name: string; detail: string }> = [
  { name: 'feishu.docx.read', detail: '读取 docx 或知识库链接，按页返回正文块' },
  { name: 'feishu.docx.update', detail: '只在你明确要求时，改写某一块的文字' },
];

function Stat({ label, value, tone = 'neutral' }: { label: string; value: ReactNode; tone?: 'neutral' | 'warning' }) {
  return <div className="rounded-lg bg-muted/60 px-3 py-2.5">
    <p className="text-[10px] text-muted-foreground">{label}</p>
    <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone === 'warning' ? 'text-warning' : 'text-foreground'}`}>
      {value}
    </p>
  </div>;
}

function MessagingView({ context }: { context: UiRenderContext }) {
  const state = useFeishuState(context.storage);
  if (!state.settings) return <LoadingCard>正在读取飞书状态…</LoadingCard>;
  const connected = state.settings.enabled && state.petActive && state.connection === 'connected';

  return <div className="space-y-4">
    <Section icon={<Send />} title="回复投递"
      description="回复先排队，再逐条发回飞书；发送失败会自动重试，间隔逐步拉长，最长一分钟。">
      <div className="grid grid-cols-2 gap-2">
        <Stat label="连接" value={connected ? '在线' : '离线'} />
        <Stat label="待发送" value={state.pendingReplies} tone={state.pendingReplies ? 'warning' : 'neutral'} />
      </div>
      {state.deliveryError && <p role="status" className={`flex items-start gap-2 ${ERROR_NOTICE}`}>
        <TriangleExclamationPoint aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0 break-words">回复待发送：{state.deliveryError}</span>
      </p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {RULES.map((rule) => <li key={rule.title} className="flex items-start gap-3 px-3 py-2.5">
          <span aria-hidden="true" className="mt-px grid size-6 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground
            [&_svg]:size-3.5">
            {rule.icon}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium text-foreground">{rule.title}</p>
            <p className={`mt-0.5 ${HINT}`}>{rule.detail}</p>
          </div>
        </li>)}
      </ul>
    </Section>

    <Section icon={<UserCheck />} title="主人识别"
      description="名单不在这里维护：飞书应用的开发者就是主人，在开发者后台「成员管理」里增减。">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
          <p className="text-xs font-medium text-primary">开发者</p>
          <p className={`mt-1 ${HINT}`}>沿用桌面上的关系阶段，发来的文字会写进个人记忆。</p>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="text-xs font-medium text-foreground">其他人</p>
          <p className={`mt-1 ${HINT}`}>照常聊天，但不读关系、不写个人记忆。</p>
        </div>
      </div>
      <p className={HINT}>应用没有读取协作者名单的权限时，查不到身份，所有人都按「其他人」处理。</p>
    </Section>

    <Section icon={<FileText />} title="云文档"
      description="模型通过 CLI 命令读写文档；要先在「AI 设置 → CLI」里允许「飞书」调用 CLI。">
      <ul className="space-y-2">
        {DOC_TOOLS.map((tool) => <li key={tool.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{tool.name}</code>
          <span className={HINT}>{tool.detail}</span>
        </li>)}
      </ul>
      <p className={`border-t border-border pt-3 ${HINT}`}>
        应用还需要开通对应的文档权限：读取用 <code className="font-mono">docx:document:readonly</code>，修改用
        {' '}<code className="font-mono">docx:document</code>，知识库链接另需 <code className="font-mono">wiki:wiki:readonly</code>；
        并把应用加为文档协作者。
      </p>
    </Section>
  </div>;
}

export const MessagingPage = (context: UiRenderContext) => <MessagingView context={context} />;
