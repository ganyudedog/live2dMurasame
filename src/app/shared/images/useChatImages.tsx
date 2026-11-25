import { useEffect, useRef, useState } from 'react';
import type { ClipboardEventHandler, ReactNode } from 'react';
import { ImagePlus, X } from 'lucide-react';
import { readImageFiles } from './readImageFiles';

interface ChatImageAttachment {
  id: string;
  file: File;
  url: string;
}

export function useChatImages() {
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const locked = useRef(false);
  const revision = useRef(0);
  const nextId = useRef(0);
  useEffect(() => () => { revision.current++; }, []);

  function clear() {
    revision.current++;
    setAttachments([]);
    setError('');
  }

  function remove(id: string) {
    setAttachments(current => current.filter(item => item.id !== id));
    setError('');
  }

  async function addFiles(files: readonly File[]) {
    if (!files.length || reading) return;
    const current = revision.current;
    setReading(true);
    setError('');
    try {
      const nextFiles = [...attachments.map(item => item.file), ...files];
      const urls = await readImageFiles(nextFiles);
      if (revision.current !== current) return;
      setAttachments(nextFiles.map((file, index) => ({
        id: `${file.name}:${file.lastModified}:${nextId.current++}`, file, url: urls[index],
      })));
    } catch (cause) {
      if (revision.current === current) setError(cause instanceof Error ? cause.message : '读取图片失败');
    } finally {
      if (revision.current === current) setReading(false);
    }
  }

  const onPaste: ClipboardEventHandler<HTMLTextAreaElement> = (event) => {
    const images = Array.from(event.clipboardData.files).filter(file => file.type.startsWith('image/'));
    if (!images.length) return;
    event.preventDefault();
    void addFiles(images);
  };

  async function submit(send: (images?: readonly string[]) => void) {
    if (locked.current || reading || error) return false;
    locked.current = true;
    try {
      send(attachments.length ? attachments.map(item => item.url) : undefined);
      setAttachments([]);
      setError('');
      return true;
    } finally {
      locked.current = false;
    }
  }

  const preview: ReactNode = attachments.length ? <div className="flex flex-wrap gap-2 px-1 pb-1" aria-label="已添加图片">
    {attachments.map(item => <div key={item.id} className="group relative size-16 overflow-hidden rounded-lg border border-input bg-muted">
      <img src={item.url} alt={item.file.name || '已添加图片'} className="size-full object-cover" />
      <button type="button" aria-label={`移除图片 ${item.file.name || ''}`} title="移除图片" disabled={reading}
        onClick={() => remove(item.id)}
        className="absolute right-0.5 top-0.5 grid size-5 cursor-pointer place-items-center rounded-full bg-black/65 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100">
        <X size={12} aria-hidden="true" />
      </button>
    </div>)}
    <button type="button" aria-label="移除全部图片" title="移除全部图片" disabled={reading}
      onClick={clear} className="self-start rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground">
      清空
    </button>
  </div> : null;

  const picker = <div className="inline-flex items-center gap-1 text-xs">
    <label title="选择本轮图片" className="cursor-pointer inline-flex items-center gap-1">
      <ImagePlus size={16} aria-hidden="true" />{attachments.length || ''}
      <input aria-label="选择本轮图片" className="sr-only" type="file" multiple accept="image/*" disabled={reading}
        onChange={event => {
          const next = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = '';
          if (next.length) void addFiles(next);
        }} />
    </label>
    {error && <span role="alert" className="max-w-52 truncate text-danger" title={error}>{error}</span>}
  </div>;
  return { picker, preview, onPaste, submit, clear, count: attachments.length, reading };
}
