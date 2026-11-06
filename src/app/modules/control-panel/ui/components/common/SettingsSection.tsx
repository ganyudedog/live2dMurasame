import type { ReactNode } from 'react';
import { Switch } from './Switch';
import { cn } from './cn';

/** 设置页统一的卡片：标题行 + 分隔线 + 内容区。 */
export function SettingsCard({ title, description, icon, actions, className, bodyClassName, children }: {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return <section className={cn('rounded-xl bg-card shadow-card', className)}>
    <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? <span aria-hidden="true"
          className="mt-px grid size-6 shrink-0 place-items-center rounded-md bg-primary/10 text-primary [&_svg]:size-3.5">
          {icon}
        </span> : null}
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold leading-6 text-foreground">{title}</h2>
          {description ? <p className="text-[11px] leading-relaxed text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2 self-center">{actions}</div> : null}
    </header>
    <div className={cn('space-y-4 p-4', bodyClassName)}>{children}</div>
  </section>;
}

/** 标签在上、控件在下；hint 说明这个字段是什么。 */
export function Field({ label, hint, aside, className, children }: {
  label: string;
  hint?: ReactNode;
  /** 标签行右侧的附注，例如字数。 */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs font-medium text-foreground/80">{label}</span>
      {aside ? <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">{aside}</span> : null}
    </div>
    {children}
    {hint ? <span className="text-[11px] leading-relaxed text-muted-foreground">{hint}</span> : null}
  </div>;
}

/** 开关行：左标题右开关，整行可点。 */
export function SwitchRow({ label, hint, checked, onChange }: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border
    px-3 py-2.5 transition-colors hover:bg-muted/60">
    <span className="min-w-0">
      <span className="block text-xs font-medium text-foreground">{label}</span>
      {hint ? <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{hint}</span> : null}
    </span>
    <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
  </label>;
}
