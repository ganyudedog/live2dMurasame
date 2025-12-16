interface VisualMask {
    center: { left: number; width: number };
    left: { left: number; width: number };
    right: { left: number; width: number };
    height: number;
}


export default function DebugVisualMasks({ visualMasks }: { visualMasks: VisualMask }) {
    return (
        <>
            <div
                className="absolute"
                style={{
                    left: visualMasks.left.left,
                    top: 0,
                    width: visualMasks.left.width,
                    height: visualMasks.height,
                    border: '1px dashed rgba(255, 255, 255, 0.4)',
                    pointerEvents: 'none',
                    zIndex: 6,
                }}
            />
            <div
                className="absolute"
                style={{
                    left: visualMasks.center.left,
                    top: 0,
                    width: visualMasks.center.width,
                    height: visualMasks.height,
                    border: '1px dashed rgba(255, 255, 255, 0.4)',
                    pointerEvents: 'none',
                    zIndex: 6,
                }}
            />
            <div
                className="absolute"
                style={{
                    left: visualMasks.right.left,
                    top: 0,
                    width: visualMasks.right.width,
                    height: visualMasks.height,
                    border: '1px dashed rgba(255, 255, 255, 0.4)',
                    pointerEvents: 'none',
                    zIndex: 6,
                }}
            />
        </>
    )
}