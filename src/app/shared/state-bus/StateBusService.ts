import { makeObservable, observable, observableRef, runInAction } from 'mobx';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import { SharedStoreClient } from './sharedStoreClient';
import type {
  ChatConfig,
  ChatRequest,
  ChatResponse,
  PatchOp,
  SharedState,
  WorkerOutboundMsg,
} from './sharedStateTypes';
import type { ConfigService } from '../config/ConfigService';
import type { ElectronService } from '../electron/ElectronService';
import type { LogService } from '../logging/LogService';

const DEFAULT_ASR_STATE: SharedState['asr'] = {
  enabled: false,
  state: 'off',
  partialText: '',
  error: null,
  throttled: false,
  lastUpdatedAt: 0,
};

const DEFAULT_CHAT_CONFIG: ChatConfig = {
  apiKey: '',
  baseURL: '',
  displayLang: 'zh',
  ttsMediaType: 'wav',
  ttsStreamingMode: true,
};

export class StateBusService {
  connected = false;
  revision = 0;
  scale = 1;
  asr: SharedState['asr'] = { ...DEFAULT_ASR_STATE };
  chatConfig: ChatConfig = { ...DEFAULT_CHAT_CONFIG };
  chatRequest: ChatRequest | null = null;
  chatResponse: ChatResponse | null = null;

  private readonly client = new SharedStoreClient();
  private readonly config: ConfigService;
  private readonly bridge: ElectronService['bridge'];
  private readonly log: LogService;
  private readonly windowKind: BootstrapContext['windowKind'];
  private unsubscribeWorker: (() => void) | null = null;
  private unsubscribeAsr: (() => void) | null = null;

  constructor(
    config: ConfigService,
    electron: ElectronService,
    log: LogService,
    bootstrap: BootstrapContext,
  ) {
    this.config = config;
    this.bridge = electron.bridge;
    this.log = log;
    this.windowKind = bootstrap.windowKind;
    makeObservable(this, {
      connected: observable,
      revision: observable,
      scale: observable,
      asr: observableRef,
      chatConfig: observableRef,
      chatRequest: observableRef,
      chatResponse: observableRef,
    });
  }

  async start(): Promise<void> {
    this.unsubscribeWorker = this.client.subscribe((message) => this.applyMessage(message));
    const initial = await this.client.getInitialState();
    if (initial) this.applyState(initial);
    runInAction(() => {
      this.connected = true;
    });

    this.seedFromPersistedConfig();
    if (this.windowKind === 'pet') {
      this.unsubscribeAsr = this.bridge.asrApi?.onEvent?.((event) => this.applyAsrEvent(event)) ?? null;
    }
    this.log.info('stateBus.service', 'started', {
      windowKind: this.windowKind,
      revision: this.revision,
      scale: this.scale,
    });
  }

  publishScale(value: number): void {
    const scale = Math.min(2, Math.max(0.3, Number.isFinite(value) ? value : 1));
    this.dispatch([{ path: 'global.scale', value: scale }], 'appearance.scale');
  }

  publishChatConfig(config: ChatConfig): void {
    this.dispatch([
      { path: 'config.apiKey', value: config.apiKey },
      { path: 'config.baseURL', value: config.baseURL },
      { path: 'config.displayLang', value: config.displayLang },
      { path: 'config.ttsMediaType', value: config.ttsMediaType },
      { path: 'config.ttsStreamingMode', value: config.ttsStreamingMode },
    ], 'ai.config');
  }

  publishChatRequest(request: ChatRequest): void {
    this.dispatch([{ path: 'chat.request', value: request }], 'chat.request');
  }

  publishChatResponse(response: ChatResponse): void {
    this.dispatch([{ path: 'chat.response', value: response }], 'chat.response');
  }

  setAsrEnabled(enabled: boolean): void {
    this.dispatch([{ path: 'asr.enabled', value: Boolean(enabled) }], 'asr.enabled');
  }

  private seedFromPersistedConfig(): void {
    const globalConfig = this.config.globalModelConfig;
    if (typeof globalConfig?.scale === 'number' && Number.isFinite(globalConfig.scale)) {
      this.publishScale(globalConfig.scale);
    }
    this.publishChatConfig({
      apiKey: typeof globalConfig?.apiKey === 'string' ? globalConfig.apiKey : '',
      baseURL: typeof globalConfig?.baseURL === 'string' ? globalConfig.baseURL : '',
      displayLang: normalizeDisplayLang(globalConfig?.displayLang),
      ttsMediaType: normalizeMediaType(globalConfig?.ttsMediaType),
      ttsStreamingMode: globalConfig?.ttsStreamingMode !== false,
    });
  }

  private dispatch(ops: PatchOp[], event: string): void {
    this.client.dispatchPatch(ops);
    this.log.debug('stateBus.service', 'publish', {
      event,
      opCount: ops.length,
      revision: this.revision,
    });
  }

  private applyMessage(message: WorkerOutboundMsg): void {
    if (message.type === 'state') {
      this.applyState(message.state);
      return;
    }
    runInAction(() => {
      this.revision = message.rev;
      this.applyPatchOps(message.ops);
    });
  }

  private applyState(state: SharedState): void {
    runInAction(() => {
      this.revision = state.rev;
      this.scale = state.global.scale;
      this.asr = { ...state.asr };
      this.chatConfig = { ...state.config };
      this.chatRequest = state.chat.request;
      this.chatResponse = state.chat.response;
    });
  }

  private applyPatchOps(ops: PatchOp[]): void {
    let nextAsr = this.asr;
    let nextConfig = this.chatConfig;
    for (const op of ops) {
      if (op.path === 'global.scale' && typeof op.value === 'number') this.scale = op.value;
      else if (op.path === 'asr.enabled') nextAsr = { ...nextAsr, enabled: Boolean(op.value) };
      else if (op.path === 'asr.state' && typeof op.value === 'string') nextAsr = { ...nextAsr, state: op.value as SharedState['asr']['state'] };
      else if (op.path === 'asr.partialText' && typeof op.value === 'string') nextAsr = { ...nextAsr, partialText: op.value };
      else if (op.path === 'asr.error') nextAsr = { ...nextAsr, error: typeof op.value === 'string' ? op.value : null };
      else if (op.path === 'asr.throttled') nextAsr = { ...nextAsr, throttled: Boolean(op.value) };
      else if (op.path === 'asr.lastUpdatedAt' && typeof op.value === 'number') nextAsr = { ...nextAsr, lastUpdatedAt: op.value };
      else if (op.path === 'config.apiKey' && typeof op.value === 'string') nextConfig = { ...nextConfig, apiKey: op.value };
      else if (op.path === 'config.baseURL' && typeof op.value === 'string') nextConfig = { ...nextConfig, baseURL: op.value };
      else if (op.path === 'config.displayLang' && typeof op.value === 'string') nextConfig = { ...nextConfig, displayLang: normalizeDisplayLang(op.value) };
      else if (op.path === 'config.ttsMediaType' && typeof op.value === 'string') nextConfig = { ...nextConfig, ttsMediaType: normalizeMediaType(op.value) };
      else if (op.path === 'config.ttsStreamingMode') nextConfig = { ...nextConfig, ttsStreamingMode: Boolean(op.value) };
      else if (op.path === 'chat.request') this.chatRequest = op.value as ChatRequest;
      else if (op.path === 'chat.response') this.chatResponse = op.value as ChatResponse;
    }
    if (nextAsr !== this.asr) this.asr = { ...nextAsr, lastUpdatedAt: nextAsr.lastUpdatedAt || Date.now() };
    if (nextConfig !== this.chatConfig) this.chatConfig = nextConfig;
  }

  private applyAsrEvent(event: PetAsrEvent): void {
    const ops: PatchOp[] = [];
    if (event.type === 'mic.state') {
      ops.push(
        { path: 'asr.enabled', value: event.enabled },
        { path: 'asr.state', value: event.state },
        { path: 'asr.lastUpdatedAt', value: event.ts },
      );
    } else if (event.type === 'asr.partial') {
      ops.push(
        { path: 'asr.state', value: 'active' },
        { path: 'asr.partialText', value: event.text },
        { path: 'asr.error', value: null },
        { path: 'asr.lastUpdatedAt', value: event.ts },
      );
    } else if (event.type === 'asr.final') {
      ops.push(
        { path: 'asr.partialText', value: '' },
        { path: 'asr.error', value: null },
        { path: 'asr.lastUpdatedAt', value: event.ts },
      );
    } else if (event.type === 'asr.error') {
      ops.push(
        { path: 'asr.state', value: 'error' },
        { path: 'asr.error', value: event.message },
        { path: 'asr.lastUpdatedAt', value: event.ts },
      );
    } else if (event.type === 'asr.throttle') {
      ops.push(
        { path: 'asr.throttled', value: event.enabled },
        { path: 'asr.lastUpdatedAt', value: event.ts },
      );
    }
    if (ops.length > 0) this.dispatch(ops, event.type);
  }

  dispose(): void {
    this.unsubscribeWorker?.();
    this.unsubscribeAsr?.();
    this.unsubscribeWorker = null;
    this.unsubscribeAsr = null;
    this.client.dispose();
    runInAction(() => {
      this.connected = false;
    });
    this.log.info('stateBus.service', 'disposed', { windowKind: this.windowKind });
  }
}

const normalizeDisplayLang = (value: unknown): ChatConfig['displayLang'] => (
  value === 'en' || value === 'ja' || value === 'ko' ? value : 'zh'
);

const normalizeMediaType = (value: unknown): ChatConfig['ttsMediaType'] => (
  value === 'ogg' || value === 'aac' ? value : 'wav'
);
