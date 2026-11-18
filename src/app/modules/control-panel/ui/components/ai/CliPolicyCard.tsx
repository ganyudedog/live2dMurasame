import { observer } from 'mobx-react-lite';
import { useService } from '@app/core/useService';
import { TOKENS } from '@app/core/serviceTokens';
import { Checkbox } from '../common/Checkbox';
import { useEffect, useState } from 'react';
import { commandRequest } from '@app/shared/electron/commandSession';
import { Bot, Plus, X } from 'lucide-react';
import { Field, SettingsCard } from '../common/SettingsSection';
import { Button } from '../common/Button';
import { Input } from '../common/FormControls';
import { Notice } from '../common/Feedback';

interface HostPolicy { shellReadRoots?: string[]; pluginCliWhitelist?: { pluginId: string; cliEnabled: boolean }[] }
interface PolicySnapshot { value: HostPolicy; revision: string }

export const CliPolicyCard = observer(function CliPolicyCard() {
  const runtime = useService(TOKENS.plugin);
  const plugins = [...runtime.plugins.values()];
  const [session, setSession] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [readRoots, setReadRoots] = useState<string[]>([]);
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
        setSources((config.value.pluginCliWhitelist ?? []).filter((entry) => entry.cliEnabled).map((entry) => `plugin:${entry.pluginId}`));
        setSettingsLoaded(true);
      }
    }).catch((reason) => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; if (id) void api.close(id); };
  }, []);

  const saveReadRoots = async () => {
    if (!session || !window.CliAPI || !settingsLoaded || saving) return;
    setSaving(true); setError('');
    try {
      const current = await window.CliAPI.invoke(session, commandRequest('config.get', { scope: 'global' })) as PolicySnapshot;
      const saved = await window.CliAPI.invoke(session, commandRequest('config.update', {
        scope: 'global', expectedRevision: current.revision, patch: { shellReadRoots: readRoots.map((item) => item.trim()).filter(Boolean) },
      })) as PolicySnapshot;
      setReadRoots(saved.value.shellReadRoots ?? []);
      setNotice('已保存');
    } catch (reason) { setError(String(reason)); } finally { setSaving(false); }
  };

  const saveSources = async (next: string[]) => {
    if (!session || !window.CliAPI || !settingsLoaded || saving) return;
    setSaving(true); setError('');
    try {
      const current = await window.CliAPI.invoke(session, commandRequest('config.get', { scope: 'global' })) as PolicySnapshot;
      await window.CliAPI.invoke(session, commandRequest('config.update', {
        scope: 'global', expectedRevision: current.revision,
        patch: { pluginCliWhitelist: next.map((source) => ({ pluginId: source.slice(7), cliEnabled: true })) },
      }));
      setSources(next);
      setNotice('已保存到全局配置');
    } catch (reason) { setError(String(reason)); } finally { setSaving(false); }
  };


  return (
    <SettingsCard title="CLI" icon={<Bot />} className="shrink-0"
    description={'管理可读目录和插件命令权限。'}>
    <>
      <Field label="可读取内容的目录" hint="shell.run 只能在这些目录里读取文件正文。留空则拒绝读取。列目录不受影响。">
        <div className="space-y-2">
          {readRoots.map((directory, index) => <div className="flex gap-2" key={index}>
            <Input aria-label={`可读目录 ${index + 1}`} placeholder="本机目录绝对路径" className="flex-1 font-mono" value={directory}
              onChange={(event) => setReadRoots((items) => items.map((item, i) => i === index ? event.target.value : item))} />
            <Button variant="ghost" size="icon" aria-label={`移除可读目录 ${index + 1}`} title="移除"
              onClick={() => setReadRoots((items) => items.filter((_, i) => i !== index))}><X /></Button>
          </div>)}
          <div className="flex gap-2">
            <Button variant="soft" size="xs" onClick={() => setReadRoots((items) => [...items, ''])}>
              <Plus />
              添加目录
            </Button>
            <Button variant="primary" size="xs" disabled={!session || !settingsLoaded || saving} onClick={() => void saveReadRoots()}>
              保存
            </Button>
          </div>
        </div>
      </Field>
      <Field label="允许调用 CLI 的插件" hint="勾选后立即保存到全局配置；未勾选的插件仍可正常聊天。">
        <div className="space-y-2">
          {plugins.map(({ manifest }) => {
            const source = `plugin:${manifest.id}`;
            return <label key={manifest.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={sources.includes(source)} disabled={!session || !settingsLoaded || saving}
                onCheckedChange={(checked) => void saveSources(checked
                  ? [...new Set([...sources, source])] : sources.filter((item) => item !== source))} />
              <span>{manifest.name}</span>
            </label>;
          })}
          {!plugins.length && <p className="text-sm text-muted-foreground">暂无已注册插件</p>}
        </div>
      </Field>
      {notice && <Notice tone="success">{notice}</Notice>}
    </>
    {error && <Notice tone="danger">{error}</Notice>}
    </SettingsCard>
  );
});
