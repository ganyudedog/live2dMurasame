import { observer } from 'mobx-react-lite';
import type { FloatingComposerService } from '../../service/FloatingComposerService';
export const FloatingComposer = observer(({ service, style, onInteractivityChange }: {
  service: FloatingComposerService; style: { left: number; top: number; width: number; height: number };
  onInteractivityChange: () => void;
}) => {
  if (!service.visible) return null;
  return <div className="absolute z-30 pointer-events-auto" style={style} onPointerDown={(event) => event.stopPropagation()}>
    <textarea aria-label="与桌宠对话" placeholder="Enter 发送 · Shift+Enter 换行" rows={2}
      className="w-full h-full resize-none rounded-xl border border-white/60 bg-white/95 px-3 py-2 text-slate-900 shadow-lg outline-none"
      style={{ fontSize: 14, lineHeight: '20px' }} value={service.draft}
      onChange={(event) => service.setDraft(event.target.value)}
      onFocus={() => { service.setFocused(true); onInteractivityChange(); }}
      onBlur={() => { service.setFocused(false); onInteractivityChange(); }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); service.submit(); event.currentTarget.blur(); onInteractivityChange(); }
        if (event.key === 'Escape') { service.dismiss(); event.currentTarget.blur(); onInteractivityChange(); }
      }} />
  </div>;
});
