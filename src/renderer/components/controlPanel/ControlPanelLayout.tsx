import React from 'react';
import type { ControlPanelTabKey, ThemeMode } from './types';

type TabItem = {
  key: ControlPanelTabKey;
  label: string;
};

const TAB_ITEMS: TabItem[] = [
  { key: 'home', label: '首页' },
  { key: 'models', label: '模型选择' },
  { key: 'interaction', label: '交互设置' },
  { key: 'ai', label: 'AI设置' },
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
  return (
    <div className="h-full w-full grid grid-cols-[300px_1fr] bg-base-200 text-base-content">
      <aside className="h-full w-[300px] border-r border-base-300 bg-base-100 flex flex-col">
        <div className="w-full aspect-3/2 min-h-[200px] h-[clamp(200px,25vh,360px)] border-b border-base-300 flex items-center justify-center">
          <div className="w-[92%] h-[86%] rounded-box border border-dashed border-base-300 bg-base-200 flex items-center justify-center">
            <span className="text-xs text-base-content/60">Logo Area</span>
          </div>
        </div>

        <nav className="flex-1 min-h-0 p-2 space-y-1 overflow-auto">
          {TAB_ITEMS.map((item) => {
            const active = item.key === activeTab;
            return (
              <button
                key={item.key}
                type="button"
                className={
                  active
                    ? 'btn btn-sm w-full justify-start btn-primary'
                    : 'btn btn-sm w-full justify-start btn-ghost'
                }
                onClick={() => onTabChange(item.key)}
              >
                {item.label}
              </button>
            );
          })}
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
          <div className="text-xs text-base-content/60 mt-2">侧栏固定 300px</div>
        </div>
      </aside>

      <main className="h-full min-w-0 overflow-auto">
        {children}
      </main>
    </div>
  );
}
