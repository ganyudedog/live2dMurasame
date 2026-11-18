import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const runtime = vi.hoisted(() => ({ directory: '' }));
vi.mock('electron', () => ({ app: { isReady: () => true, getPath: () => runtime.directory } }));
import { loadLive2denvConfig, saveLive2denvConfig } from './configDao.js';
import { Live2dEnvironmentService } from '../modules/live2denv/application/Live2dEnvironmentService.js';
import { createCliModule } from '../modules/cli/module.js';
import { CallStore } from '../modules/cli/infrastructure/CallStore.js';

beforeEach(() => {
  runtime.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-migration-'));
  fs.mkdirSync(path.join(runtime.directory, 'config'));
});
afterEach(() => { fs.rmSync(runtime.directory, { recursive: true, force: true }); });
const file = (name: string) => path.join(runtime.directory, 'config', name);

it('loads the model and keeps shell read roots in the environment', () => {
  const modelFile = path.join(runtime.directory, 'pet.model3.json');
  fs.writeFileSync(modelFile, '{}');
  fs.writeFileSync(file('live2denv.json'), JSON.stringify({ modelPaths: [modelFile], currentModelPath: modelFile,
    settings: { shellReadRoots: [runtime.directory] } }));
  const environment = new Live2dEnvironmentService({ repository: { load: loadLive2denvConfig, save: saveLive2denvConfig } });
  expect(environment.initialize().activeModelFileUrl).toBe(pathToFileURL(modelFile).toString());
  expect(environment.root.settings.shellReadRoots).toEqual([runtime.directory]);
});

it.each([false, true])('does not import host grants from an obsolete task ledger (explicit: %s)', (explicit) => {
  fs.writeFileSync(file('globalModelConfig.json'), JSON.stringify({ apiKey: 'legacy' }));
  fs.writeFileSync(file('live2denv.json'), JSON.stringify({ settings: explicit ? { pluginCliWhitelist: [] } : {} }));
  const environment = new Live2dEnvironmentService({ repository: { load: loadLive2denvConfig, save: saveLive2denvConfig } });
  environment.initialize();
  fs.writeFileSync(path.join(runtime.directory, 'tasks.json'), JSON.stringify({ version: 1, calls: {}, tasks: {}, settings: { remoteSources: ['plugin:test'] } }));
  const cli = createCliModule({ directory: runtime.directory, protectedRoot: runtime.directory, live2dEnvironmentService: environment,
    modelEnvironmentService: { updateConfiguration: () => ({}), getConfiguration: () => ({}), getInteractionView: () => null },
    sendAll: vi.fn(), publishSnapshot: vi.fn(),
  });
  try {
    expect(environment.root.settings.pluginCliWhitelist ?? []).toEqual([]);
    expect(new CallStore(path.join(runtime.directory, 'tasks.json')).data).toEqual({ version: 1, calls: {} });
    expect(loadLive2denvConfig().settings).toEqual(environment.root.settings);
  } finally { cli.dispose(); }
});

it('moves legacy settings into the environment, prioritizes current settings, and survives subsequent saves', () => {
  fs.writeFileSync(file('globalModelConfig.json'), JSON.stringify({ apiKey: 'old-key', baseURL: 'old-url',
    pluginCliWhitelist: [{ pluginId: 'astrbot', cliEnabled: true }] }));
  fs.writeFileSync(file('live2denv.json'), JSON.stringify({ modelPaths: ['character'], currentModelPath: 'character',
    settings: { apiKey: 'current-key', baseURL: 'current-url' }, globalModelConfig: { apiKey: 'obsolete' } }));
  const environment = loadLive2denvConfig();
  expect(environment.settings).toMatchObject({ apiKey: 'current-key', baseURL: 'current-url',
    pluginCliWhitelist: [{ pluginId: 'astrbot', cliEnabled: true }] });
  expect(environment).not.toHaveProperty('globalModelConfig');
  expect(fs.existsSync(file('globalModelConfig.json'))).toBe(false);
  saveLive2denvConfig({ ...environment, settings: { ...environment.settings, scale: 1.2 } });
  expect(loadLive2denvConfig().settings).toMatchObject({ scale: 1.2 });
});

it('keeps explicit empty permissions instead of restoring revoked legacy entries', () => {
  fs.writeFileSync(file('globalModelConfig.json'), JSON.stringify({ pluginCliWhitelist: [{ pluginId: 'old', cliEnabled: true }] }));
  fs.writeFileSync(file('live2denv.json'), JSON.stringify({ settings: { pluginCliWhitelist: [] } }));
  expect(loadLive2denvConfig().settings).toMatchObject({ pluginCliWhitelist: [] });
});

it('imports credentials when only the old file exists and preserves unreadable legacy files', () => {
  fs.writeFileSync(file('globalModelConfig.json'), JSON.stringify({ apiKey: 'legacy-key' }));
  expect(loadLive2denvConfig().settings.apiKey).toBe('legacy-key');
  fs.writeFileSync(file('globalModelConfig.json'), '{broken');
  expect(loadLive2denvConfig().settings.apiKey).toBe('legacy-key');
  expect(fs.existsSync(file('globalModelConfig.json'))).toBe(true);
});

it.each([undefined, '{broken', 'null', '[]', '{"scale":1.2}'])('preserves the selected model through legacy migration (%s)', (legacy) => {
  const modelDirectory = path.join(runtime.directory, 'pet model');
  fs.mkdirSync(modelDirectory);
  const modelFile = path.join(modelDirectory, 'pet.model3.json');
  fs.writeFileSync(modelFile, '{}');
  const modelPaths = [modelDirectory];
  fs.writeFileSync(file('live2denv.json'), JSON.stringify({ modelPaths, currentModelPath: modelDirectory, settings: { shellReadRoots: [runtime.directory] } }));
  if (legacy !== undefined) fs.writeFileSync(file('globalModelConfig.json'), legacy);
  const environment = new Live2dEnvironmentService({ repository: { load: loadLive2denvConfig, save: saveLive2denvConfig } });
  expect(environment.initialize()).toMatchObject({ activeModelPath: modelDirectory, activeModelFileUrl: pathToFileURL(modelFile).toString() });
  expect(environment.snapshot().activeModelFileUrl).toBe(pathToFileURL(modelFile).toString());
  expect(loadLive2denvConfig()).toMatchObject({ modelPaths, currentModelPath: modelDirectory });
  expect(JSON.parse(fs.readFileSync(file('live2denv.json'), 'utf8'))).toMatchObject({ modelPaths, currentModelPath: modelDirectory });
  if (legacy !== undefined && legacy !== '{"scale":1.2}') {
    expect(fs.readFileSync(file('globalModelConfig.json'), 'utf8')).toBe(legacy);
  }
});

it('keeps a selected model file absent from the model list even when migration cannot be saved', () => {
  const modelFile = path.join(runtime.directory, 'pet.model3.json');
  fs.writeFileSync(modelFile, '{}');
  fs.writeFileSync(file('live2denv.json'), JSON.stringify({ modelPaths: [], currentModelPath: modelFile }));
  fs.writeFileSync(file('globalModelConfig.json'), '{"scale":1.2}');
  const rename = vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('read-only configuration'); });
  try {
    const environment = new Live2dEnvironmentService({ repository: { load: loadLive2denvConfig, save: saveLive2denvConfig } });
    expect(environment.initialize()).toMatchObject({ activeModelPath: modelFile, activeModelFileUrl: pathToFileURL(modelFile).toString() });
    expect(environment.root.modelPaths).toEqual([modelFile]);
    expect(fs.readFileSync(file('globalModelConfig.json'), 'utf8')).toBe('{"scale":1.2}');
  } finally {
    rename.mockRestore();
  }
  expect(loadLive2denvConfig()).toMatchObject({ modelPaths: [modelFile], currentModelPath: modelFile });
});

it('discards legacy project registries without migrating them into plugin storage', () => {
  fs.writeFileSync(file('live2denv.json'), JSON.stringify({ settings: { workspaces: { project: runtime.directory } } }));
  expect(loadLive2denvConfig().settings).not.toHaveProperty('workspaces');
  const ledgerFile = path.join(runtime.directory, 'tasks.json');
  fs.writeFileSync(ledgerFile, JSON.stringify({ version: 1, tasks: {}, calls: {},
    settings: { remoteSources: [], workspaces: [{ id: 'project', path: runtime.directory }] } }));
  const store = new CallStore(ledgerFile);
  expect(store.data).toEqual({ version: 1, calls: {} });
  store.save();
  expect(JSON.parse(fs.readFileSync(ledgerFile, 'utf8'))).toEqual({ version: 1, calls: {} });
});
