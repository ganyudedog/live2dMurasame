import { useState } from 'react';
import { SettingsCard } from '../common/SettingsSection';
import { describeEfforts } from './describeEfforts';
import type { RemoteModel } from '@app/modules/ai/modules/llm/infrastructure/modelCatalog';

/** 一行可选模型：已启用的来自后端清单，未启用的来自接口返回的模型列表。 */
interface ModelRow {
  id: string;
  registered: boolean;
  model?: PetLlmModel;
  remote?: RemoteModel;
}

const SEARCH_THRESHOLD = 8;

/**
 * 模型清单只有一个概念：这个接口提供的全部模型，左侧勾选即启用。
 * 没有“添加模型”表单——接口的 /models 就是全集，取消勾选即移除，重新获取即可再勾回来。
 */
export function ModelRegistryCard({
  models,
  available,
  canFetch,
  fetching,
  fetchError,
  busyLabel,
  notice,
  error,
  onFetch,
  onToggle,
  onProbe,
}: {
  models: readonly PetLlmModel[];
  available: readonly RemoteModel[];
  canFetch: boolean;
  fetching: boolean;
  fetchError?: string | null;
  busyLabel?: string | null;
  notice?: string | null;
  error?: string | null;
  onFetch: () => void;
  onToggle: (id: string, enabled: boolean) => void;
  onProbe: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const disabled = fetching || Boolean(busyLabel);

  const registered = new Set(models.map((model) => model.id));
  const rows: ModelRow[] = [
    ...models.map((model) => ({ id: model.id, registered: true, model })),
    ...available
      .filter((model) => !registered.has(model.id))
      .map((model) => ({ id: model.id, registered: false, remote: model })),
  ];
  const keyword = query.trim().toLowerCase();
  const visible = keyword ? rows.filter((row) => row.id.toLowerCase().includes(keyword)) : rows;

  return <SettingsCard
    title="模型列表"
    description="勾选代表启用：勾上的模型写进后端清单，取消勾选即移除。对话与动作表分别用哪个模型、什么深度，在各自的输入框里选。"
    actions={<div className="flex items-center gap-2">
      {rows.length > 0 && (
        <span className="hidden text-[11px] text-base-content/45 sm:inline">
          已启用 {models.length} / {rows.length}
        </span>
      )}
      <button type="button" className="btn btn-outline btn-xs" disabled={!canFetch || disabled}
        title={canFetch ? '从接口重新拉取模型清单' : '先在上面填写 Base URL'}
        onClick={onFetch}>
        {fetching ? '获取中…' : '获取可用模型'}
      </button>
    </div>}
  >
    {!canFetch && (
      <p className="text-xs text-base-content/50">先填写上面的 Base URL（接口地址决定模型清单从哪里拉），再点「获取可用模型」。</p>
    )}
    {canFetch && !available.length && !fetching && !fetchError && (
      <p className="text-xs text-base-content/50">
        {models.length
          ? '点「获取可用模型」可以看到接口返回的全部模型，再勾选需要的。'
          : '还没有模型。点「获取可用模型」拉取接口的模型清单，然后勾选要用的。'}
      </p>
    )}

    {rows.length > SEARCH_THRESHOLD && (
      <input className="input input-sm w-full" value={query} placeholder="搜索模型名"
        onChange={(event) => setQuery(event.target.value)} />
    )}

    <div className="flex flex-col gap-1">
      {visible.map((row) => (
        <div key={row.id}
          className="flex items-center gap-2 rounded-field px-2 py-1.5 transition-colors hover:bg-base-content/5">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <input type="checkbox" className="checkbox checkbox-xs shrink-0" checked={row.registered}
              disabled={disabled}
              onChange={(event) => onToggle(row.id, event.target.checked)} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs">{row.id}</p>
              <p className="truncate text-[11px] text-base-content/45">
                {row.model ? `思考深度：${describeEfforts(row.model)}` : (row.remote?.efforts.length
                  ? `接口声明：${row.remote.efforts.join(' / ')}`
                  : '未启用')}
              </p>
            </div>
          </label>
          {row.registered && (
            <button type="button" className="btn btn-ghost btn-xs shrink-0" disabled={disabled}
              title="重新检测该模型支持的思考深度" onClick={() => onProbe(row.id)}>重新检测</button>
          )}
        </div>
      ))}
      {!visible.length && rows.length > 0 && (
        <p className="px-2 py-3 text-xs text-base-content/50">没有匹配的模型</p>
      )}
    </div>

    {fetching && <p role="status" className="text-[11px] text-base-content/55">正在读取模型列表…</p>}
    {fetchError && <p role="alert" className="text-[11px] text-error">{fetchError}</p>}
    {busyLabel && <p role="status" className="text-[11px] text-base-content/55">{busyLabel}</p>}
    {notice && <p role="status" className="text-[11px] text-base-content/55">{notice}</p>}
    {error && <p role="alert" className="text-[11px] text-error">{error}</p>}
  </SettingsCard>;
}
