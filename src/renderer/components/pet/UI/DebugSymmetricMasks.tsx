interface MaskSegment {
    left: number;
    width: number;
}

interface SymmetricMasks {
    left: MaskSegment;
    center: MaskSegment;
    right: MaskSegment;
    height: number;
}

export default function DebugSymmetricMasks({
    symmetricMasks,
    active,
}: {
    symmetricMasks: SymmetricMasks;
    active?: 'left' | 'right';
}) {
    const leftActive = active === 'left';
    const rightActive = active === 'right';
    return (
        <>
            {symmetricMasks.left.width > 0 && (
                <div
                    className={`absolute pointer-events-none top-0 z-9996 ${leftActive ? 'border-2 border-emerald-500/80' : 'border border-dashed border-emerald-500/50'} bg-emerald-500/0`}
                    style={{
                        left: symmetricMasks.left.left,
                        width: symmetricMasks.left.width,
                        height: symmetricMasks.height,
                    }}
                />
            )}
            {symmetricMasks.center.width > 0 && (
                <div
                    className="absolute pointer-events-none top-0 z-9995 border border-dashed border-slate-400/40 bg-slate-400/0"
                    style={{
                        left: symmetricMasks.center.left,
                        width: symmetricMasks.center.width,
                        height: symmetricMasks.height,
                    }}
                />
            )}
            {symmetricMasks.right.width > 0 && (
                <div
                    className={`absolute pointer-events-none top-0 z-9996 ${rightActive ? 'border-2 border-sky-500/80' : 'border border-dashed border-sky-500/50'} bg-sky-500/0`}
                    style={{
                        left: symmetricMasks.right.left,
                        width: symmetricMasks.right.width,
                        height: symmetricMasks.height,
                    }}
                />
            )}
        </>
    );
}