interface ContextZoneStyle {
    left: number;
    top: number;
    width: number;
    height: number;
}
export default function OpenTheMenu({ contextZoneStyle, contextZoneAlignment }: { contextZoneStyle: ContextZoneStyle; contextZoneAlignment: 'left' | 'right' }) {
    return (
        <div
            className="absolute z-30 font-medium tracking-tight"
            style={{
                left: contextZoneStyle.left,
                top: contextZoneStyle.top,
                width: contextZoneStyle.width,
                height: contextZoneStyle.height,
                border: '1px dashed rgba(148, 163, 184, 0.6)',
                borderRadius: '12px',
                color: 'rgba(226, 232, 240, 0.9)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: contextZoneAlignment === 'left' ? 'flex-start' : 'flex-end',
                fontSize: '0.75rem',
                letterSpacing: '0.02em',
                background: 'rgba(15, 23, 42, 0.18)',
                backdropFilter: 'blur(6px)',
                pointerEvents: 'none',
                padding: '0 10px',
                textAlign: contextZoneAlignment === 'left' ? 'left' : 'right',
            }}
        >
            右键菜单
        </div>
    )
}