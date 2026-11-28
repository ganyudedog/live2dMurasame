import type { ReactNode } from 'react';
import { cn } from './cn';

export interface SegmentedTab<K extends string> {
  key: K;
  label: string;
  icon?: ReactNode;
  /** 标签下方的一行状态，例如"3 个模型"。 */
  caption?: string;
  /** 标签右侧的计数气泡。 */
  count?: number;
  /** 计数为警示色（例如空池）。 */
  warn?: boolean;
}

/** 分段切换：按数量平分宽度，选中项浮起成卡片。 */
export function SegmentedTabs<K extends string>({ items, value, onChange, label }: {
  items: ReadonlyArray<SegmentedTab<K>>;
  value: K | null;
  onChange: (key: K) => void;
  label: string;
}) {
  return <div role="tablist" aria-label={label} className="flex items-stretch gap-1 rounded-xl bg-muted p-1">
    {items.map((item) => {
      const active = item.key === value;
      return <button key={item.key} type="button" role="tab" aria-selected={active}
        onClick={() => onChange(item.key)}
        className={cn(`flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg px-3 text-left
          transition-all duration-150 active:scale-[0.98]`,
        item.caption ? 'py-2' : 'py-1.5',
        active
          ? 'bg-card text-foreground shadow-card'
          : 'text-muted-foreground hover:bg-card/50 hover:text-foreground')}>
        {item.icon ? <span aria-hidden="true"
          className={cn('shrink-0 [&_svg]:size-4', active ? 'text-primary' : '')}>{item.icon}</span> : null}
        <span className={cn('flex min-w-0 flex-col', !item.caption && 'items-center')}>
          <span className="truncate text-[13px] font-medium" title={item.label}>{item.label}</span>
          {item.caption ? <span className="truncate text-[11px] text-muted-foreground">{item.caption}</span> : null}
        </span>
        {item.count !== undefined ? <span aria-hidden="true"
          className={cn('grid h-4.5 min-w-4.5 shrink-0 place-items-center rounded-full px-1 text-[10px] tabular-nums',
            item.warn ? 'bg-warning/15 text-warning'
              : active ? 'bg-primary/12 text-primary' : 'bg-foreground/8 text-muted-foreground')}>
          {item.count}
        </span> : null}
      </button>;
    })}
  </div>;
}
