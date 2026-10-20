import { observer } from 'mobx-react-lite';
import { useState, type CSSProperties } from 'react';
import { useService } from '@app/core/useService';
import { TOKENS } from '@app/core/serviceTokens';
import { subtitleFontSize } from '../../../../../shared/subtitleSettings.js';

export const SubtitleWindow = observer(() => {
  const service = useService(TOKENS.subtitle.runtime);
  const { state } = service;
  const [hovered, setHovered] = useState(false);
  const fontSize = subtitleFontSize(state.bounds.width, state.bounds.height);
  const lineHeight = fontSize * 1.35;
  const interactive = !state.settings.locked;
  // 背景透明度始终由设置决定（预览时也一样，否则调外观时看不到效果）；
  // 未锁定时保留极低的 1/255 底色，Windows 上全透明像素收不到鼠标事件。
  const opacity = Math.max(interactive ? 1 / 255 : 0, state.settings.backgroundOpacity);
  const style: CSSProperties = { position: 'fixed', inset: 0, padding: '8px 16px', overflow: 'hidden', userSelect: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8,
    cursor: interactive ? 'move' : 'default', opacity: state.fading ? 0 : 1, transition: 'opacity 200ms ease',
    background: hovered && interactive ? 'rgba(24,24,24,0.3)' : `rgba(24,24,24,${opacity})`,
    boxShadow: hovered && interactive ? 'inset 0 0 0 1px rgba(255,255,255,.7)' : 'none',
    color: state.settings.textColor, fontSize, lineHeight: `${lineHeight}px`, fontWeight: 600,
    fontFamily: '"Microsoft YaHei", sans-serif', textAlign: 'center',
    textShadow: `-1px -1px 0 ${state.settings.outlineColor},1px -1px 0 ${state.settings.outlineColor},-1px 1px 0 ${state.settings.outlineColor},1px 1px 0 ${state.settings.outlineColor}`,
  };
  return <div data-testid="subtitle-window" style={style}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onPointerDown={(event) => {
      if (!interactive || event.button !== 0) return;
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); service.beginGesture();
    }}
    onPointerUp={service.endGesture} onPointerCancel={service.endGesture} onLostPointerCapture={service.endGesture}>
    <style>{`@keyframes subtitle-roll { from { transform: translateY(0); } to { transform: translateY(-${lineHeight}px); } }`}</style>
    <div style={{ width: '100%', height: lineHeight * 2, overflow: 'hidden' }}>
      <div onAnimationEnd={service.finishAnimation} style={service.rolling ? { animation: 'subtitle-roll 120ms ease-out forwards' } : undefined}>
        {service.lines.map((line, index) => <div key={index} style={{ height: lineHeight, whiteSpace: 'pre' }}>{line || '\u00a0'}</div>)}
      </div>
    </div>
    {interactive && ['e', 'w', 'n', 's', 'ne', 'nw', 'se', 'sw'].map((edge) => {
      const corner = edge.length === 2;
      return <div key={edge} aria-label="调整字幕尺寸" style={{ position: 'absolute', cursor: `${edge}-resize`,
        width: corner || !['n', 's'].includes(edge) ? 8 : 'calc(100% - 16px)',
        height: corner || !['e', 'w'].includes(edge) ? 8 : 'calc(100% - 16px)',
        top: edge.includes('n') ? 0 : edge.includes('s') ? undefined : 8,
        bottom: edge.includes('s') ? 0 : undefined,
        left: edge.includes('w') ? 0 : edge.includes('e') ? undefined : 8,
        right: edge.includes('e') ? 0 : undefined,
      }} onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); service.beginGesture(edge);
      }} />;
    })}
  </div>;
});
