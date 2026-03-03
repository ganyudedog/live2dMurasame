export default function DebugRedLine({ redLineLeft }: { redLineLeft: number }) {
    return (
        <div
            className="absolute pointer-events-none top-0 bottom-0 w-0 border-l-2 border-red-500/95 z-9999"
            style={{
                left: redLineLeft,
            }}
        />
    );
}