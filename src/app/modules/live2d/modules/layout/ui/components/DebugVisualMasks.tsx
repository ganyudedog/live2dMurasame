interface MaskSegment {
    left: number;
    width: number;
}

interface VisualMask {
    center?: MaskSegment;
    left?: MaskSegment;
    right?: MaskSegment;
    height: number;
}


export default function DebugVisualMasks({ visualMasks }: { visualMasks: VisualMask }) {
    return (
        <>
            {visualMasks.left && visualMasks.left.width > 0 && (
                <div
                    className="absolute pointer-events-none top-0 border border-dashed border-sky-500/55 bg-sky-500/10 z-9997"
                    style={{
                        left: visualMasks.left.left,
                        width: visualMasks.left.width,
                        height: visualMasks.height,
                    }}
                />
            )}
            {visualMasks.center && visualMasks.center.width > 0 && (
                <div
                    className="absolute pointer-events-none top-0 border border-dashed border-red-500/60 bg-red-500/0 z-9998"
                    style={{
                        left: visualMasks.center.left,
                        width: visualMasks.center.width,
                        height: visualMasks.height,
                    }}
                />
            )}
            {visualMasks.right && visualMasks.right.width > 0 && (
                <div
                    className="absolute pointer-events-none top-0 border border-dashed border-slate-300/45 bg-slate-300/0 z-9994"
                    style={{
                        left: visualMasks.right.left,
                        width: visualMasks.right.width,
                        height: visualMasks.height,
                    }}
                />
            )}
        </>
    );
}