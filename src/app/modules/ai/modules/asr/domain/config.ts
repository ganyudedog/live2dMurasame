export type AsrConfig = Required<PetAsrConfig>;

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

export const normalizeAsrConfig = (raw: PetAsrConfig = {}): AsrConfig => ({
  endpointPresetVersion: 1,
  profile: raw.profile === 'agent' ? 'agent' : 'conversation',
  vadModelPath: typeof raw.vadModelPath === 'string' ? raw.vadModelPath : '',
  vadThreshold: Math.min(0.95, Math.max(0.05, numberOr(raw.vadThreshold, 0.5))),
  vadMinSpeechDuration: Math.min(0.3, Math.max(0.15, numberOr(raw.vadMinSpeechDuration, 0.2))),
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
