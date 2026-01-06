import { useMemo, useRef, useState } from 'react';
import type { ModelEntry } from '../types';

const createId = () => {
  const cryptoObj = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `model_${Date.now()}_${Math.random().toString(16).slice(2)}`;
};

export default function ModelSelectPage({
  models,
  selectedId,
  onSelect,
  onRename,
  onAdd,
  onDelete,
}: {
  models: ModelEntry[];
  selectedId: string;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onAdd: (entry: ModelEntry) => void;
  onDelete: (id: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selected = useMemo(() => models.find((m) => m.id === selectedId) ?? null, [models, selectedId]);

  const beginEdit = (model: ModelEntry) => {
    setEditingId(model.id);
    setDraftName(model.name);
  };

  const commitEdit = () => {
    if (!editingId) return;
    onRename(editingId, draftName.trim() || '未命名');
    setEditingId(null);
    setDraftName('');
  };

  const handleAddClick = () => {
    fileInputRef.current?.click();
  };

  const handleFilePicked = (file: File | null) => {
    if (!file) return;
    const suggestedName = (file.name || '未命名').replace(/\.[^/.]+$/, '');
    const id = createId();
    const entry: ModelEntry = {
      id,
      name: suggestedName.trim() || '未命名',
      // 仅 UI / 本地状态：浏览器环境无法稳定获取完整本机路径，这里展示文件名作为占位。
      path: file.name || 'unknown',
    };

    onAdd(entry);
    onSelect(id);

    // 新增后直接进入“改名”态，满足“上传后可自主命名”。
    setEditingId(id);
    setDraftName(entry.name);
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">模型选择</h1>
          <p className="text-xs text-base-content/60">两列卡片排列，名称可自定义（仅本地状态）</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".model3.json"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0] ?? null;
              handleFilePicked(file);
              // 允许重复选择同一个文件
              e.currentTarget.value = '';
            }}
          />
          <button type="button" className="btn btn-sm btn-primary" onClick={handleAddClick}>
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
        {models.map((model) => {
          const isActive = model.id === selectedId;
          const isEditing = editingId === model.id;
          const canDelete = models.length > 1;

          return (
            <div
              key={model.id}
              className={
                isActive
                  ? 'relative w-full min-w-0 rounded-box border border-base-300 bg-base-100 p-4 ring-2 ring-primary'
                  : 'relative w-full min-w-0 rounded-box border border-base-300 bg-base-100 p-4'
              }
            >

              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {!isEditing ? (
                    <div className="text-sm font-medium truncate">{model.name}</div>
                  ) : (
                    <input
                      className="input input-sm input-bordered w-full"
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitEdit();
                        if (e.key === 'Escape') {
                          setEditingId(null);
                          setDraftName('');
                        }
                      }}
                      autoFocus
                    />
                  )}
                  <div className="text-xs text-base-content/60 break-all mt-1">{model.path}</div>
                </div>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost"
                    onClick={() => onDelete(model.id)}
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
                  onClick={() => onSelect(model.id)}
                >
                  选择
                </button>

                {!isEditing ? (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => beginEdit(model)}>
                    改名
                  </button>
                ) : (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={commitEdit}>
                    保存
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
