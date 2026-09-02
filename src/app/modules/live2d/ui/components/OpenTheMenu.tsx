interface ContextZoneStyle {
    left: number;
    top: number;
    width: number;
    height: number;
}
export default function OpenTheMenu({ contextZoneStyle, contextZoneAlignment }: { contextZoneStyle: ContextZoneStyle; contextZoneAlignment: 'left' | 'right' }) {
    return (
        <div
            className={`absolute z-30 font-medium border border-dashed border-slate-400/60 rounded-xl text-slate-200/90 flex items-center text-xs tracking-[0.02em] bg-slate-900/20 backdrop-blur-[6px] pointer-events-none px-2.5 ${
                contextZoneAlignment === 'left'
                    ? 'justify-start text-left'
                    : 'justify-end text-right'
            }`}
            style={{
                left: contextZoneStyle.left,
                top: contextZoneStyle.top,
                width: contextZoneStyle.width,
                height: contextZoneStyle.height,
            }}
        >
            右键菜单
        </div>
    );
}