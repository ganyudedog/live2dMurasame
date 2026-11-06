import { useMemo } from 'react';
import { Box, Boxes, Check, Plus, Trash } from 'lucide-react';
import { Page } from '../components/common/Page';
import { Button } from '../components/common/Button';
import { Badge } from '../components/common/Badge';
import { EmptyState } from '../components/common/Feedback';
import { cn } from '../components/common/cn';

const normalizeNameFromPath = (input: string) => {
  const safe = String(input || '').replace(/\\/g, '/');
  const parts = safe.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '未命名';
};

export default function ModelSelectPage({
  modelPaths,
  selectedPath,
  onSelectPath,
  onAddModel,
  onRemoveModel,
}: {
  modelPaths: string[];
  selectedPath: string | null;
  onSelectPath: (path: string) => void;
  onAddModel: () => void;
  onRemoveModel: (path: string) => void;
}) {
  const selected = useMemo(() => {
    if (!selectedPath) return null;
    return {
      name: normalizeNameFromPath(selectedPath),
      path: selectedPath,
    };
  }, [selectedPath]);

  return (
    <Page title="模型管理" description="模型路径来自 live2denv.json；选中的模型会立即在桌面上加载。"
      actions={<Button variant="primary" size="md" onClick={onAddModel}><Plus />添加模型</Button>}>
      {selected && (
        <section className="flex items-center gap-4 rounded-xl bg-primary/6 p-4 shadow-card">
          <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Box className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-primary">当前选择</p>
            <p className="truncate text-sm font-semibold">{selected.name}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground" title={selected.path}>{selected.path}</p>
          </div>
        </section>
      )}

      {modelPaths.length === 0
        ? <EmptyState icon={<Boxes />} title="还没有模型">
          点击右上角「添加模型」，选择本机上的 Live2D 模型。
        </EmptyState>
        : <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {modelPaths.map((modelPath) => {
            const name = normalizeNameFromPath(modelPath);
            const isActive = modelPath === selectedPath;
            const canDelete = modelPaths.length > 1;

            return (
              <div key={modelPath}
                className={cn('group flex min-w-0 flex-col gap-3 rounded-xl bg-card p-4 shadow-card transition-shadow',
                  isActive ? 'ring-2 ring-primary/70' : 'hover:shadow-pop')}>
                <div className="flex items-start gap-3">
                  <span aria-hidden="true" className={cn('grid size-9 shrink-0 place-items-center rounded-lg',
                    isActive ? 'bg-primary/12 text-primary' : 'bg-muted text-muted-foreground')}>
                    <Box className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold">{name}</span>
                      {isActive && <Badge tone="primary">使用中</Badge>}
                    </div>
                    <p className="mt-0.5 break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{modelPath}</p>
                  </div>
                  <Button variant="ghost" size="icon" aria-label={`删除 ${name}`}
                    className="opacity-60 group-hover:opacity-100 hover:text-danger"
                    onClick={() => onRemoveModel(modelPath)}
                    disabled={!canDelete}
                    title={canDelete ? '删除模型' : '至少保留一个模型'}>
                    <Trash />
                  </Button>
                </div>
                <Button variant={isActive ? 'soft' : 'outline'} className="w-full" disabled={isActive}
                  onClick={() => onSelectPath(modelPath)}>
                  {isActive ? <><Check />已选择</> : '选择'}
                </Button>
              </div>
            );
          })}
        </div>}
    </Page>
  );
}
