export type AsrConfig = Required<PetAsrConfig>;

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const optionalRange = (value: unknown, min: number, max: number): number | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.min(max, Math.max(min, value));
};

export const normalizeAsrConfig = (raw: PetAsrConfig = {}): AsrConfig => ({
  endpointPresetVersion: 1,
  profile: raw.profile === 'agent' ? 'agent' : 'conversation',
  vadModelPath: typeof raw.vadModelPath === 'string' ? raw.vadModelPath : '',
  vadThreshold: optionalRange(raw.vadThreshold, 0.05, 0.95),
  vadMinSpeechDuration: optionalRange(raw.vadMinSpeechDuration, 0.15, 0.3),
  mode: raw.mode === 'remote' ? 'remote' : 'local',
  engine: typeof raw.engine === 'string' && raw.engine.trim() ? raw.engine : 'sherpa-onnx',
  modelDir: typeof raw.modelDir === 'string' ? raw.modelDir : '',
  endpoint: typeof raw.endpoint === 'string' ? raw.endpoint : '',
  sampleRate: numberOr(raw.sampleRate, 16000),
  featureDim: numberOr(raw.featureDim, 80),
  numThreads: numberOr(raw.numThreads, 2),
  provider: typeof raw.provider === 'string' ? raw.provider : 'cpu',
  debug: numberOr(raw.debug, 0),
  rule1MinTrailingSilence: raw.endpointPresetVersion !== 1 && raw.rule1MinTrailingSilence === 2.4 && raw.rule2MinTrailingSilence === 1.2
    ? 1.2 : Math.max(0.5, numberOr(raw.rule1MinTrailingSilence, 1.2)),
  rule2MinTrailingSilence: raw.endpointPresetVersion !== 1 && raw.rule1MinTrailingSilence === 2.4 && raw.rule2MinTrailingSilence === 1.2
    ? 0.7 : Math.max(0.2, numberOr(raw.rule2MinTrailingSilence, 0.7)),
  rule3MinUtteranceLength: numberOr(raw.rule3MinUtteranceLength, 20),
});
