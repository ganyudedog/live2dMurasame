export type AsrConfig = Required<PetAsrConfig>;

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const optionalRange = (value: unknown, min: number, max: number): number | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
};

const namedSilence = (value: unknown, legacy: unknown, fallback: number, min: number): number =>
  Math.max(min, numberOr(value, numberOr(legacy, fallback)));

export const normalizeAsrConfig = (raw: PetAsrConfig = {}): AsrConfig => {
  const source = raw as PetAsrConfig & { rule1MinTrailingSilence?: number; rule2MinTrailingSilence?: number };
  return {
    vadModelPath: typeof source.vadModelPath === 'string' ? source.vadModelPath : '',
    vadThreshold: optionalRange(source.vadThreshold, 0.05, 0.95),
    vadMinSpeechDuration: optionalRange(source.vadMinSpeechDuration, 0.15, 0.3),
    mode: source.mode === 'remote' ? 'remote' : 'local',
    engine: typeof source.engine === 'string' && source.engine.trim() ? source.engine : 'sherpa-onnx',
    modelDir: typeof source.modelDir === 'string' ? source.modelDir : '',
    endpoint: typeof source.endpoint === 'string' ? source.endpoint : '',
    sampleRate: numberOr(source.sampleRate, 16000),
    featureDim: numberOr(source.featureDim, 80),
    numThreads: numberOr(source.numThreads, 2),
    provider: typeof source.provider === 'string' ? source.provider : 'cpu',
    debug: numberOr(source.debug, 0),
    silenceAfterText: namedSilence(source.silenceAfterText, source.rule1MinTrailingSilence, 1.2, 0.5),
    silenceWithoutText: namedSilence(source.silenceWithoutText, source.rule2MinTrailingSilence, 0.7, 0.2),
  };
};
