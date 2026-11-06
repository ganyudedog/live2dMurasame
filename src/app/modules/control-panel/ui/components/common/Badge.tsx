import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

const TONES = {
  neutral: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/12 text-primary',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/12 text-danger',
  info: 'bg-info/12 text-info',
  outline: 'text-muted-foreground ring-1 ring-inset ring-border',
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({ tone = 'neutral', className, ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cn('inline-flex h-5 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium',
    TONES[tone], className)} {...props} />;
}

/** 小圆点 + 文案的状态提示，用于"已保存 / 正在保存 / 失败"这类轻量状态。 */
export function StatusDot({ tone = 'neutral', pulse = false, children }: {
  tone?: Exclude<BadgeTone, 'outline'>;
  pulse?: boolean;
  children: ReactNode;
}) {
  const dot = {
    neutral: 'bg-muted-foreground/50', primary: 'bg-primary', success: 'bg-success',
    warning: 'bg-warning', danger: 'bg-danger', info: 'bg-info',
  }[tone];
  return <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
    <span aria-hidden="true" className={cn('size-1.5 rounded-full', dot, pulse && 'animate-pulse')} />
    {children}
  </span>;
}
