import { useMemo } from 'react';

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
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">模型选择</h1>
          <p className="text-xs text-base-content/60">模型路径来自 liv2denv.json（绝对路径）</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-sm btn-primary" onClick={onAddModel}>
            添加模型
          </button>
        </div>
      </div>

      {selected && (
        <div className="rounded-box border border-base-300 bg-base-100 p-4">
          <div className="text-sm font-medium">当前选择</div>
          <div className="mt-1 text-sm">名称：{selected.name}</div>
          <div className="text-xs text-base-content/60 break-all">路径：{selected.path}</div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 overflow-y-auto p-2">
        {modelPaths.map((modelPath) => {
          const name = normalizeNameFromPath(modelPath);
          const isActive = modelPath === selectedPath;
          const canDelete = modelPaths.length > 1;

          return (
            <div
              key={modelPath}
              className={
                isActive
                  ? 'relative w-full min-w-0 rounded-box border border-base-300 bg-base-100 p-4 ring-2 ring-primary'
                  : 'relative w-full min-w-0 rounded-box border border-base-300 bg-base-100 p-4'
              }
            >

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{name}</div>
                  <div className="text-xs text-base-content/60 break-all mt-1">{modelPath}</div>
                </div>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    onClick={() => onRemoveModel(modelPath)}
                    disabled={!canDelete}
                    title={canDelete ? '删除模型' : '至少保留一个模型'}
                  >
                    X
                  </button>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  className={isActive ? 'btn btn-sm btn-primary flex-1' : 'btn btn-sm btn-outline flex-1'}
                  onClick={() => onSelectPath(modelPath)}
                >
                  选择
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
