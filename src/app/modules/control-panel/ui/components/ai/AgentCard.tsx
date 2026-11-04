import { useEffect, useState } from 'react';
import type { AgentSettings, AgentTask } from '../../../../../../../shared/cli/contracts';
import { commandRequest } from '@app/shared/electron/commandSession';

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
  return <section className="shrink-0 rounded-box border border-base-300 bg-base-100 p-3 space-y-2">
    <h2 className="font-medium text-sm">Agent · Codex</h2>
    {settings && <>
      <p className="text-xs text-base-content/60">使用本机 Codex 登录。添加项目后，可直接在聊天中提出开发需求。</p>
      {workspaces.map((workspace, index) => <div className="flex gap-2" key={index}>
        <input aria-label={`项目标识 ${index + 1}`} placeholder="项目标识" className="input input-sm w-32" value={workspace.id}
          onChange={(event) => setWorkspaces((items) => items.map((item, i) => i === index ? { ...item, id: event.target.value } : item))} />
        <input aria-label={`项目目录 ${index + 1}`} placeholder="本机项目绝对路径" className="input input-sm flex-1" value={workspace.path}
          onChange={(event) => setWorkspaces((items) => items.map((item, i) => i === index ? { ...item, path: event.target.value } : item))} />
        <button className="btn btn-sm btn-ghost" onClick={() => setWorkspaces((items) => items.filter((_, i) => i !== index))}>移除</button>
      </div>)}
      <button className="btn btn-xs" onClick={() => setWorkspaces((items) => [...items, { id: '', path: '' }])}>添加项目</button>
      <label className="block text-xs">允许操作本机的远程插件来源（每行一个 plugin:插件ID；留空仅本地）
        <textarea className="textarea w-full mt-1" value={sources} onChange={(event) => setSources(event.target.value)} />
      </label>
      <button className="btn btn-primary btn-sm" disabled={!session || saving} onClick={() => void save()}>保存 Agent 设置</button>
      {notice && <p className="text-xs text-success">{notice}</p>}
    </>}
    {error && <p role="alert" className="text-xs text-error">{error}</p>}
    <div className="max-h-48 overflow-auto space-y-2">{tasks.map((task) => <div key={task.id} className="text-xs border-t border-base-300 pt-2">
      <div className="flex items-center gap-2"><span>{task.workspaceId} · {statusLabels[task.status]}</span>
        {['queued', 'running'].includes(task.status) && <button className="btn btn-xs ml-auto" onClick={() => {
          if (session) void window.CliAPI?.invoke(session, commandRequest('agent.cancel', { taskId: task.id })).catch((reason) => setError(String(reason)));
        }}>取消任务</button>}
      </div>
      <p className="select-all text-base-content/50">{task.id}</p>
      {(task.summary || task.error) && <p className="whitespace-pre-wrap break-words">{task.error || task.summary}</p>}
    </div>)}</div>
  </section>;
}
