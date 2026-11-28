import React, { useState, type ComponentType } from 'react';
import {
  Bot, Boxes, ChevronDown, ChevronRight, House, MousePointerClick, Moon, PersonStanding, Puzzle,
  SlidersHorizontal, Sun, UserRound,
} from 'lucide-react';
import type { ControlPanelTabKey, ThemeMode } from '../domain/types';
import { cn } from './components/common/basic/cn';

type MenuItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
};

type MenuGroup = {
  key: string;
  title: string;
  items: MenuItem[];
  collapsible: boolean;
};

/** 插件页面在导航里的样子；icon 由插件提供，缺省时用拼图。 */
export type PluginNavPage = {
  tabId: string;
  title: string;
  icon?: ComponentType<{ className?: string }>;
};

export type PluginNavGroup = {
  key: string;
  title: string;
  pages: readonly PluginNavPage[];
};

const toMenuItem = ({ tabId, title, icon: Icon = Puzzle }: PluginNavPage): MenuItem => ({ key: tabId, label: title, icon: <Icon /> });

const MENU_STRUCTURE: MenuGroup[] = [
  {
    key: 'home',
    title: '主页',
    collapsible: false,
    items: [{ key: 'home', label: '主页', icon: <House /> }],
  },
  {
    key: 'model',
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
    key: 'ai',
    title: 'AI 设置',
    collapsible: true,
    items: [
      { key: 'ai-settings', label: 'AI 设置', icon: <Bot /> },
      { key: 'ai-persona', label: '角色人设', icon: <UserRound /> },
    ],
  },
];

function NavItem({ item, active, onSelect, nested = false }: {
  item: MenuItem;
  active: boolean;
  onSelect: (key: string) => void;
  nested?: boolean;
}) {
  return <li>
    <button type="button" aria-current={active ? 'page' : undefined} onClick={() => onSelect(item.key)}
      className={cn(`group flex w-full cursor-pointer items-center rounded-lg text-left transition-colors duration-150`,
        nested ? 'h-7 gap-2 px-2 text-[12.5px]' : 'h-8 gap-2.5 px-2.5 text-[13px]',
        active
          ? 'bg-card font-medium text-foreground shadow-card dark:bg-primary/12 dark:shadow-none'
          : 'text-muted-foreground hover:bg-foreground/5 hover:text-foreground')}>
      <span aria-hidden="true" className={cn('shrink-0', nested ? '[&_svg]:size-3.5' : '[&_svg]:size-4',
        active ? 'text-primary' : 'text-muted-foreground/80 group-hover:text-foreground')}>{item.icon}</span>
      <span className="truncate">{item.label}</span>
    </button>
  </li>;
}

/** 插件列表下的一个插件：标题行可折叠，页面缩进挂在左侧细线上。 */
function PluginNavBranch({ group, activeTab, expanded, onToggle, onSelect }: {
  group: PluginNavGroup;
  activeTab: string;
  expanded: boolean;
  onToggle: () => void;
  onSelect: (key: string) => void;
}) {
  const containsActive = group.pages.some((page) => page.tabId === activeTab);
  const initial = Array.from(group.title.trim())[0]?.toUpperCase() ?? '?';
  return <li>
    <button type="button" aria-expanded={expanded} onClick={onToggle}
      className={cn(`group flex h-7 w-full cursor-pointer items-center gap-2 rounded-lg px-2 text-left text-[12.5px]
        transition-colors duration-150 hover:bg-foreground/5`,
        containsActive && !expanded ? 'text-foreground' : 'text-muted-foreground hover:text-foreground')}>
      <span aria-hidden="true" className={cn(`grid size-4 shrink-0 place-items-center rounded-[5px] text-[9.5px]
        font-bold leading-none`, containsActive ? 'bg-primary text-primary-foreground' : 'bg-foreground/10 text-foreground/70')}>
        {initial}
      </span>
      <span className="flex-1 truncate">{group.title}</span>
      <ChevronRight aria-hidden="true" className={cn('size-3.5 shrink-0 text-muted-foreground/70 transition-transform',
        expanded && 'rotate-90')} />
    </button>
    {expanded && <ul aria-label={group.title} className="mt-0.5 mb-1 ml-3.75 space-y-0.5 border-l border-border pl-2">
      {group.pages.map((page) => {
        const item = toMenuItem(page);
        return <NavItem key={item.key} item={item} nested active={item.key === activeTab} onSelect={onSelect} />;
      })}
    </ul>}
  </li>;
}

export default function ControlPanelLayout({
  activeTab,
  onTabChange,
  pluginPages = [],
  pluginGroups = [],
  currentModelName,
  theme,
  onToggleTheme,
  children,
}: {
  activeTab: ControlPanelTabKey;
  onTabChange: (key: ControlPanelTabKey) => void;
  /** 没有声明分组的插件页面，直接挂在「插件列表」下面。 */
  pluginPages?: readonly PluginNavPage[];
  /** 插件声明的分组，在「插件列表」下面各自折叠成一支。 */
  pluginGroups?: readonly PluginNavGroup[];
  /** 侧栏底部显示的当前模型；没有模型时不显示。 */
  currentModelName?: string;
  theme: ThemeMode;
  onToggleTheme: () => void;
  children: React.ReactNode;
}) {
  // 记录折叠的组而不是展开的组：插件分组是激活后才出现的，默认应当展开。
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() => new Set());

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const groups: MenuGroup[] = [
    ...MENU_STRUCTURE,
    {
      key: 'plugins',
      title: '插件',
      collapsible: true,
      items: [{ key: 'plugins', label: '插件列表', icon: <Puzzle /> }],
    },
  ];
  const hasPluginRoutes = pluginGroups.length > 0 || pluginPages.length > 0;

  return (
    <div className="grid h-full w-full grid-cols-[240px_minmax(0,1fr)] bg-background font-sans text-foreground antialiased">
      <aside className="flex h-full min-h-0 flex-col border-r border-border bg-sidebar">
        <div className="flex items-center gap-3 px-4 pt-5 pb-4">
          <img aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary
            shadow-sm" src='/logo/love.jpg' />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">live2d 桌宠</p>
            <p className="truncate text-[11px] text-muted-foreground">桌面伙伴 · 控制面板</p>
          </div>
        </div>

        <nav aria-label="控制面板导航" className="ui-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3">
          {groups.map((group) => {
            if (!group.collapsible) {
              return <ul key={group.key} className="space-y-0.5">
                {group.items.map((item) => (
                  <NavItem key={item.key} item={item} active={item.key === activeTab} onSelect={onTabChange} />
                ))}
              </ul>;
            }
            const isExpanded = !collapsedGroups.has(group.key);
            const Chevron = isExpanded ? ChevronDown : ChevronRight;
            return <div key={group.key}>
              <button type="button" aria-expanded={isExpanded} onClick={() => toggleGroup(group.key)}
                className="flex w-full cursor-pointer items-center justify-between rounded-md px-2.5 pb-1.5 text-[11px]
                  font-medium tracking-wide text-muted-foreground/80 transition-colors hover:text-foreground">
                {group.title}
                <Chevron aria-hidden="true" className="size-3.5" />
              </button>
              {isExpanded && <ul className="space-y-0.5">
                {group.items.map((item) => (
                  <NavItem key={item.key} item={item} active={item.key === activeTab} onSelect={onTabChange} />
                ))}
                {group.key === 'plugins' && hasPluginRoutes && <li>
                  <ul aria-label="插件页面" className="mt-1 ml-4.25 space-y-0.5 border-l border-border pl-2">
                    {pluginGroups.map((branch) => (
                      <PluginNavBranch key={branch.key} group={branch} activeTab={activeTab}
                        expanded={!collapsedGroups.has(branch.key)} onToggle={() => toggleGroup(branch.key)}
                        onSelect={onTabChange} />
                    ))}
                    {pluginPages.map((page) => {
                      const item = toMenuItem(page);
                      return <NavItem key={item.key} item={item} nested active={item.key === activeTab}
                        onSelect={onTabChange} />;
                    })}
                  </ul>
                </li>}
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
