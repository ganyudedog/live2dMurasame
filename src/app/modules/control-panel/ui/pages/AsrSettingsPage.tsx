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

  const remote = draft.mode === 'remote';
  const optionalNumber = (value: string): number | null => value === '' || Number.isNaN(Number(value)) ? null : Number(value);

  return <>
    <SettingsCard title="语音识别" description={remote
      ? '连接已经配好人声检测和识别的服务。'
      : '使用本机模型目录里的识别模型和 VAD 文件。'}>
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
            <option value="remote">远程</option>
          </select>
        </Field>
        {remote ? null : <Field label="识别引擎">
          <input className="input input-sm w-full" value={draft.engine}
            onChange={(event) => update({ engine: event.target.value })} />
        </Field>}
      </div>

      <Field label={remote ? '远程服务地址' : '模型目录'}
        hint={remote
          ? '服务内已包含人声检测和识别。地址可以写 ws:// 或 http://。'
          : '目录内需包含 encoder.onnx、decoder.onnx、joiner.onnx、tokens.txt'}>
        <input className="input input-sm w-full"
          placeholder={remote ? 'ws://127.0.0.1:6006' : 'models/sense-voice'}
          value={remote ? draft.endpoint : draft.modelDir}
          onChange={(event) => update(remote
            ? { endpoint: event.target.value }
            : { modelDir: event.target.value })} />
      </Field>
    </SettingsCard>

    {remote ? <SettingsCard title="语音检测" description="留空则使用服务已经配好的人声检测。填写后会在连接时发给服务。">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Field label="人声确认时长（秒）" hint="留空表示不覆盖服务">
          <input type="number" min="0.15" max="0.3" step="0.01" className="input input-sm w-full tabular-nums"
            value={draft.vadMinSpeechDuration ?? ''}
            onChange={(event) => update({ vadMinSpeechDuration: optionalNumber(event.target.value) })} />
        </Field>
        <Field label="人声概率阈值" hint="留空表示不覆盖服务">
          <input type="number" min="0.05" max="0.95" step="0.05" className="input input-sm w-full tabular-nums"
            value={draft.vadThreshold ?? ''}
            onChange={(event) => update({ vadThreshold: optionalNumber(event.target.value) })} />
        </Field>
      </div>
    </SettingsCard> : null}

    {remote ? null : <SettingsCard title="语音检测" description="Silero VAD 决定什么时候算「开始说话」和「说完了」。">
      <Field label="Silero VAD 模型路径" hint="留空则使用模型目录中的 silero_vad.onnx">
        <input className="input input-sm w-full" placeholder="silero_vad.onnx" value={draft.vadModelPath}
          onChange={(event) => update({ vadModelPath: event.target.value })} />
      </Field>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="人声确认时长（秒）" hint="短于此长度的声音会被忽略">
          <input type="number" min="0.15" max="0.3" step="0.01" className="input input-sm w-full tabular-nums"
            value={draft.vadMinSpeechDuration ?? 0.2}
            onChange={(event) => update({ vadMinSpeechDuration: Number(event.target.value) })} />
        </Field>
        <Field label="人声概率阈值" hint="越高越不容易被环境噪音触发">
          <input type="number" min="0.05" max="0.95" step="0.05" className="input input-sm w-full tabular-nums"
            value={draft.vadThreshold ?? 0.5}
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
    </SettingsCard>}

    {remote ? null : <SettingsCard title="断句与性能" description="静音多久算一句话结束，以及识别占用的线程数。">
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
    </SettingsCard>}
  </>;
}
