import type { ReactNode } from 'react';
import { cn } from './cn';

/**
 * 页面骨架：标题行固定在顶部，内容区独立滚动。
 * fill 用于对话类页面，内容撑满剩余高度而不是整页滚动。
 */
export function Page({ title, description, actions, meta, fill = false, className, children }: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** 标题右侧的轻量状态（保存状态、计数等）。 */
  meta?: ReactNode;
  fill?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return <div className="flex h-full min-h-0 flex-col">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border
      bg-background/80 px-6 py-4 backdrop-blur">
      <div className="min-w-0">
        <h1 className="text-base font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
      </div>
      {(meta || actions) ? <div className="flex shrink-0 items-center gap-3">
        {meta}
        {actions}
      </div> : null}
    </header>
    <div className={cn('min-h-0 flex-1', fill
      ? 'flex flex-col gap-3 p-4'
      : 'ui-scroll overflow-y-auto', className)}>
      {fill ? children : <div className="mx-auto w-full max-w-4xl space-y-4 px-6 py-5">{children}</div>}
    </div>
  </div>;
}
