import React, { useState } from 'react';
import type { ControlPanelTabKey, ThemeMode } from '../domain/types';

type MenuItem = {
  key: ControlPanelTabKey;
  label: string;
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
    items: [{ key: 'home', label: '主页' }],
  },
  {
    title: '模型设置',
    collapsible: true,
    items: [
      { key: 'model-manage', label: '模型管理' },
      { key: 'model-params', label: '参数设置' },
      { key: 'model-motions', label: '动作设置' },
      { key: 'model-interaction', label: '交互设置' },
    ],
  },
  {
    title: 'AI 设置',
    collapsible: true,
    items: [
      { key: 'ai-settings', label: 'AI 设置' },
      { key: 'ai-tts', label: 'TTS 设置' },
      { key: 'ai-rag', label: 'RAG 设置' },
      { key: 'ai-rag-params', label: 'RAG 参数' },
    ],
  },
];

export default function ControlPanelLayout({
  activeTab,
  onTabChange,
  theme,
  onToggleTheme,
  children,
}: {
  activeTab: ControlPanelTabKey;
  onTabChange: (key: ControlPanelTabKey) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  children: React.ReactNode;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['模型设置', 'AI 设置'])
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

  return (
    <div className="h-full w-full grid grid-cols-[300px_1fr] bg-base-200 text-base-content">
      <aside className="h-full w-75 border-r border-base-300 bg-base-100 flex flex-col">
        <div className="w-full aspect-3/2 min-h-50 h-[clamp(200px,25vh,360px)] border-b border-base-300 flex items-center justify-center">
          <div className="w-[92%] h-[86%] rounded-box border border-dashed border-base-300 bg-base-200 flex items-center justify-center">
            <span className="text-xs text-base-content/60">Logo Area</span>
          </div>
        </div>

        <nav className="flex-1 min-h-0 p-2 overflow-auto">
          <ul className="menu bg-base-100 rounded-box w-full">
            {MENU_STRUCTURE.map((group) => {
              if (!group.collapsible) {
                // 主页作为普通 menu item
                return group.items.map((item) => {
                  const active = item.key === activeTab;
                  return (
                    <li key={item.key}>
                      <a
                        href="#"
                        className={active ? 'active bg-primary text-primary-content' : ''}
                        onClick={(e) => {
                          e.preventDefault();
                          onTabChange(item.key);
                        }}
                      >
                        {item.label}
                      </a>
                    </li>
                  );
                });
              }

              const isExpanded = expandedGroups.has(group.title);
              return (
                <li key={group.title}>
                  <details open={isExpanded}>
                    <summary
                      onClick={(e) => {
                        e.preventDefault();
                        toggleGroup(group.title);
                      }}
                    >
                      {group.title}
                    </summary>
                    <ul>
                      {group.items.map((item) => {
                        const active = item.key === activeTab;
                        return (
                          <li key={item.key}>
                            <a
                              href="#"
                              className={active ? 'active bg-primary text-primary-content' : ''}
                              onClick={(e) => {
                                e.preventDefault();
                                onTabChange(item.key);
                              }}
                            >
                              {item.label}
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="p-3 border-t border-base-300">
          <div className="flex items-center justify-between">
            <span className="text-sm">主题</span>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={onToggleTheme}
              title="切换亮/暗主题"
            >
              {theme === 'dark' ? '深色' : '亮色'}
            </button>
          </div>
        </div>
      </aside>

      <main className="h-full min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
