import { useEffect, useState } from 'react';
import type { AsrConfig } from '../../domain/types';

export default function AsrSettingsPage({
  config,
  onChange,
}: {
  config: AsrConfig;
  onChange: (next: AsrConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState(config);
  useEffect(() => setDraft(config), [config]);
  const update = (patch: Partial<AsrConfig>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    void onChange(next);
  };

  return (
    <section className="rounded-box border border-base-300 bg-base-100 p-4 space-y-4">
      <div>
        <h2 className="text-sm font-medium">语音识别</h2>
        <p className="text-xs text-base-content/60">通过适配器选择本地模型或预留的远程识别服务。</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="form-control">
          <span className="label-text text-xs">运行方式</span>
          <select className="select select-sm select-bordered" value={draft.mode} onChange={(e) => update({ mode: e.target.value as AsrConfig['mode'] })}>
            <option value="local">本地</option>
            <option value="remote">远程（扩展点）</option>
          </select>
        </label>
        <label className="form-control">
          <span className="label-text text-xs">识别引擎</span>
          <input className="input input-sm input-bordered" value={draft.engine} onChange={(e) => update({ engine: e.target.value })} />
        </label>
        {draft.mode === 'local' ? (
          <label className="form-control md:col-span-2">
            <span className="label-text text-xs">模型目录</span>
            <input className="input input-sm input-bordered" placeholder="包含 encoder.onnx、decoder.onnx、joiner.onnx、tokens.txt" value={draft.modelDir} onChange={(e) => update({ modelDir: e.target.value })} />
          </label>
        ) : (
          <label className="form-control md:col-span-2">
            <span className="label-text text-xs">远程服务地址</span>
            <input className="input input-sm input-bordered" placeholder="预留，当前未实现远程适配器" value={draft.endpoint} onChange={(e) => update({ endpoint: e.target.value })} />
          </label>
        )}
        <label className="form-control">
          <span className="label-text text-xs">采样率</span>
          <input type="number" className="input input-sm input-bordered" value={draft.sampleRate} onChange={(e) => update({ sampleRate: Number(e.target.value) })} />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">线程数</span>
          <input type="number" className="input input-sm input-bordered" value={draft.numThreads} onChange={(e) => update({ numThreads: Number(e.target.value) })} />
        </label>
      </div>
    </section>
  );
}
