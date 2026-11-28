import { AttachImageButton, ImageAttachmentTray, ImageDropOverlay } from '@app/shared/images/ChatImageControls';
import { useChatImages } from '@app/shared/images/useChatImages.ts';
import { ArrowUp } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef } from 'react';
import type { FloatingComposerService } from '../../service/FloatingComposerService';

/** 桌宠悬浮输入栏。高度随图片和文字变化，通过 onHeightChange 交给画布计算可点击区域。 */
export const FloatingComposer = observer(({ service, style, onInteractivityChange, onHeightChange }: {
  service: FloatingComposerService; style: { left: number; top: number; width: number; height?: number };
  onInteractivityChange: () => void;
  onHeightChange?: (height: number) => void;
}) => {
  const attachments = useChatImages();
  const card = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const visible = service.visible;
  useEffect(() => {
    const node = card.current;
    if (!visible || !node || !onHeightChange) return undefined;
    const report = () => onHeightChange(Math.ceil(node.getBoundingClientRect().height));
    report();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(report);
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, onHeightChange]);
  if (!visible) return null;

  const canSend = !attachments.reading && !attachments.error && Boolean(service.draft.trim() || attachments.count);
  const send = () => {
    void attachments.submit(images => service.submit(images)).then(sent => {
      if (sent) { input.current?.blur(); onInteractivityChange(); }
    });
  };
  return <div ref={card} style={{ left: style.left, top: style.top, width: style.width }} {...attachments.dropProps}
    onPointerDown={(event) => event.stopPropagation()}
    className="pointer-events-auto absolute z-30 rounded-2xl border border-foreground/10 bg-card/95 text-foreground
      shadow-[0_8px_28px_-10px_rgb(120_60_80/0.35)] backdrop-blur-md transition-colors focus-within:border-primary/40">
    <ImageAttachmentTray images={attachments} className="px-3 pt-3" />
    <textarea ref={input} aria-label="与桌宠对话" placeholder="说点什么，或者粘贴一张图片…" rows={1}
      className="block max-h-28 min-h-9 w-full resize-none bg-transparent px-3.5 pt-2.5 pb-1 text-sm leading-5
        outline-none [field-sizing:content] placeholder:text-muted-foreground/80"
      value={service.draft}
      onChange={(event) => service.setDraft(event.target.value)}
      onPaste={attachments.onPaste}
      onFocus={() => { service.setFocused(true); onInteractivityChange(); }}
      onBlur={() => { service.setFocused(false); onInteractivityChange(); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); }
        if (event.key === 'Escape') { attachments.clear(); service.dismiss(); event.currentTarget.blur(); onInteractivityChange(); }
      }} />
    <div className="flex items-center gap-2 px-2 pb-2" onMouseDown={(event) => event.preventDefault()}>
      <AttachImageButton images={attachments}
        onPickingChange={(picking) => { service.setPicking(picking); onInteractivityChange(); }} />
      <span className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground/80">Enter 发送 · Shift+Enter 换行</span>
      <button type="button" aria-label="发送" title="发送" disabled={!canSend} onClick={send}
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground
          shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground
          disabled:shadow-none">
        <ArrowUp aria-hidden="true" className="size-4" strokeWidth={2.4} />
      </button>
    </div>
    <ImageDropOverlay active={attachments.dragging} />
  </div>;
});
