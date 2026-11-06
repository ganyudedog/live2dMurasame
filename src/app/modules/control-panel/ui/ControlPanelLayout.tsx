import React, { useState } from 'react';
import {
  Bot, Boxes, ChevronDown, ChevronRight, House, MousePointerClick, Moon, PersonStanding, Puzzle,
  SlidersHorizontal, Sun, UserRound,
} from 'lucide-react';
import type { ControlPanelTabKey, ThemeMode } from '../domain/types';
import { cn } from './components/common/cn';

type MenuItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
};

type MenuGroup = {
  title: string;
  items: MenuItem[];
  collapsible: boolean;
};

const MENU_STRUCTURE: MenuGroup[] = [
  {
    title: '主页',
    collapsible: false,
    items: [{ key: 'home', label: '主页', icon: <House /> }],
  },
  {
    title: '模型设置',
    collapsible: true,
    items: [
      { key: 'model-manage', label: '模型管理', icon: <Boxes /> },
      { key: 'model-params', label: '参数设置', icon: <SlidersHorizontal /> },
      { key: 'model-motions', label: '动作设置', icon: <PersonStanding /> },
      { key: 'model-interaction', label: '交互设置', icon: <MousePointerClick /> },
    ],
  },
  {
    title: 'AI 设置',
    collapsible: true,
    items: [
      { key: 'ai-settings', label: 'AI 设置', icon: <Bot /> },
      { key: 'ai-persona', label: '角色人设', icon: <UserRound /> },
    ],
  },
];

const PLUGIN_GROUP = '插件';

function NavItem({ item, active, onSelect }: { item: MenuItem; active: boolean; onSelect: (key: string) => void }) {
  return <li>
    <button type="button" aria-current={active ? 'page' : undefined} onClick={() => onSelect(item.key)}
      className={cn(`group flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px]
        transition-colors duration-150`,
      active
        ? 'bg-card font-medium text-foreground shadow-card dark:bg-primary/12 dark:shadow-none'
        : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground')}>
      <span aria-hidden="true" className={cn('shrink-0 [&_svg]:size-4',
        active ? 'text-primary' : 'text-muted-foreground/80 group-hover:text-foreground')}>{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </button>
  </li>;
}

export default function ControlPanelLayout({
  activeTab,
  onTabChange,
  pluginPages = [],
  currentModelName,
  theme,
  onToggleTheme,
  children,
}: {
  activeTab: ControlPanelTabKey;
  onTabChange: (key: ControlPanelTabKey) => void;
  pluginPages?: readonly { tabId: string; title: string }[];
  /** 侧栏底部显示的当前模型；没有模型时不显示。 */
  currentModelName?: string;
  theme: ThemeMode;
  onToggleTheme: () => void;
  children: React.ReactNode;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['模型设置', 'AI 设置', PLUGIN_GROUP])
  );

  const toggleGroup = (title: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      return next;
    });
  };

  const groups: MenuGroup[] = [...MENU_STRUCTURE, {
    title: PLUGIN_GROUP,
    collapsible: true,
    items: [
      { key: 'plugins', label: '插件列表', icon: <Puzzle /> },
      ...pluginPages.map((page) => ({ key: page.tabId, label: page.title, icon: <Puzzle /> })),
    ],
  }];

  return (
    <div className="grid h-full w-full grid-cols-[240px_minmax(0,1fr)] bg-background font-sans text-foreground antialiased">
      <aside className="flex h-full min-h-0 flex-col border-r border-border bg-sidebar">
        <div className="flex items-center gap-3 px-4 pt-5 pb-4">
          <div aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary
            text-[15px] font-bold text-primary-foreground shadow-sm">
            丛
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">丛雨 Murasame</p>
            <p className="truncate text-[11px] text-muted-foreground">桌面伙伴 · 控制面板</p>
          </div>
        </div>

        <nav aria-label="控制面板导航" className="ui-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3">
          {groups.map((group) => {
            if (!group.collapsible) {
              return <ul key={group.title} className="space-y-0.5">
                {group.items.map((item) => (
                  <NavItem key={item.key} item={item} active={item.key === activeTab} onSelect={onTabChange} />
                ))}
              </ul>;
            }
            const isExpanded = expandedGroups.has(group.title);
            const Chevron = isExpanded ? ChevronDown : ChevronRight;
            return <div key={group.title}>
              <button type="button" aria-expanded={isExpanded} onClick={() => toggleGroup(group.title)}
                className="flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 pb-1.5 text-[11px]
                  font-medium tracking-wide text-muted-foreground/80 transition-colors hover:text-foreground">
                {group.title}
                <Chevron aria-hidden="true" className="size-3.5" />
              </button>
              {isExpanded && <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <NavItem key={item.key} item={item} active={item.key === activeTab} onSelect={onTabChange} />
                ))}
              </ul>}
            </div>;
          })}
        </nav>

        <div className="space-y-2 border-t border-border p-3">
          {currentModelName && (
            <button type="button" onClick={() => onTabChange('model-manage')} title="切换模型"
              className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors
                hover:bg-foreground/5">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-success ring-3 ring-success/20" />
              <span className="min-w-0 flex-1">
                <span className="block text-[10px] text-muted-foreground">当前模型</span>
                <span className="block truncate text-xs font-medium">{currentModelName}</span>
              </span>
              <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          )}
          <div role="radiogroup" aria-label="主题" className="grid grid-cols-2 gap-1 rounded-lg bg-foreground/5 p-0.5">
            {(['light', 'dark'] as const).map((mode) => {
              const active = theme === mode;
              const Icon = mode === 'light' ? Sun : Moon;
              return <button key={mode} type="button" role="radio" aria-checked={active}
                onClick={() => { if (!active) onToggleTheme(); }}
                className={cn('flex h-7 cursor-pointer items-center justify-center gap-1.5 rounded-md text-[11px] transition-all',
                  active ? 'bg-card font-medium text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground')}>
                <Icon aria-hidden="true" className="size-3.5" />
                {mode === 'light' ? '亮色' : '深色'}
              </button>;
            })}
          </div>
        </div>
      </aside>

      <main className="h-full min-h-0 min-w-0 overflow-hidden">
        {children}
      </main>
    </div>
  );
}
