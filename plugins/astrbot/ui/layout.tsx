import type { ReactNode } from 'react';
import { Check, TriangleExclamationPoint } from 'lucide-react';
import { HINT, LABEL } from '../styles';

export function LoadingCard({ children }: { children: ReactNode }) {
  return <p className={`rounded-xl bg-card p-4 shadow-card ${HINT}`}>{children}</p>;
}

/** 保存结果浮在右下角：设置分散在多张卡里，固定位置的提示不会让版面跳动。 */
export function SaveFeedback({ saved, saveError }: { saved: boolean; saveError: string }) {
  if (saveError) {
    return <div role="alert" className="fixed right-6 bottom-5 z-40 flex max-w-sm items-start gap-2 rounded-lg bg-card px-3 py-2
      text-[11px] leading-relaxed text-danger shadow-pop">
      <TriangleExclamationPoint aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      保存失败：{saveError}
    </div>;
  }
  if (!saved) return null;
  return <div role="status" className="pointer-events-none fixed right-6 bottom-5 z-40 flex items-center gap-1.5 rounded-full
    bg-card px-3 py-1.5 text-[11px] text-success shadow-pop animate-[ui-pop-in_180ms_ease-out]">
    <Check aria-hidden="true" className="size-3.5" />
    已保存
  </div>;
}

/** 插件页里的一张卡：图标 + 标题 + 说明，右侧放状态或操作；与宿主设置卡用同一套主题令牌。 */
export function Section({ icon, title, description, actions, bodyClassName = 'space-y-4 p-4', children }: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return <section className="rounded-xl bg-card shadow-card">
    <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <span aria-hidden="true"
          className="mt-px grid size-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary [&_svg]:size-3.5">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold leading-6 text-foreground">{title}</h2>
          {description ? <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 self-center">{actions}</div> : null}
    </header>
    <div className={bodyClassName}>{children}</div>
  </section>;
}

/** 标签在上、控件在下；只有需要解释的字段才带 hint，warn 用于「不处理会失败」的提示。 */
export function Field({ label, hint, tone = 'muted', aside, className = '', children }: {
  label: ReactNode;
  hint?: ReactNode;
  tone?: 'muted' | 'warn';
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
    <div className="flex items-baseline justify-between gap-2">
      <span className={LABEL}>{label}</span>
      {aside ? <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">{aside}</span> : null}
    </div>
    {children}
    {hint ? <span className={tone === 'warn' ? 'text-[11px] leading-snug text-warning' : HINT}>{hint}</span> : null}
  </div>;
}
