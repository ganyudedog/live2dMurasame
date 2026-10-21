import { useState } from 'react';
import { Field, SettingsCard } from '../components/common/SettingsSection';
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

  return <>
    <SettingsCard title="语音识别" description="通过适配器选择本地模型或预留的远程识别服务。">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="语音输入档次">
          <select className="select select-sm w-full" value={draft.profile}
            onChange={(event) => update({ profile: event.target.value as AsrConfig['profile'] })}>
            <option value="conversation">实时对话</option>
            <option value="agent" disabled>Agent 高精度（待配置复核模型）</option>
          </select>
        </Field>
        <Field label="运行方式">
          <select className="select select-sm w-full" value={draft.mode}
            onChange={(event) => update({ mode: event.target.value as AsrConfig['mode'] })}>
            <option value="local">本地</option>
            <option value="remote">远程（扩展点）</option>
          </select>
        </Field>
        <Field label="识别引擎">
          <input className="input input-sm w-full" value={draft.engine}
            onChange={(event) => update({ engine: event.target.value })} />
        </Field>
      </div>

      <Field label={draft.mode === 'local' ? '模型目录' : '远程服务地址'}
        hint={draft.mode === 'local'
          ? '目录内需包含 encoder.onnx、decoder.onnx、joiner.onnx、tokens.txt'
          : '预留字段，当前未实现远程适配器'}>
        <input className="input input-sm w-full"
          placeholder={draft.mode === 'local' ? 'models/sense-voice' : 'https://example.com/asr'}
          value={draft.mode === 'local' ? draft.modelDir : draft.endpoint}
          onChange={(event) => update(draft.mode === 'local'
            ? { modelDir: event.target.value }
            : { endpoint: event.target.value })} />
      </Field>
    </SettingsCard>

    <SettingsCard title="语音检测" description="Silero VAD 决定什么时候算「开始说话」和「说完了」。">
      <Field label="Silero VAD 模型路径" hint="留空则使用程序内置的默认模型">
        <input className="input input-sm w-full" placeholder="silero_vad.onnx" value={draft.vadModelPath}
          onChange={(event) => update({ vadModelPath: event.target.value })} />
      </Field>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="人声确认时长（秒）" hint="短于此长度的声音会被忽略">
          <input type="number" min="0.15" max="0.3" step="0.01" className="input input-sm w-full tabular-nums"
            value={draft.vadMinSpeechDuration}
            onChange={(event) => update({ vadMinSpeechDuration: Number(event.target.value) })} />
        </Field>
        <Field label="人声概率阈值" hint="越高越不容易被环境噪音触发">
          <input type="number" min="0.05" max="0.95" step="0.05" className="input input-sm w-full tabular-nums"
            value={draft.vadThreshold}
            onChange={(event) => update({ vadThreshold: Number(event.target.value) })} />
        </Field>
        <Field label="采样率">
          <select className="select select-sm w-full" value={draft.sampleRate}
            onChange={() => update({ sampleRate: 16000 })}>
            {draft.sampleRate !== 16000 && <option value={draft.sampleRate}>{draft.sampleRate}</option>}
            <option value={16000}>16000 Hz</option>
          </select>
        </Field>
      </div>
    </SettingsCard>

    <SettingsCard title="断句与性能" description="静音多久算一句话结束，以及识别占用的线程数。">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="有声句尾静音（秒）" hint="已经识别出文字后，停顿多久就提交">
          <input type="number" min="0.2" max="3" step="0.1" className="input input-sm w-full tabular-nums"
            value={draft.rule2MinTrailingSilence}
            onChange={(event) => update({ rule2MinTrailingSilence: Number(event.target.value) })} />
        </Field>
        <Field label="无文本端点静音（秒）" hint="一直没识别出文字时，停顿多久结束录音">
          <input type="number" min="0.5" max="5" step="0.1" className="input input-sm w-full tabular-nums"
            value={draft.rule1MinTrailingSilence}
            onChange={(event) => update({ rule1MinTrailingSilence: Number(event.target.value) })} />
        </Field>
        <Field label="线程数" hint="越大识别越快，但更占 CPU">
          <input type="number" className="input input-sm w-full tabular-nums" value={draft.numThreads}
            onChange={(event) => update({ numThreads: Number(event.target.value) })} />
        </Field>
      </div>
    </SettingsCard>
  </>;
}
