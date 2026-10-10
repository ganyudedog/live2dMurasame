export type AsrConfig = Required<PetAsrConfig>;

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const normalizeAsrConfig = (raw: PetAsrConfig = {}): AsrConfig => ({
  mode: raw.mode === 'remote' ? 'remote' : 'local',
  engine: typeof raw.engine === 'string' && raw.engine.trim() ? raw.engine : 'sherpa-onnx',
  modelDir: typeof raw.modelDir === 'string' ? raw.modelDir : '',
  endpoint: typeof raw.endpoint === 'string' ? raw.endpoint : '',
  sampleRate: numberOr(raw.sampleRate, 16000),
  featureDim: numberOr(raw.featureDim, 80),
  numThreads: numberOr(raw.numThreads, 2),
  provider: typeof raw.provider === 'string' ? raw.provider : 'cpu',
  debug: numberOr(raw.debug, 0),
  rule1MinTrailingSilence: numberOr(raw.rule1MinTrailingSilence, 2.4),
  rule2MinTrailingSilence: numberOr(raw.rule2MinTrailingSilence, 1.2),
  rule3MinUtteranceLength: numberOr(raw.rule3MinUtteranceLength, 20),
});
