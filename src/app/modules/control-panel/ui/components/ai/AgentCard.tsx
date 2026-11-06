import { useEffect, useState } from 'react';
import type { AgentSettings, AgentTask } from '../../../../../../../shared/cli/contracts';
import { commandRequest } from '@app/shared/electron/commandSession';
import { Bot, LoaderCircle, Plus, Save, X } from 'lucide-react';
import { Field, SettingsCard } from '../common/SettingsSection';
import { Button } from '../common/Button';
import { Input, Textarea } from '../common/FormControls';
import { StatusDot } from '../common/Badge';
import { Notice } from '../common/Feedback';

const statusLabels = { queued: '排队中', running: '执行中', cancelling: '正在取消', succeeded: '完成', failed: '失败', cancelled: '已取消', interrupted: '已中断' };

/** Projection of Electron tasks; mounting/unmounting never owns their execution. */
export function AgentCard({ settings = false }: { settings?: boolean }) {
  const [session, setSession] = useState<string | null>(null);
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [workspaces, setWorkspaces] = useState<AgentSettings['workspaces']>([]);
  const [sources, setSources] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const api = window.CliAPI;
    if (!api) return;
    let disposed = false;
    let id: string | undefined;
    let off: (() => void) | undefined;
    const merge = (updates: AgentTask[]) => setTasks((previous) => {
      const combined = new Map(previous.map((task) => [task.id, task]));
      updates.forEach((task) => { if ((combined.get(task.id)?.sequence ?? -1) <= task.sequence) combined.set(task.id, task); });
      return [...combined.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
    });
    void api.open({ source: 'local', conversationId: 'desktop' }).then(async (opened) => {
      id = opened;
      if (disposed) { await api.close(opened); return; }
      setSession(opened);
      off = api.onTask(opened, ({ task }) => { if (!disposed) merge([task]); });
      const snapshot = await api.tasks(opened);
      if (!disposed) merge(snapshot);
      if (settings) {
        const config = await api.invoke(opened, commandRequest('agent.settings.get')) as AgentSettings;
        if (!disposed) { setWorkspaces(config.workspaces); setSources(config.remoteSources.join('\n')); }
      }
    }).catch((reason) => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; off?.(); if (id) void api.close(id); };
  }, [settings]);
  const save = async () => {
    if (!session || !window.CliAPI) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await window.CliAPI.invoke(session, commandRequest('agent.settings.update', { workspaces,
        remoteSources: sources.split('\n').map((value) => value.trim()).filter(Boolean) }));
      setNotice('已保存。可在本地聊天或已授权插件中请求开发任务。');
    } catch (reason) { setError(String(reason)); } finally { setSaving(false); }
  };
  if (!settings && !tasks.length && !error) return null;
  return <SettingsCard title="Agent · Codex" icon={<Bot />} className="shrink-0"
    description={settings ? '使用本机 Codex 登录。添加项目后，可直接在聊天中提出开发需求。' : undefined}
    actions={settings ? <Button variant="primary" disabled={!session || saving} onClick={() => void save()}>
      {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
      保存 Agent 设置
    </Button> : undefined}>
    {settings && <>
      <Field label="项目">
        <div className="space-y-2">
          {workspaces.map((workspace, index) => <div className="flex gap-2" key={index}>
            <Input aria-label={`项目标识 ${index + 1}`} placeholder="项目标识" className="w-36 font-mono" value={workspace.id}
              onChange={(event) => setWorkspaces((items) => items.map((item, i) => i === index ? { ...item, id: event.target.value } : item))} />
            <Input aria-label={`项目目录 ${index + 1}`} placeholder="本机项目绝对路径" className="flex-1 font-mono" value={workspace.path}
              onChange={(event) => setWorkspaces((items) => items.map((item, i) => i === index ? { ...item, path: event.target.value } : item))} />
            <Button variant="ghost" size="icon" aria-label={`移除项目 ${index + 1}`} title="移除"
              onClick={() => setWorkspaces((items) => items.filter((_, i) => i !== index))}><X /></Button>
          </div>)}
          <Button variant="soft" size="xs" onClick={() => setWorkspaces((items) => [...items, { id: '', path: '' }])}>
            <Plus />
            添加项目
          </Button>
        </div>
      </Field>
      <Field label="允许操作本机的远程插件来源" hint="每行一个 plugin:插件ID；留空仅允许本地。">
        <Textarea className="min-h-20 font-mono" value={sources} onChange={(event) => setSources(event.target.value)} />
      </Field>
      {notice && <Notice tone="success">{notice}</Notice>}
    </>}
    {error && <Notice tone="danger">{error}</Notice>}
    {tasks.length > 0 && <div className="ui-scroll max-h-48 space-y-2 overflow-auto">{tasks.map((task) => {
      const live = ['queued', 'running'].includes(task.status);
      return <div key={task.id} className="space-y-1 rounded-lg bg-muted/60 px-3 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="font-medium">{task.workspaceId}</span>
          <StatusDot pulse={live} tone={task.status === 'succeeded' ? 'success'
            : ['failed', 'interrupted'].includes(task.status) ? 'danger' : live ? 'primary' : 'neutral'}>
            {statusLabels[task.status]}
          </StatusDot>
          {live && <Button variant="ghost" size="xs" className="ml-auto" onClick={() => {
            if (session) void window.CliAPI?.invoke(session, commandRequest('agent.cancel', { taskId: task.id })).catch((reason) => setError(String(reason)));
          }}>取消任务</Button>}
        </div>
        <p className="select-all font-mono text-[11px] text-muted-foreground">{task.id}</p>
        {(task.summary || task.error) && <p className={`whitespace-pre-wrap break-words ${task.error ? 'text-danger' : ''}`}>
          {task.error || task.summary}
        </p>}
      </div>;
    })}</div>}
  </SettingsCard>;
}
