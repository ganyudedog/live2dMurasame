import { useState } from 'react';
import type { AsrConfig } from '../../domain/types';

export default function AsrSettingsPage({
  config,
  onChange,
}: {
  config: AsrConfig;
  onChange: (next: AsrConfig) => Promise<void>;
}) {
  const [draft, setDraft] = useState(config);
  const [previousConfig, setPreviousConfig] = useState(config);
  if (config !== previousConfig) {
    setPreviousConfig(config);
    setDraft(config);
  }
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
          <span className="label-text text-xs">语音输入档次</span>
          <select className="select select-sm select-bordered" value={draft.profile} onChange={(e) => update({ profile: e.target.value as AsrConfig['profile'] })}>
            <option value="conversation">实时对话</option>
            <option value="agent" disabled>Agent 高精度（待配置复核模型）</option>
          </select>
        </label>
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
          <select className="select select-sm select-bordered" value={draft.sampleRate} onChange={() => update({ sampleRate: 16000 })}>
            {draft.sampleRate !== 16000 && <option value={draft.sampleRate}>{draft.sampleRate}</option>}
            <option value={16000}>16000 Hz</option>
          </select>
        </label>
        <label className="form-control md:col-span-2">
          <span className="label-text text-xs">Silero VAD 模型路径</span>
          <input className="input input-sm input-bordered" placeholder="silero_vad.onnx" value={draft.vadModelPath} onChange={(e) => update({ vadModelPath: e.target.value })} />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">人声确认时长（秒）</span>
          <input type="number" min="0.15" max="0.3" step="0.01" className="input input-sm input-bordered" value={draft.vadMinSpeechDuration} onChange={(e) => update({ vadMinSpeechDuration: Number(e.target.value) })} />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">人声概率阈值</span>
          <input type="number" min="0.05" max="0.95" step="0.05" className="input input-sm input-bordered" value={draft.vadThreshold} onChange={(e) => update({ vadThreshold: Number(e.target.value) })} />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">有声句尾静音（秒）</span>
          <input type="number" min="0.2" max="3" step="0.1" className="input input-sm input-bordered" value={draft.rule2MinTrailingSilence} onChange={(e) => update({ rule2MinTrailingSilence: Number(e.target.value) })} />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">无文本端点静音（秒）</span>
          <input type="number" min="0.5" max="5" step="0.1" className="input input-sm input-bordered" value={draft.rule1MinTrailingSilence} onChange={(e) => update({ rule1MinTrailingSilence: Number(e.target.value) })} />
        </label>
        <label className="form-control">
          <span className="label-text text-xs">线程数</span>
          <input type="number" className="input input-sm input-bordered" value={draft.numThreads} onChange={(e) => update({ numThreads: Number(e.target.value) })} />
        </label>
      </div>
    </section>
  );
}
