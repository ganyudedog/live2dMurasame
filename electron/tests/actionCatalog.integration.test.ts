import { JsonModelMemoryRepository } from '../infrastructure/persistence/JsonModelMemoryRepository.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { observable } from 'mobx';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelEnvironmentService } from '../../electron/modules/modelenv/application/ModelEnvironmentService.js';
import { Live2dEnvironmentService } from '../modules/live2denv/application/Live2dEnvironmentService.js';
import { normalizeLive2denvConfig } from '../dao/globalConfig.js';
import { JsonModelEnvironmentRepository } from '../../electron/infrastructure/persistence/JsonModelEnvironmentRepository.js';
import { registerModelenvIpc } from '../../electron/interface/ipc/registerModelenvIpc.js';
import { getModelConfigPathFor } from '../../electron/dao/configDao.js';
import { readActionSources } from '../../electron/modules/modelenv/infrastructure/ActionSourceReader.js';
import { createLive2dSnapshotStore } from '../../electron/preload/live2dSnapshotStore.js';
import { ConfigService } from '../../src/app/shared/config/ConfigService';
import { LogService } from '../../src/app/shared/logging/LogService';
import { LlmService } from '../../src/app/modules/ai/modules/llm/service/LlmService';
import { ActionSettingsService } from '../../src/app/modules/control-panel/modules/action-settings/service/ActionSettingsService';
import { Live2dActionService } from '../../src/app/modules/live2d/modules/actions/service/Live2dActionService';
import { bindActionCatalog } from '../../src/app/core/bindings/bindActionCatalog';
import { headAction } from '../../src/test/fixtures/actionCatalog';
import { ServiceContainer } from '../../src/app/core/di/container';
import { TOKENS } from '../../src/app/core/serviceTokens';
import { serviceModule } from '../../src/app/modules/ai/module';
import type { BootstrapContext } from '../../src/app/core/bootstrapContext';
import type { WindowKind } from '../../src/app/core/di/module';
import type { ElectronService } from '../../src/app/shared/electron/ElectronService';
import type { StateBusService } from '../../src/app/shared/state-bus/StateBusService';
import type { TraceScope } from '../../src/app/shared/logging/LogService';
import type { Live2dService } from '../../src/app/modules/live2d/service/Live2dService';
const network = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('openai', () => ({ default: class {
    chat = { completions: { create: network.create } };
} }));
const host = vi.hoisted(() => ({
    userData: '',
    handlers: new Map<string, (event: unknown, payload: unknown) => unknown>(),
}));
vi.mock('electron', () => ({
    app: { isReady: () => true, getPath: () => host.userData },
    ipcMain: { handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => host.handlers.set(channel, handler), on: vi.fn() },
}));
let root!: string;
let modelPath!: string;
const disposers: Array<() => void> = [];
beforeEach(() => {
    network.create.mockReset().mockImplementation(async function* () {
        yield { choices: [{ delta: { content: '{"display_text":"你好","speak_text":"你好"}' } }] };
    });
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-action-integration-'));
    host.userData = path.join(root, 'userData');
    modelPath = path.join(root, 'model');
    fs.mkdirSync(modelPath);
    fs.writeFileSync(path.join(modelPath, 'test.model3.json'), JSON.stringify({ FileReferences: {
            Motions: { Talk: [{ File: 'motion.motion3.json' }] }, DisplayInfo: 'test.cdi3.json',
        } }));
    fs.writeFileSync(path.join(modelPath, 'test.cdi3.json'), JSON.stringify({ Parameters: [{ Id: 'ParamAngleX', Name: '左右转头' }] }));
    fs.writeFileSync(path.join(modelPath, 'motion.motion3.json'), JSON.stringify({ Meta: { Duration: 2 }, Curves: [
            { Target: 'Parameter', Id: 'ParamAngleX', Segments: [0, 0, 0, 0.5, 20, 1, 0.6, 20, 0.8, -20, 1, -20, 2, 1.5, 5, 3, 2, 0] },
            { Target: 'Model', Id: 'EyeBlink', Segments: [0, 1, 0, 2, 1] },
        ] }));
    const cache = new Map();
    vi.stubGlobal('window', { localStorage: {
            getItem: (key: string) => cache.get(key) ?? null,
            setItem: (key: string, value: string) => cache.set(key, value),
        } });
    vi.spyOn(console, 'info').mockImplementation(() => { });
});
afterEach(() => {
    disposers.splice(0).reverse().forEach((dispose) => dispose());
    host.handlers.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fs.rmSync(root, { recursive: true, force: true });
});
function setup() {
    const createBackend = () => new ModelEnvironmentService({
        repository: new JsonModelEnvironmentRepository(), memoryRepository: new JsonModelMemoryRepository(), log: {},
        interactionCatalogReader: () => ({ motions: [], hitAreas: [] }),
    });
    let backend = createBackend();
    const environmentRoot = normalizeLive2denvConfig({ modelPaths: [modelPath], currentModelPath: modelPath,
        settings: { apiKey: 'test-key', model: 'test-model', baseURL: 'http://localhost' } });
    const createLiveEnvironment = () => new Live2dEnvironmentService({
        repository: { load: () => environmentRoot, save: (value) => value }, modelEnvironmentService: backend, log: {},
    });
    let liveEnvironment = createLiveEnvironment();
    const stores: Array<ReturnType<typeof createLive2dSnapshotStore>> = [];
    const previewListeners = new Set<(payload: { modelPath: string; actionId: string }) => void>();
    const register = () => registerModelenvIpc({
        modelEnvironmentService: backend, live2dEnvironmentService: liveEnvironment, pickTtsPath: vi.fn(),
        sendAll: (channel: string, payload: unknown) => {
            if (channel === 'ddd:modelenv:changed' && payload && typeof payload === 'object' && 'snapshot' in payload)
                stores.forEach((store) => store.dispatchSnapshotUpdate(structuredClone((payload as { snapshot: unknown }).snapshot)));
        },
        publishSnapshot: vi.fn(), getMainWindow: () => ({ isDestroyed: () => false, webContents: {
                send: (channel: string, payload: unknown) => {
                    if (channel === 'ddd:modelenv:actions:preview')
                        previewListeners.forEach((listener) => listener(structuredClone(payload) as { modelPath: string; actionId: string }));
                },
            } }),
    });
    register();
    const invoke = async (channel: string, payload: unknown) => {
        const handler = host.handlers.get(channel);
        if (!handler) throw new Error(`Missing handler ${channel}`);
        return structuredClone(await handler(null, structuredClone(payload)));
    };
    const modelApi = {
        getActionSources: (value: unknown) => invoke('ddd:modelenv:actions:sources', value),
        saveActionCatalog: (value: unknown) => invoke('ddd:modelenv:actions:save', value),
        previewAction: (value: unknown) => invoke('ddd:modelenv:actions:preview', value),
        onPreviewAction: (listener: (payload: { modelPath: string; actionId: string }) => void) => { previewListeners.add(listener); return () => { previewListeners.delete(listener); }; },
        updateConfig: (value: unknown) => invoke('ddd:modelenv:update', value),
    };
    const openRenderer = () => {
        const store = createLive2dSnapshotStore({ ipcRenderer: { sendSync: () => liveEnvironment.snapshot() } });
        stores.push(store);
        const bootstrap = { windowKind: 'control-panel' as const, startedAt: 0, configSnapshot: structuredClone(liveEnvironment.snapshot()) } as BootstrapContext;
        const log = new LogService(bootstrap);
        const config = new ConfigService({ bridge: { snapshotApi: store, modelApi: { ...modelApi, onConfigUpdated: store.onModelConfigUpdated } } } as unknown as ElectronService, log, bootstrap);
        config.start();
        disposers.push(() => config.dispose());
        return config;
    };
    return { modelApi, invoke, openRenderer, restart: () => {
        backend = createBackend(); liveEnvironment = createLiveEnvironment(); register();
    } };
}
describe('action catalog complete data path', () => {
    it.each(['pet', 'control-panel'] as const)('exposes saved and reopened actions to the real %s module prompt without late bindings', async (windowKind: WindowKind) => {
        const environment = setup();
        const panelConfig = environment.openRenderer();
        const createLlm = (config: ConfigService) => {
            const container = new ServiceContainer();
            container.registerValue(TOKENS.shared.config, config);
            container.registerValue(TOKENS.shared.log, new LogService({ windowKind, configSnapshot: null, startedAt: 0 }));
            container.registerValue(TOKENS.shared.stateBus, {} as unknown as StateBusService);
            container.registerValue(TOKENS.shared.electron, { bridge: {} } as unknown as ElectronService);
            container.registerValue(TOKENS.core.bootstrapContext, { windowKind } as BootstrapContext);
            // 两种窗口都不注册 Live2dService，动作目录仅由 Electron 快照提供。
            if (!serviceModule.register) throw new Error('AI module did not register');
            serviceModule.register(container);
            const llm = container.resolve(TOKENS.ai).llm;
            // 模型由控制面板按前端选择下发，等价于 ControlPanelService.pushChatModel。
            llm.setConfig({ model: 'test-model' });
            disposers.push(() => llm.dispose());
            return llm;
        };
        const record = vi.fn();
        const trace = { record } as unknown as TraceScope;
        const ask = async (llm: LlmService) => {
            const result = await llm.ask('打个招呼', { trace });
            expect(result).toMatchObject({ ok: true });
            const call = network.create.mock.lastCall;
            if (!call) throw new Error('missing llm request');
            return (call[0] as { messages: Array<{ content: string }> }).messages[0]?.content ?? '';
        };
        const llm = createLlm(environment.openRenderer());
        expect(await ask(llm)).toContain('当前没有可用动作表');
        await panelConfig.saveActionCatalog(modelPath, [headAction]);
        // 完整路径：保存 IPC → 真实 DAO → 真实快照组装 → preload store → ConfigService → module.ts → prompt。
        const prompt = await ask(llm);
        expect(prompt).toContain('@action:head');
        expect(prompt).toContain('转头');
        expect(prompt).not.toContain('ParamAngleX');
        const workspace = new ActionSettingsService(llm.actionCatalog, panelConfig);
        disposers.push(() => workspace.dispose());
        const networkCalls = network.create.mock.calls.length;
        expect(await workspace.updateMetadata('head', '侧头倾听', '认真听对方说话时使用')).toBe(true);
        expect(network.create).toHaveBeenCalledTimes(networkCalls);
        expect(await ask(llm)).toContain('侧头倾听（head），认真听对方说话时使用');
        expect(JSON.parse(fs.readFileSync(getModelConfigPathFor(modelPath), 'utf8')).actions[0].tracks).toEqual(headAction.tracks);
        expect(record).toHaveBeenCalledWith('action.capabilitySnapshot', expect.objectContaining({
            source: 'model-config-snapshot', modelPath, actionCount: 1,
        }));
        environment.restart();
        const reopened = createLlm(environment.openRenderer());
        expect(await ask(reopened)).toContain('侧头倾听（head），认真听对方说话时使用');
        await panelConfig.saveActionCatalog(modelPath, []);
        expect(await ask(llm)).not.toContain('@action:head');
        expect(await ask(reopened)).toContain('当前没有可用动作表');
    });
    it('accepts the Editor duration rounding used by the bundled model', () => {
        fs.writeFileSync(path.join(modelPath, 'motion.motion3.json'), JSON.stringify({ Meta: { Duration: 5.03, Fps: 30 }, Curves: [
            { Target: 'Parameter', Id: 'ParamAngleX', Segments: [0, 0, 0, 5.033, 20] },
        ] }));
        const sources = readActionSources(modelPath);
        expect(sources.motions[0].durationMs).toBeCloseTo(5033);
        expect(sources.motions[0].curves[0].samples.at(-1)).toEqual([5033, 20]);
    });
    it('reads all four segment types from actual files and supplies parameter names and values', () => {
        const sources = readActionSources(modelPath);
        expect(sources.parameters).toEqual([{ id: 'ParamAngleX', name: '左右转头', observedMin: -20, observedMax: 20 }]);
        expect(sources.motions[0].curves).toHaveLength(1);
        expect(sources.motions[0].curves[0].samples).toContainEqual([1000, -20]);
        expect(sources.motions[0].curves[0].samples).toContainEqual([1500, 5]);
        expect(sources.motions[0]).not.toHaveProperty('file');
    });
    it('generates, writes through IPC and real DAO, reopens from disk and previews the saved trajectory', async () => {
        const environment = setup();
        const panelConfig = environment.openRenderer();
        const petConfig = environment.openRenderer();
        const llm = new LlmService({ getConfigSnapshot: () => panelConfig.getSnapshot() });
        disposers.push(() => llm.dispose());
        const request = vi.spyOn(llm, 'requestStructured').mockImplementation(async (prompt: string) =>
            prompt.includes('当前任务是审查') ? '{"issues":[]}' : JSON.stringify({ actions: [headAction] }));
        const workspace = new ActionSettingsService(llm.actionCatalog, panelConfig);
        workspace.start();
        disposers.push(() => workspace.dispose());
        const actions = new Live2dActionService();
        disposers.push(() => actions.dispose());
        const values = new Map([['ParamAngleX', 0]]);
        actions.attach({ getModel: () => ({ parameters: { ids: ['ParamAngleX'] } }), getParameterCount: () => 1,
            getParameterMinimumValue: () => -30, getParameterMaximumValue: () => 30, getParameterDefaultValue: () => 0,
            getParameterValueById: (id: string) => values.get(id) ?? 0, setParameterValueById: (id: string, value: number) => { values.set(id, value); } });
        disposers.push(bindActionCatalog(petConfig, { actions } as Live2dService, environment.modelApi));
        await workspace.generate();
        expect(workspace.error).toBeNull();
        expect(JSON.parse(request.mock.calls[0][1]).sources.windows[0].curves[0].samples[1][1]).toBe(20);
        expect(request.mock.calls.some(([prompt]) => prompt.includes('当前任务是审查'))).toBe(true);
        expect(JSON.parse(fs.readFileSync(getModelConfigPathFor(modelPath), 'utf8')).actions).toEqual([headAction]);
        expect(petConfig.modelConfig?.actions).toEqual([headAction]);
        expect(actions.getCapability().actions.map(({ id }) => id)).toEqual(['head']);
        // 存储重启后使用新的 repository/service 和 renderer，验证不依赖前端缓存。
        environment.restart();
        expect(environment.openRenderer().modelConfig?.actions).toEqual([headAction]);
        workspace.setDraft('@head 再转大一点');
        workspace.dispose();
        const reopened = new ActionSettingsService(llm.actionCatalog, environment.openRenderer());
        disposers.push(() => reopened.dispose());
        expect(reopened.draft).toBe('@head 再转大一点');
        expect(reopened.actions).toEqual([headAction]);
        // observable 经统一 DTO 转换后必须能通过 structuredClone IPC 边界。
        await panelConfig.saveActionCatalog(modelPath, observable([headAction]));
        vi.useFakeTimers();
        await reopened.preview('head');
        vi.advanceTimersByTime(600);
        values.set('ParamAngleX', 0);
        actions.tick();
        expect(values.get('ParamAngleX')).toBe(20);
        expect(actions.getMouseFollowWeight()).toBe(0);
        actions.release('interrupted');
        vi.advanceTimersByTime(125);
        values.set('ParamAngleX', 2);
        actions.tick();
        expect(values.get('ParamAngleX')).toBeCloseTo(11);
        vi.advanceTimersByTime(125);
        values.set('ParamAngleX', 2);
        actions.tick();
        expect(values.get('ParamAngleX')).toBe(2);
        await reopened.deleteAction('head');
        environment.restart();
        expect(environment.openRenderer().modelConfig?.actions).toEqual([]);
    });
    it('preserves disk data after invalid edits and unrelated config updates', async () => {
        const environment = setup();
        await environment.invoke('ddd:modelenv:actions:save', { modelPath, actions: [headAction] });
        const configFile = getModelConfigPathFor(modelPath);
        const before = fs.readFileSync(configFile, 'utf8');
        await expect(environment.invoke('ddd:modelenv:actions:save', { modelPath, actions: [{ ...headAction,
                    tracks: [{ parameterId: 'Unknown', keyframes: [{ timeMs: 0, value: 1 }] }],
                }] })).rejects.toThrow('Unknown');
        expect(fs.readFileSync(configFile, 'utf8')).toBe(before);
        await environment.invoke('ddd:modelenv:update', { modelPath, patch: { bubble: { side: 'left' } } });
        environment.restart();
        expect(environment.openRenderer().modelConfig?.actions).toEqual([headAction]);
        await expect(environment.invoke('ddd:modelenv:actions:preview', { modelPath, actionId: 'missing' })).rejects.toThrow();
        await expect(environment.invoke('ddd:modelenv:actions:preview', { modelPath: 'other', actionId: 'head' })).rejects.toThrow();
    });
    it('fails explicitly on missing, malformed or out-of-directory motion files', () => {
        const file = path.join(modelPath, 'motion.motion3.json');
        fs.writeFileSync(file, '{');
        expect(() => readActionSources(modelPath)).toThrow();
        fs.unlinkSync(file);
        expect(() => readActionSources(modelPath)).toThrow();
        fs.writeFileSync(path.join(root, 'outside.json'), '{}');
        fs.writeFileSync(path.join(modelPath, 'test.model3.json'), JSON.stringify({ FileReferences: {
                Motions: { Talk: [{ File: '../outside.json' }] },
            } }));
        expect(() => readActionSources(modelPath)).toThrow('目录之外');
    });
});
