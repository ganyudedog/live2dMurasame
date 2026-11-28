import { useState } from 'react';
import { AudioWaveform, Mic } from 'lucide-react';
import { Field, SettingsCard } from '../components/common/SettingsSection';
import { Input } from '../components/common/FormControls';
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
  const optionalNumber = (value: string): number | null => value === '' || Number.isNaN(Number(value)) ? null : Number(value);

  return <>
    <SettingsCard title="语音识别" icon={<Mic />} description="连接已经配好人声检测和识别的服务。">
      <Field label="远程服务地址" hint="服务内已包含人声检测和识别。地址可以写 ws:// 或 http://。">
        <Input className="font-mono" placeholder="ws://127.0.0.1:6006"
          value={draft.endpoint}
          onChange={(event) => update({ endpoint: event.target.value })} />
      </Field>
    </SettingsCard>

    <SettingsCard title="语音检测" icon={<AudioWaveform />} description="留空则使用服务已经配好的人声检测。填写后会在连接时发给服务。">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="人声确认时长（秒）" hint="留空表示不覆盖服务">
          <Input type="number" min="0.15" max="0.3" step="0.01"
            value={draft.vadMinSpeechDuration ?? ''}
            onChange={(event) => update({ vadMinSpeechDuration: optionalNumber(event.target.value) })} />
        </Field>
        <Field label="人声概率阈值" hint="留空表示不覆盖服务">
          <Input type="number" min="0.05" max="0.95" step="0.05"
            value={draft.vadThreshold ?? ''}
            onChange={(event) => update({ vadThreshold: optionalNumber(event.target.value) })} />
        </Field>
      </div>
    </SettingsCard>
  </>;
}
