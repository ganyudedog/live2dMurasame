interface SymmetricMasks {
    left: { left: number; width: number };
    center: { left: number; width: number };
    right: { left: number; width: number };
    height: number;
}
export default function DebugSymmetricMasks({ symmetricMasks }: { symmetricMasks: SymmetricMasks }) {
    return (
        <>
            <div
                className="absolute"
                style={{
                    left: symmetricMasks.left.left,
                    top: 0,
                    width: symmetricMasks.left.width,
                    height: symmetricMasks.height,
                    backgroundColor: 'rgba(255, 0, 0, 0.5)',
                    pointerEvents: 'none',
                    zIndex: 5,
                }}
            />
            <div
                className="absolute"
                style={{
                    left: symmetricMasks.center.left,
                    top: 0,
                    width: symmetricMasks.center.width,
                    height: symmetricMasks.height,
                    backgroundColor: 'rgba(255, 255, 0, 0.5)',
                    pointerEvents: 'none',
                    zIndex: 5,
                }}
            />
            <div
                className="absolute"
                style={{
                    left: symmetricMasks.right.left,
                    top: 0,
                    width: symmetricMasks.right.width,
                    height: symmetricMasks.height,
                    backgroundColor: 'rgba(0, 102, 255, 0.5)',
                    pointerEvents: 'none',
                    zIndex: 5,
                }}
            />
        </>
    )
}