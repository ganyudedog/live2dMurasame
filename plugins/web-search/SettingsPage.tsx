import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import type { UiRenderContext } from '../../src/app/modules/plugin';
import { Field, Section } from '../ui-kit/layout';
import { INPUT, PRIMARY_BUTTON } from '../ui-kit/styles';

export function SearchSettings({ storage }: UiRenderContext) {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    storage.get<string>('token').then(value => {
      if (active) { setToken(value ?? ''); setBusy(false); }
    }).catch(() => { if (active) setMessage('读取 token 失败'); });
    return () => { active = false; };
  }, [storage]);
  async function save() {
    setBusy(true);
    try { await storage.set('token', token.trim()); setMessage('已保存'); }
    catch { setMessage('保存失败，请重试'); }
    finally { setBusy(false); }
  }
  return <Section icon={<Search />} title="DeepSeek 网页搜索">
    <Field label="API token" htmlFor="web-search-token">
      <input id="web-search-token" className={INPUT} type="password" autoComplete="off" value={token}
        disabled={busy} onChange={event => { setToken(event.target.value); setMessage(''); }} />
    </Field>
    <button className={PRIMARY_BUTTON} disabled={busy} onClick={save}>保存</button>
    <span role="status">{message}</span>
  </Section>;
}

