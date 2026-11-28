export type AsrConfig = Required<PetAsrConfig>;

const optionalRange = (value: unknown, min: number, max: number): number | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
};

export const normalizeAsrConfig = (raw: PetAsrConfig = {}): AsrConfig => ({
  endpoint: typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '',
  vadThreshold: optionalRange(raw.vadThreshold, 0.05, 0.95),
  vadMinSpeechDuration: optionalRange(raw.vadMinSpeechDuration, 0.15, 0.3),
});
