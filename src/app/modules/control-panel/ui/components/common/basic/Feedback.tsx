import type { ReactNode } from 'react';
import { CircleCheck, Info, LoaderCircle, TriangleExclamationPoint } from 'lucide-react';
import { cn } from './cn';

const NOTICE_TONES = {
  info: { className: 'bg-muted text-muted-foreground', icon: <Info /> },
  busy: { className: 'bg-muted text-muted-foreground', icon: <LoaderCircle className="animate-spin" /> },
  success: { className: 'bg-success/10 text-success', icon: <CircleCheck /> },
  warning: { className: 'bg-warning/12 text-warning', icon: <TriangleExclamationPoint /> },
  danger: { className: 'bg-danger/10 text-danger', icon: <TriangleExclamationPoint /> },
} as const;

/** 卡片内的一行提示；危险色走 role="alert"，其余走 role="status"。 */
export function Notice({ tone = 'info', className, children }: {
  tone?: keyof typeof NOTICE_TONES;
  className?: string;
  children: ReactNode;
}) {
  const meta = NOTICE_TONES[tone];
  return <p role={tone === 'danger' ? 'alert' : 'status'}
    className={cn('flex items-start gap-2 rounded-lg px-2.5 py-2 text-[11px] leading-relaxed', meta.className, className)}>
    <span aria-hidden="true" className="mt-px shrink-0 [&_svg]:size-3.5">{meta.icon}</span>
    <span className="min-w-0 wrap-break-word">{children}</span>
  </p>;
}

export function EmptyState({ icon, title, children, className }: {
  icon?: ReactNode;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return <div className={cn(`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed
    border-border px-6 py-10 text-center`, className)}>
    {icon ? <span aria-hidden="true"
      className="grid size-10 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon}</span> : null}
    {title ? <p className="text-[13px] font-medium text-foreground">{title}</p> : null}
    {children ? <div className="max-w-sm text-xs leading-relaxed text-muted-foreground">{children}</div> : null}
  </div>;
}
