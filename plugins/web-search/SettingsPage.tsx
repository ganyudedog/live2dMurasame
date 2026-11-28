import { useEffect, useState } from 'react';
import { Eye, EyeOff, Info, Search } from 'lucide-react';
import type { UiRenderContext } from '../../src/app/modules/plugin';
import { Field, LoadingCard, SaveFeedback, Section } from '../ui-kit/layout';
import { GHOST_BUTTON_XS, HINT, INPUT, PRIMARY_BUTTON } from '../ui-kit/styles';

const NOTES: ReadonlyArray<{ title: string; detail: string }> = [
  { title: '允许调用 CLI', detail: '在「AI 设置 → CLI」里允许「DeepSeek 搜索」，模型才能用 web.search。' },
  { title: '每次最多 5 条', detail: '返回标题、链接、摘要和发布时间，15 秒内没有结果就按失败处理。' },
  { title: '不写进对话记录', detail: '搜索结果只用于当次回答，不会存进长期记忆的对话片段。' },
];

const tail = (token: string) => (token.length > 4 ? `尾号 ${token.slice(-4)}` : '已保存');

function SearchSettingsView({ storage }: UiRenderContext) {
  const [saved, setSaved] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    storage.get<string>('token').then((value) => {
      if (active) { setSaved(value ?? ''); setDraft(value ?? ''); }
    }).catch(() => { if (active) { setSaved(''); setError('读取 token 失败'); } });
    return () => { active = false; };
  }, [storage]);

  useEffect(() => {
    if (!justSaved) return undefined;
    const timer = setTimeout(() => setJustSaved(false), 1600);
    return () => clearTimeout(timer);
  }, [justSaved]);

  if (saved === null) return <LoadingCard>正在读取搜索配置…</LoadingCard>;
  const next = draft.trim();
  const dirty = next !== saved;

  const save = async (value: string) => {
    setSaving(true); setError('');
    try {
      await storage.set('token', value);
      setSaved(value);
      setDraft(value);
      setJustSaved(true);
    } catch {
      setError('请重试');
    } finally { setSaving(false); }
  };

  return <div className="space-y-4">
    <Section icon={<Search />} title="DeepSeek 网页搜索"
      description="模型遇到对话和记忆里没有的实时信息时，会调用 web.search 查网页。"
      actions={<span className={`inline-flex items-center gap-1.5 text-[11px] ${saved ? 'text-success' : 'text-muted-foreground'}`}>
        <span aria-hidden="true" className={`size-1.5 rounded-full ${saved ? 'bg-success' : 'bg-muted-foreground/50'}`} />
        {saved ? `已配置 · ${tail(saved)}` : '未配置'}
      </span>}>
      <Field label="API token" htmlFor="web-search-token"
        hint="token 只保存在本机的插件存储里，搜索请求由主进程发出。">
        <div className="relative">
          <input id="web-search-token" className={`${INPUT} w-full pr-9 font-mono`} type={reveal ? 'text' : 'password'}
            autoComplete="off" spellCheck={false} placeholder="sk-…" value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && dirty && !saving) { event.preventDefault(); void save(next); }
            }} />
          <button type="button" aria-label={reveal ? '隐藏 API token' : '显示 API token'} aria-pressed={reveal}
            title={reveal ? '隐藏' : '显示'} onClick={() => setReveal((value) => !value)}
            className="absolute top-1/2 right-1 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-md
              text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2
              focus-visible:ring-primary/35 [&_svg]:size-3.5">
            {reveal ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
          </button>
        </div>
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {dirty && <span className={`mr-auto ${HINT}`}>{next ? '有未保存的修改，回车也可以保存' : '保存后会清除 token'}</span>}
        {dirty && <button type="button" className={GHOST_BUTTON_XS} onClick={() => setDraft(saved)}>还原</button>}
        {!dirty && saved && <button type="button" className={`${GHOST_BUTTON_XS} hover:text-danger`} disabled={saving}
          onClick={() => { void save(''); }}>清除 token</button>}
        <button type="button" className={PRIMARY_BUTTON} disabled={!dirty || saving} onClick={() => { void save(next); }}>
          {saving ? '正在保存…' : '保存'}
        </button>
      </div>
    </Section>

    <Section icon={<Info />} title="使用前提" bodyClassName="p-0">
      <ul className="divide-y divide-border">
        {NOTES.map((note) => <li key={note.title} className="px-4 py-3">
          <p className="text-xs font-medium text-foreground">{note.title}</p>
          <p className={`mt-0.5 ${HINT}`}>{note.detail}</p>
        </li>)}
      </ul>
    </Section>

    <SaveFeedback saved={justSaved} saveError={error} />
  </div>;
}

export const SearchSettings = (context: UiRenderContext) => <SearchSettingsView {...context} />;
