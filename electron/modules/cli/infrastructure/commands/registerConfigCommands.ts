import { createHash } from 'node:crypto';
import { z } from 'zod';
import { updateModelConfiguration, type ModelCommandDependencies } from '../../../modelenv/application/updateModelConfiguration.js';
import type { CliService } from '../../service/CliService.js';

const text = z.string().max(2000);
const lang = z.enum(['zh', 'en', 'ja', 'ko']);
const asr = z.object({
  mode: z.enum(['local', 'remote']).optional(),
  endpoint: text.optional(),
  modelDir: text.optional(),
  vadThreshold: z.number().min(0).max(1).optional(),
  numThreads: z.number().int().min(1).max(32).optional(),
  sampleRate: z.number().int().min(8000).max(48000).optional(),
}).strict();
const subtitle = z.object({
  enabled: z.boolean().optional(),
  alwaysOnTop: z.boolean().optional(),
  locked: z.boolean().optional(),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  outlineColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  backgroundOpacity: z.number().min(0).max(0.8).optional(),
  holdMs: z.number().min(500).max(5000).optional(),
}).strict();
const globalPatch = z.object({
  scale: z.number().min(0.3).max(2).optional(),
  ignoreMouse: z.boolean().optional(),
  autoLaunch: z.boolean().optional(),
  showDragHandleOnHover: z.boolean().optional(),
  forcedFollow: z.boolean().optional(),
  debugModeEnabled: z.boolean().optional(),
  displayLang: lang.optional(),
  memoryModel: text.optional(),
  memoryReasoningEffort: text.optional(),
  asr: asr.optional(),
  subtitle: subtitle.optional(),
  pushToTalk: z.object({ enabled: z.boolean().optional(), key: z.enum(['Backquote', 'ControlRight', 'F8']).optional() }).strict().optional(),
}).strict();
const tts = z.object({
  enabled: z.boolean().optional(),
  baseUrl: text.optional(),
  gptWeightsPath: text.optional(),
  sovitsWeightsPath: text.optional(),
  textLang: text.optional(),
  promptLang: text.optional(),
  refAudioPath: text.optional(),
  refAudioText: text.optional(),
  textSplitMode: z.enum(['cut0', 'cut1', 'cut2', 'cut3', 'cut4', 'cut5']).optional(),
  speedFactor: z.number().min(0.1).max(2).optional(),
  fragmentInterval: z.number().min(0).max(0.5).optional(),
  topK: z.number().int().min(1).max(100).optional(),
  topP: z.number().min(0).max(1).optional(),
  temperature: z.number().min(0).max(1).optional(),
}).strict();
const modelPatch = z.object({
  tts: tts.optional(),
  bubble: z.object({
    symmetric: z.boolean().optional(),
    side: z.enum(['auto', 'left', 'right']).optional(),
    sideWidth: z.number().min(120).max(1000).optional(),
  }).strict().optional(),
}).strict();
const target = { scope: z.enum(['global', 'model', 'environment']), modelPath: text.optional() };
const readSchema = z.object(target).strict();
const updateSchema = z.object({
  ...target,
  expectedRevision: z.string().min(1),
  patch: z.union([globalPatch, modelPatch, z.object({ currentModelPath: text }).strict()]),
}).strict();

const fingerprint = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const pick = (value: unknown, schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> => {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(Object.keys(schema.shape).filter((key) => source[key] !== undefined).map((key) => [key, source[key]]));
};

type ReadArgs = z.infer<typeof readSchema>;

/** Config command schemas. Reads and writes still go through the environment services. */
export const registerConfigCommands = (cli: CliService, dependencies: ModelCommandDependencies): void => {
  const { live2dEnvironmentService: live, publishSnapshot } = dependencies;
  const read = (args: ReadArgs): { value: unknown; revision: string } => {
    if (args.scope === 'environment') {
      const value = { modelPaths: live.listModelPaths(), currentModelPath: live.root.currentModelPath };
      return { value, revision: fingerprint(value) };
    }
    if (args.scope === 'global') {
      const value = pick(live.root.settings, globalPatch);
      if (isRecord(value.asr)) value.asr = pick(value.asr, asr);
      if (isRecord(value.subtitle)) value.subtitle = pick(value.subtitle, subtitle);
      return { value, revision: fingerprint(live.root.settings) };
    }
    if (!args.modelPath || !live.listModelPaths().includes(args.modelPath)) throw new Error('Specify an existing modelPath');
    const config = dependencies.modelEnvironmentService.getConfiguration(args.modelPath);
    const configuration = isRecord(config) ? config : {};
    return { value: { tts: pick(configuration.tts, tts), bubble: configuration.bubble }, revision: fingerprint(config) };
  };
  cli.register('config.get', {
    skill: 'settings',
    description: 'Read editable configuration and revision; credentials are excluded. model requires modelPath.',
    schema: readSchema,
    execute: read,
  });
  cli.register('config.update', {
    skill: 'settings',
    description: 'Read config.get first, then submit a minimal patch with that revision. Saved does not imply TTS/ASR is ready.',
    schema: updateSchema,
    execute: (args) => {
      if (read(args).revision !== args.expectedRevision) throw new Error('Configuration revision conflict; read again');
      if (args.scope === 'global') {
        const patch = globalPatch.parse(args.patch);
        if (patch.asr) {
          const current = isRecord(live.root.settings) ? live.root.settings.asr : undefined;
          patch.asr = { ...(isRecord(current) ? current : {}), ...patch.asr };
        }
        live.updateSettings(patch);
      } else if (args.scope === 'model') {
        if (!args.modelPath) throw new Error('Specify an existing modelPath');
        updateModelConfiguration(dependencies, args.modelPath, modelPatch.parse(args.patch));
      } else {
        const patch = z.object({ currentModelPath: text }).strict().parse(args.patch);
        if (!live.listModelPaths().includes(patch.currentModelPath)) throw new Error('Model must already be registered');
        publishSnapshot(live.update(patch));
      }
      return { applied: true, ...read(args) };
    },
  });
};
