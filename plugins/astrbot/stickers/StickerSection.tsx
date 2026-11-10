import { useEffect, useRef, useState } from 'react';
import { ImageOff, Sticker } from 'lucide-react';
import type { PluginStorage } from '../types';
import { ERROR_NOTICE, HINT, INPUT } from '../styles';
import { Section } from '../ui/layout';
import { loadStickerLabels, type StickerRule } from './catalog';
export function StickerSection({ storage }: { storage: PluginStorage }) {
  const [catalog, setCatalog] = useState<Record<string, StickerRule[]>>({});
  const queue = useRef(Promise.resolve());
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const load = () => {
      void loadStickerLabels(storage).then((labels) => {
        if (active) setCatalog(Object.fromEntries(Object.entries(labels).map(([account, items]) =>
          [account, Object.entries(items).map(([id, item]) => ({ id, ...item }))])));
      }).catch((error) => { if (active) setError(String(error)); });
    };
    load();
    const off = storage.subscribe((key) => { if (key === 'stickerLabel') load(); });
    return () => { active = false; off(); };
  }, [storage]);
  const save = (account: string, item: StickerRule) => {
    queue.current = queue.current.then(async () => {
    try {
      const labels = await loadStickerLabels(storage);
      if (!labels[account]?.[item.id]) return;
      await storage.set('stickerLabel', { ...labels, [account]: { ...labels[account], [item.id]: { url: labels[account][item.id].url, description: item.description.trim() } } });
      setError('');
    } catch (error) { setError(String(error)); }
    });
  };
  return <Section icon={<Sticker />} title="QQ 收藏表情"
    description="收藏自动同步。只需填写简短表情词，例如“恶心”；离开输入框时保存。填好即可使用，无需启用，也可以不发送。">
    {error && <p role="alert" className={ERROR_NOTICE}>{error}</p>}
    {!Object.keys(catalog).length && <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed
      border-border px-4 py-8 text-center">
      <ImageOff aria-hidden="true" className="size-5 text-muted-foreground/60" />
      <p className={HINT}>尚未同步收藏，请等待 QQ 桥接连接。</p>
    </div>}
    {Object.entries(catalog).map(([account, items]) => <div key={account} className="space-y-2.5">
      <h3 className="flex items-center gap-2 text-xs font-medium text-foreground/80">
        QQ <span className="font-mono">{account}</span>
        <span className="rounded-full bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground">{items.length}</span>
      </h3>
      {!items.length && <p className={HINT}>此账号没有收藏表情。</p>}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => <StickerEditor key={item.id} item={item} onSave={(next) => void save(account, next)} />)}
      </div>
    </div>)}
  </Section>;
}
function StickerEditor({ item, onSave }: { item: StickerRule; onSave: (item: StickerRule) => void }) {
  const [draft, setDraft] = useState(item);
  const labelled = Boolean(draft.description.trim());
  return <div className={`flex flex-col gap-2 rounded-lg border p-2 transition-colors ${labelled
    ? 'border-border' : 'border-dashed border-border'}`}>
    <div className="grid aspect-square place-items-center overflow-hidden rounded-md bg-muted/60">
      <img src={item.url} alt="QQ 收藏表情" loading="lazy" referrerPolicy="no-referrer" className="size-full object-contain p-1.5" />
    </div>
    <input className={`${INPUT} w-full`} maxLength={80} value={draft.description} aria-label="表情词" placeholder="表情词"
      onChange={(event) => setDraft({ ...draft, description: event.target.value })} onBlur={() => onSave(draft)} />
  </div>;
}
