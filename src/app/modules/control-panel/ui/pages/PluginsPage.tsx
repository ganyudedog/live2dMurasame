import { useState } from 'react';
import { ChevronRight, Puzzle } from 'lucide-react';
import { PluginPanelHost } from '@app/modules/plugin/hosts/control-panel/PluginPanelHost';
import type { PluginRecord } from '@app/modules/plugin/core/PluginRuntime';
import type { ControlPanelPage } from '@app/modules/plugin/types';
import { Page } from '../components/common/Page';
import { Field } from '../components/common/SettingsSection';
import { Input } from '../components/common/FormControls';
import { Button } from '../components/common/Button';
import { StatusDot } from '../components/common/Badge';
import { EmptyState, Notice } from '../components/common/Feedback';

export default function PluginsPage({
  pluginDir: savedPluginDir,
  plugins,
  pages,
  onSavePluginDir,
  onOpenPage,
}: {
  pluginDir: string;
  plugins: Iterable<PluginRecord>;
  pages: readonly ControlPanelPage[];
  onSavePluginDir: (pluginDir: string) => void;
  onOpenPage: (tabId: string) => void;
}) {
  const [pluginDir, setPluginDir] = useState(savedPluginDir);
  const [seenPluginDir, setSeenPluginDir] = useState(savedPluginDir);
  if (savedPluginDir !== seenPluginDir) {
    setSeenPluginDir(savedPluginDir);
    setPluginDir(savedPluginDir);
  }
  const records = [...plugins];

  return (
    <Page title="插件" description="已发现的插件默认加载，可进入各插件页面配置。">
      <Field label="运行时插件目录" hint="每个子目录放 manifest.json 和 index.js。保存后重新打开应用才会加载。">
        <div className="flex gap-2">
          <Input className="font-mono" value={pluginDir} placeholder="绝对路径"
            onChange={(event) => setPluginDir(event.target.value)} />
          <Button onClick={() => onSavePluginDir(pluginDir.trim())}>保存</Button>
        </div>
      </Field>
      {records.length === 0 && <EmptyState icon={<Puzzle />} title="暂无插件" />}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {records.map(({ manifest, state, error }) => {
          const ownedPages = pages.filter((page) => page.ownerId === manifest.id);
          return (
            <section key={manifest.id} className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-card">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Puzzle className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-[13px] font-semibold">{manifest.name}</h2>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">{manifest.id} · {manifest.version}</p>
                </div>
                <StatusDot tone={state === 'active' ? 'success' : state === 'failed' ? 'danger' : 'warning'}>
                  {state === 'active' ? '已加载' : state === 'failed' ? '加载失败' : '尚未就绪'}
                </StatusDot>
              </div>
              {error && <Notice tone="danger">{error}</Notice>}
              {ownedPages.length === 0 && state === 'active' && (
                <p className="text-xs text-muted-foreground">仅提供后台能力，无控制面板界面</p>
              )}
              {ownedPages.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                  {ownedPages.map((page) => (
                    <Button key={page.tabId} onClick={() => onOpenPage(page.tabId)}>
                      {page.contribution.title}
                      <ChevronRight />
                    </Button>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      <PluginPanelHost slot="control-panel" />
    </Page>
  );
}
