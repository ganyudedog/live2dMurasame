import { useState } from 'react';
import { Cpu, RefreshCw, Search } from 'lucide-react';
import { SettingsCard } from '../common/SettingsSection';
import { Button } from '../common/Button';
import { Badge } from '../common/Badge';
import { Checkbox } from '../common/Checkbox';
import { Input } from '../common/FormControls';
import { Notice } from '../common/Feedback';
import { cn } from '../common/cn';
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
 * 重新获取后列表只跟接口返回的一致：接口不再返回的模型会被判定丢失并移除。
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
  const byId = new Map(models.map((model) => [model.id, model]));
  // 顺序固定跟接口返回的一致：勾选/取消只改状态，绝不因为启用而换位置。
  const rows: ModelRow[] = available.length
    ? available.map((remote) => ({
      id: remote.id,
      registered: registered.has(remote.id),
      model: byId.get(remote.id),
      remote,
    }))
    : models.map((model) => ({ id: model.id, registered: true, model }));
  const keyword = query.trim().toLowerCase();
  const visible = keyword ? rows.filter((row) => row.id.toLowerCase().includes(keyword)) : rows;

  return <SettingsCard
    title="模型列表"
    icon={<Cpu />}
    description="勾选代表启用：勾上的模型写进后端清单，取消勾选即移除。对话与动作表分别用哪个模型、什么深度，在各自的输入框里选。"
    actions={<>
      {rows.length > 0 && (
        <Badge tone="outline" className="hidden sm:inline-flex">
          已启用 {models.length} / {rows.length}
        </Badge>
      )}
      <Button disabled={!canFetch || disabled}
        title={canFetch ? '从接口重新拉取模型清单' : '先在上面填写 Base URL'}
        onClick={onFetch}>
        <RefreshCw className={fetching ? 'animate-spin' : undefined} />
        {fetching ? '获取中…' : '获取可用模型'}
      </Button>
    </>}
  >
    {!canFetch && (
      <Notice>先填写上面的 Base URL（接口地址决定模型清单从哪里拉），再点「获取可用模型」。</Notice>
    )}
    {canFetch && !available.length && !fetching && !fetchError && (
      <Notice>
        {models.length
          ? '点「获取可用模型」可以看到接口返回的全部模型，再勾选需要的。'
          : '还没有模型。点「获取可用模型」拉取接口的模型清单，然后勾选要用的。'}
      </Notice>
    )}

    {rows.length > SEARCH_THRESHOLD && (
      <label className="relative block">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-8" value={query} placeholder="搜索模型名" aria-label="搜索模型名"
          onChange={(event) => setQuery(event.target.value)} />
      </label>
    )}

    {visible.length > 0 && <div className="ui-scroll max-h-96 divide-y divide-border overflow-y-auto rounded-lg border border-border">
      {visible.map((row) => (
        <div key={row.id}
          className={cn('flex items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/60',
            row.registered && 'bg-primary/4')}>
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
            <Checkbox checked={row.registered} disabled={disabled} aria-label={row.id}
              onCheckedChange={(checked) => onToggle(row.id, checked)} />
            <div className="min-w-0 flex-1">
              <p className={cn('truncate font-mono text-xs', row.registered ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                {row.id}
              </p>
              <p className="truncate text-[11px] text-muted-foreground/80">
                {row.model ? `思考深度：${describeEfforts(row.model)}` : (row.remote?.efforts.length
                  ? `接口声明：${row.remote.efforts.join(' / ')}`
                  : '未启用')}
              </p>
            </div>
          </label>
          {row.registered && (
            <Button variant="ghost" size="xs" disabled={disabled}
              title="重新检测该模型支持的思考深度" onClick={() => onProbe(row.id)}><RefreshCw />重新检测</Button>
          )}
        </div>
      ))}
    </div>}
    {!visible.length && rows.length > 0 && (
      <p className="px-2 py-3 text-center text-xs text-muted-foreground">没有匹配的模型</p>
    )}

    {fetching && <Notice tone="busy">正在读取模型列表…</Notice>}
    {fetchError && <Notice tone="danger">{fetchError}</Notice>}
    {busyLabel && <Notice tone="busy">{busyLabel}</Notice>}
    {notice && <Notice tone="success">{notice}</Notice>}
    {error && <Notice tone="danger">{error}</Notice>}
  </SettingsCard>;
}
