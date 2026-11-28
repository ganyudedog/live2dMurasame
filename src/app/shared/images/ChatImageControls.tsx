import { useEffect, useRef } from 'react';
import { ImagePlus, LoaderCircle, TriangleExclamationPoint, X } from 'lucide-react';
import type { ChatImages } from './useChatImages';

const join = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

/** 输入框顶部的待发送图片：缩略图方块，悬停或聚焦时出现右上角的移除按钮。 */
export function ImageAttachmentTray({ images, className }: { images: ChatImages; className?: string }) {
  const { attachments, reading, error } = images;
  if (!attachments.length && !reading && !error) return null;
  return <div className={join('space-y-2', className)}>
    {(attachments.length > 0 || reading) && <ul aria-label="已添加图片" className="flex flex-wrap gap-2">
      {attachments.map((item) => <li key={item.id} className="group relative">
        <div className="size-14 overflow-hidden rounded-lg bg-muted ring-1 ring-foreground/10">
          <img src={item.url} alt={item.name || '已添加图片'} title={item.name || undefined}
            className="size-full object-cover" draggable={false} />
        </div>
        <button type="button" aria-label={`移除图片 ${item.name}`.trim()} title="移除" disabled={reading}
          onClick={() => images.remove(item.id)}
          className="absolute -top-1.5 -right-1.5 grid size-5 cursor-pointer place-items-center rounded-full bg-foreground
            text-background opacity-0 shadow-sm ring-2 ring-card transition-opacity group-hover:opacity-100
            focus-visible:opacity-100 disabled:cursor-not-allowed">
          <X aria-hidden="true" className="size-3" strokeWidth={2.6} />
        </button>
      </li>)}
      {reading && <li aria-label="正在读取图片" className="grid size-14 place-items-center rounded-lg bg-muted
        text-muted-foreground ring-1 ring-foreground/10">
        <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
      </li>}
    </ul>}
    {error && <div role="alert" className="flex items-center gap-1.5 text-[11px] leading-snug text-danger">
      <TriangleExclamationPoint aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{error}</span>
      <button type="button" aria-label="关闭提示" onClick={images.dismissError}
        className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-danger/10">
        <X aria-hidden="true" className="size-3" />
      </button>
    </div>}
  </div>;
}

/** 底栏的添加图片按钮；已有图片时显示 已选/上限。onPickingChange 报告系统选图对话框的开关。 */
export function AttachImageButton({ images, className, onPickingChange }: {
  images: ChatImages;
  className?: string;
  onPickingChange?: (picking: boolean) => void;
}) {
  const full = images.count >= images.max;
  const inputRef = useRef<HTMLInputElement>(null);
  const pickingRef = useRef(onPickingChange);
  useEffect(() => { pickingRef.current = onPickingChange; }, [onPickingChange]);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return undefined;
    const end = () => pickingRef.current?.(false);
    // 取消选择时 Chromium 触发 cancel；旧行为下只能等窗口重新获得焦点。
    const onFocus = () => setTimeout(end, 300);
    input.addEventListener('cancel', end);
    window.addEventListener('focus', onFocus);
    return () => { input.removeEventListener('cancel', end); window.removeEventListener('focus', onFocus); };
  }, []);
  return <label title={full ? `每轮最多 ${images.max} 张图片` : '添加图片（也可以粘贴或拖进来）'}
    className={join(`relative inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 text-[11px]
      transition-colors focus-within:ring-2 focus-within:ring-primary/35`,
      images.count ? 'bg-primary/10 text-primary hover:bg-primary/15' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      (full || images.reading) && 'cursor-not-allowed opacity-60', className)}>
    <ImagePlus aria-hidden="true" className="size-4" />
    {images.count > 0 && <span className="tabular-nums">{images.count}/{images.max}</span>}
    <input ref={inputRef} aria-label="选择本轮图片" className="sr-only" type="file" multiple accept="image/*"
      disabled={full || images.reading}
      onClick={() => onPickingChange?.(true)}
      onChange={(event) => {
        onPickingChange?.(false);
        const next = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = '';
        if (next.length) void images.addFiles(next);
      }} />
  </label>;
}

/** 拖着文件经过输入区时盖上的提示层。 */
export function ImageDropOverlay({ active }: { active: boolean }) {
  if (!active) return null;
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-[inherit]
    border-2 border-dashed border-primary/60 bg-card/90 text-xs font-medium text-primary">
    <span className="flex items-center gap-1.5"><ImagePlus className="size-4" />松开即可添加图片</span>
  </div>;
}
