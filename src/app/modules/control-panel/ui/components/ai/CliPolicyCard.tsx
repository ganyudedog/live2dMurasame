import { observer } from 'mobx-react-lite';
import { useService } from '@app/core/useService';
import { TOKENS } from '@app/core/serviceTokens';
import { useEffect, useState } from 'react';
import { commandRequest } from '@app/shared/electron/commandSession';
import { Check, FolderOpen, FolderPlus, Plus, SquareTerminal, X } from 'lucide-react';
import { Field, SettingsCard } from '../common/SettingsSection';
import { Button } from '../common/Button';
import { Input } from '../common/FormControls';
import { Notice } from '../common/Feedback';
import { StatusDot } from '../common/Badge';
import { cn } from '../common/cn';

interface HostPolicy { shellReadRoots?: string[]; pluginCliWhitelist?: { pluginId: string; cliEnabled: boolean }[] }
interface PolicySnapshot { value: HostPolicy; revision: string }

const normalizeRoots = (items: readonly string[]) => items.map((item) => item.trim()).filter(Boolean);

export const CliPolicyCard = observer(function CliPolicyCard() {
  const runtime = useService(TOKENS.plugin);
  const plugins = [...runtime.plugins.values()];
  const [session, setSession] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [readRoots, setReadRoots] = useState<string[]>([]);
  const [savedRoots, setSavedRoots] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    setSettingsLoaded(false);
    const api = window.CliAPI;
    if (!api) return;
    let disposed = false;
    let id: string | undefined;
    void api.open({ source: 'local', conversationId: 'desktop' }).then(async (opened) => {
      id = opened ?? undefined;
      if (disposed) { if (opened) await api.close(opened); return; }
      if (!opened) return;
      setSession(opened);
      const config = await api.invoke(opened, commandRequest('config.get', { scope: 'global' })) as PolicySnapshot;
      if (!disposed) {
        setReadRoots(config.value.shellReadRoots ?? []);
        setSavedRoots(config.value.shellReadRoots ?? []);
        setSources((config.value.pluginCliWhitelist ?? []).filter((entry) => entry.cliEnabled).map((entry) => `plugin:${entry.pluginId}`));
        setSettingsLoaded(true);
      }
    }).catch((reason) => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; if (id) void api.close(id); };
  }, []);

  const ready = Boolean(session && settingsLoaded);
  const rootsDirty = normalizeRoots(readRoots).join('\n') !== normalizeRoots(savedRoots).join('\n');

  const saveReadRoots = async () => {
    if (!session || !window.CliAPI || !settingsLoaded || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const current = await window.CliAPI.invoke(session, commandRequest('config.get', { scope: 'global' })) as PolicySnapshot;
      const saved = await window.CliAPI.invoke(session, commandRequest('config.update', {
        scope: 'global', expectedRevision: current.revision, patch: { shellReadRoots: normalizeRoots(readRoots) },
      })) as PolicySnapshot;
      setReadRoots(saved.value.shellReadRoots ?? []);
      setSavedRoots(saved.value.shellReadRoots ?? []);
      setNotice('目录已保存');
    } catch (reason) { setError(String(reason)); } finally { setSaving(false); }
  };

  const saveSources = async (next: string[]) => {
    if (!session || !window.CliAPI || !settingsLoaded || saving) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const current = await window.CliAPI.invoke(session, commandRequest('config.get', { scope: 'global' })) as PolicySnapshot;
      await window.CliAPI.invoke(session, commandRequest('config.update', {
        scope: 'global', expectedRevision: current.revision,
        patch: { pluginCliWhitelist: next.map((source) => ({ pluginId: source.slice(7), cliEnabled: true })) },
      }));
      setSources(next);
      setNotice('权限已保存');
    } catch (reason) { setError(String(reason)); } finally { setSaving(false); }
  };

  const enabledCount = plugins.filter(({ manifest }) => sources.includes(`plugin:${manifest.id}`)).length;

  return (
    <SettingsCard title="CLI" icon={<SquareTerminal />} className="shrink-0"
      description="模型调用命令时能读哪些目录、哪些插件可以登记自己的命令。"
      actions={saving
        ? <StatusDot tone="warning" pulse>正在保存</StatusDot>
        : notice ? <StatusDot tone="success">{notice}</StatusDot> : null}>
      <Field label="可读取内容的目录"
        hint="shell.run 只能在这些目录里读取文件正文；一个都没有时拒绝读取。列目录不受影响。">
        <div className="space-y-1.5">
          {readRoots.length
            ? readRoots.map((directory, index) => <div className="group flex items-center gap-1.5" key={index}>
              <div className="relative flex-1">
                <FolderOpen aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label={`可读目录 ${index + 1}`} placeholder="本机目录绝对路径，例如 D:\notes"
                  className="pl-8 font-mono" value={directory}
                  onChange={(event) => setReadRoots((items) => items.map((item, i) => i === index ? event.target.value : item))} />
              </div>
              <Button variant="ghost" size="icon" aria-label={`移除可读目录 ${index + 1}`} title="移除"
                className="opacity-60 group-hover:opacity-100 hover:text-danger"
                onClick={() => setReadRoots((items) => items.filter((_, i) => i !== index))}><X /></Button>
            </div>)
            : <p className="rounded-lg border border-dashed border-border px-3 py-2.5 text-xs text-muted-foreground">
              还没有可读目录，模型现在读不到任何文件正文。
            </p>}
          <div className="flex items-center gap-2 pt-1">
            <Button variant="ghost" size="xs" className="border border-dashed border-border"
              onClick={() => setReadRoots((items) => [...items, ''])}>
              <FolderPlus />
              添加目录
            </Button>
            <span className="flex-1" />
            {rootsDirty && <span className="text-[11px] text-warning">有未保存的修改</span>}
            <Button variant="primary" size="xs" disabled={!ready || saving || !rootsDirty} onClick={() => void saveReadRoots()}>
              保存目录
            </Button>
          </div>
        </div>
      </Field>
      <Field label="允许调用 CLI 的插件"
        aside={plugins.length ? <span className="tabular-nums">{enabledCount} / {plugins.length} 已允许</span> : undefined}
        hint="点一下切换，立即写进全局配置。没被允许的插件照样能聊天，只是模型用不了它的命令。">
        {plugins.length
          ? <div className="flex flex-wrap gap-1.5">
            {plugins.map(({ manifest }) => {
              const source = `plugin:${manifest.id}`;
              const enabled = sources.includes(source);
              const Icon = enabled ? Check : Plus;
              return <button key={manifest.id} type="button" aria-pressed={enabled} disabled={!ready || saving}
                title={enabled ? `取消 ${manifest.name} 的 CLI 权限` : `允许 ${manifest.name} 调用 CLI`}
                onClick={() => void saveSources(enabled
                  ? sources.filter((item) => item !== source) : [...new Set([...sources, source])])}
                className={cn(`inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs
                  transition-[background-color,color,border-color,transform] duration-150 active:scale-[0.97]
                  focus-visible:ring-2 focus-visible:ring-primary/35 disabled:pointer-events-none disabled:opacity-50`,
                  enabled
                    ? 'border-primary/35 bg-primary/10 font-medium text-primary hover:bg-primary/15'
                    : 'border-border bg-transparent text-muted-foreground hover:border-foreground/20 hover:bg-muted hover:text-foreground')}>
                <Icon aria-hidden="true" className="size-3.5" />
                {manifest.name}
              </button>;
            })}
          </div>
          : <p className="text-xs text-muted-foreground">暂无已注册插件</p>}
      </Field>
      {error && <Notice tone="danger">{error}</Notice>}
    </SettingsCard>
  );
});
