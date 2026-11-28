import { useState } from 'react';
import { Dialog } from 'radix-ui';
import { ChevronLeft, ChevronRight, ImageOff, X } from 'lucide-react';
import { cn } from '../basic/cn';
import type { ChatImageSource } from './chatImageSource';

/** 消息上方的图片：单张按比例展示，多张排成两列方块；点开看大图。 */
export function MessageImages({ source, align = 'end' }: { source: ChatImageSource; align?: 'start' | 'end' }) {
  const previews = source.thumbnails?.length ? source.thumbnails : source.images ?? [];
  const full = source.images ?? [];
  const count = Math.max(source.imageCount ?? 0, previews.length, full.length);
  const [open, setOpen] = useState<number | null>(null);
  if (!count) return null;
  const single = count === 1;
  const tiles = Array.from({ length: count }, (_, index) => previews[index] ?? full[index] ?? null);
  return <>
    <ul aria-label={`${count} 张图片`} className={cn('grid gap-1.5', single ? 'grid-cols-1' : 'grid-cols-2',
      align === 'end' ? 'justify-items-end' : 'justify-items-start')}>
      {tiles.map((src, index) => <li key={index}>
        {src
          ? <button type="button" aria-label={`查看第 ${index + 1} 张图片`} onClick={() => setOpen(index)}
            className={cn(`block cursor-zoom-in overflow-hidden rounded-xl bg-muted ring-1 ring-foreground/10
              transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50`,
            single ? 'max-w-60' : 'size-28')}>
            <img src={src} alt={`第 ${index + 1} 张图片`} draggable={false}
              className={single ? 'block max-h-60 w-auto object-contain' : 'size-full object-cover'} />
          </button>
          : <div title="这张图片的预览没有保存下来"
            className={cn(`grid place-items-center gap-1 rounded-xl border border-dashed border-border bg-muted/50
              text-[10px] text-muted-foreground`, single ? 'h-24 w-36' : 'size-28')}>
            <span className="flex flex-col items-center gap-1"><ImageOff aria-hidden="true" className="size-4" />图片未保存</span>
          </div>}
      </li>)}
    </ul>
    {open !== null && <ImageLightbox images={tiles.map((src, index) => full[index] ?? src)} index={open}
      onIndexChange={setOpen} onClose={() => setOpen(null)} />}
  </>;
}

function ImageLightbox({ images, index, onIndexChange, onClose }: {
  images: ReadonlyArray<string | null>;
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const available = images.map((src, at) => (src ? at : -1)).filter((at) => at >= 0);
  const position = available.indexOf(index);
  const step = (delta: number) => {
    const next = available[(position + delta + available.length) % available.length];
    if (next !== undefined) onIndexChange(next);
  };
  const src = images[index];
  const nav = 'grid size-9 cursor-pointer place-items-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/65';
  return <Dialog.Root open onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70 data-[state=open]:animate-[ui-fade-in_150ms_ease-out]" />
      <Dialog.Content aria-describedby={undefined}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') step(-1);
          if (event.key === 'ArrowRight') step(1);
        }}
        className="fixed inset-0 z-50 flex items-center justify-center p-10 outline-none" onClick={onClose}>
        <Dialog.Title className="sr-only">查看图片 {position + 1} / {available.length}</Dialog.Title>
        {src && <img src={src} alt={`第 ${index + 1} 张图片`} onClick={(event) => event.stopPropagation()}
          className="max-h-full max-w-full rounded-lg object-contain shadow-pop" />}
        <Dialog.Close aria-label="关闭" className={cn(nav, 'absolute top-4 right-4')}>
          <X aria-hidden="true" className="size-4" />
        </Dialog.Close>
        {available.length > 1 && <>
          <button type="button" aria-label="上一张" className={cn(nav, 'absolute top-1/2 left-4 -translate-y-1/2')}
            onClick={(event) => { event.stopPropagation(); step(-1); }}>
            <ChevronLeft aria-hidden="true" className="size-5" />
          </button>
          <button type="button" aria-label="下一张" className={cn(nav, 'absolute top-1/2 right-4 -translate-y-1/2')}
            onClick={(event) => { event.stopPropagation(); step(1); }}>
            <ChevronRight aria-hidden="true" className="size-5" />
          </button>
          <span className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/45 px-2.5 py-0.5 text-xs text-white
            tabular-nums">{position + 1} / {available.length}</span>
        </>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
