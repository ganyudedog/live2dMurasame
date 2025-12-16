export default function DebugRedLine({ redLineLeft }: { redLineLeft: number }) {
    return (
        <div
            className="absolute pointer-events-none"
            style={{
                left: redLineLeft,
                top: 0,
                bottom: 0,
                width: 0,
                borderLeft: '2px solid rgba(255, 0, 0, 0.95)',
                zIndex: 9999,
            }}
        />
  )
}