import { mapStickerReply, type StickerChoice } from './stickers/reply';
import { loadStickerLabels, syncStickerCatalog, type StickerRule } from './stickers/catalog';
import { stickerPrompt } from './stickers/prompt';
import { normalizeDirectory, privateUserAllowlist, sceneKeyFor, EMPTY_DIRECTORY, type BridgeDirectory } from './directory';
import { ConversationLanes, MessageDedup, dedupKey } from './inbound';
import { ASTRBOT_PROTOCOL_VERSION, isAstrBotQqMessage, normalizeAstrBotMentions, normalizeAstrBotSender, toConversationQuote } from './protocol';
import { composeQqTurn } from './turn';
import type { BridgeRuntimeStatus } from './status';
import { normalizeInteractionSettings, normalizeWakeWords, type AstrBotBridgeSettings } from './settings';
import {
  createDiagnosticId, sanitizeLogDetail,
  type AiHostApi, type ConversationChannel, type ConversationErrorCode, type ConversationResponse, type PluginLogger, type PluginStorage,
} from './types';
import type { AstrBotInbound, AstrBotOutbound, AstrBotQqMessage } from './protocol';

export interface AstrBotBridgeClientOptions {
  readonly url: string; readonly token?: string; readonly clientId: string;
  readonly ai: AiHostApi; readonly logger: PluginLogger; readonly settings: AstrBotBridgeSettings;
  readonly storage: PluginStorage;
  readonly directory?: BridgeDirectory;
  readonly onStatus?: (status: BridgeRuntimeStatus) => void;
}

/** Pet-window WebSocket adapter. User-directory edits do not reconnect this socket. */
export class AstrBotBridgeClient {
  private readonly options: AstrBotBridgeClientOptions;
  private settings: AstrBotBridgeSettings;
  private allowedPrivateUsers: string[];
  private bridgeUrl: string;
  private token: string;
  private socket: WebSocket | null = null;
  private channel: ConversationChannel | null = null;
  private stopChannel: (() => void) | null = null;
  private stopTasks: (() => void) | null = null;
  private readonly taskSequences = new Map<string, number>();
  private readonly taskScopes = new Map<string, { conversationId: string; senderId: string }>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectDelayMs = 1000;
  private handshakeAccepted = false;
  private disposed = false;
  /** Bumped on disconnect, reconnect, and dispose. In-flight work captures the value it started with. */
  private generation = 0;
  private readonly admissions = new Map<string, Admission>();
  private readonly stickerChoices = new Map<string, StickerChoice[]>();
  private readonly dedup = new MessageDedup(256);
  private readonly lanes = new ConversationLanes();
  private status: BridgeRuntimeStatus;

  constructor(options: AstrBotBridgeClientOptions) {
    this.options = options;
    this.settings = options.settings;
    this.allowedPrivateUsers = privateUserAllowlist(options.directory ?? EMPTY_DIRECTORY);
    this.bridgeUrl = options.url;
    this.token = options.token ?? '';
    this.status = { connection: 'idle', protocol: ASTRBOT_PROTOCOL_VERSION, expectedProtocol: ASTRBOT_PROTOCOL_VERSION, updatedAt: Date.now() };
  }

  start(): void { if (!this.disposed) this.connect(); }

  updateSettings(settings: AstrBotBridgeSettings): void {
    if (JSON.stringify(settings) === JSON.stringify(this.settings)) return;
    const reconnectRequired = settings.bridgeUrl !== this.settings.bridgeUrl
      || settings.token !== this.settings.token
      || settings.interactionMode !== this.settings.interactionMode
      || settings.maxConcurrent !== this.settings.maxConcurrent
      || settings.maxQueued !== this.settings.maxQueued
      || settings.model !== this.settings.model
      || settings.reasoningEffort !== this.settings.reasoningEffort
      || settings.displayLang !== this.settings.displayLang
      || settings.speakLang !== this.settings.speakLang;
    const wakeChanged = JSON.stringify(settings.wakeWords) !== JSON.stringify(this.settings.wakeWords);
    this.settings = settings;
    this.bridgeUrl = settings.bridgeUrl;
    this.token = settings.token;
    if (reconnectRequired) {
      if (this.socket) this.reconnect('settings changed');
      else this.connect();
      return;
    }
    if (wakeChanged) this.publishTriggerSettings();
    if (!this.socket) this.connect();
  }

  updateDirectory(directory: BridgeDirectory): void {
    const allowed = privateUserAllowlist(directory);
    if (JSON.stringify(allowed) === JSON.stringify(this.allowedPrivateUsers)) return;
    this.allowedPrivateUsers = allowed;
    this.publishTriggerSettings();
  }

  private publishTriggerSettings(): void {
    this.send({ type: 'config.update', version: ASTRBOT_PROTOCOL_VERSION,
      wakeWords: this.settings.wakeWords, allowedPrivateUsers: this.allowedPrivateUsers });
  }

  dispose(): void {
    this.stopTasks?.(); this.stopTasks = null;
    this.disposed = true;
    this.releaseAll();
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.channel?.dispose(); this.channel = null; this.stopChannel?.(); this.stopChannel = null;
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.close(1000, 'plugin disposed'); }
  }

  private connect(): void {
    if (this.disposed || this.socket) return;
    let socket: WebSocket;
    try { socket = new WebSocket(this.bridgeUrl); }
    catch (error) {
      this.options.logger.error('websocket.create.failed', { error: sanitizeLogDetail(error) });
      this.publish({ connection: 'closed' });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket; this.handshakeAccepted = false;
    this.publish({ connection: 'connecting' });
    socket.onopen = () => {
      this.reconnectDelayMs = 1000;
      this.send({
        type: 'hello', version: ASTRBOT_PROTOCOL_VERSION, clientId: this.options.clientId,
        ...(this.token ? { token: this.token } : {}),
        capabilities: { streaming: true, ttsText: this.settings.speakLang !== '', agent: true },
        interaction: normalizeInteractionSettings(this.settings),
        wakeWords: this.settings.wakeWords,
        allowedPrivateUsers: this.allowedPrivateUsers,
      });
      this.heartbeatTimer = setInterval(() => this.send({ type: 'ping', ts: Date.now() }), 15_000);
    };
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onerror = () => this.options.logger.warn('websocket.error', { url: this.bridgeUrl });
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null; this.handshakeAccepted = false;
      this.releaseAll();
      this.stopTasks?.(); this.stopTasks = null;
      this.channel?.dispose(); this.channel = null; this.stopChannel?.(); this.stopChannel = null;
      if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.publish({ connection: 'closed' });
      this.options.logger.warn('websocket.closed', { code: event.code, reason: event.reason });
      this.scheduleReconnect();
    };
  }

  private reconnect(reason: string): void {
    this.stopTasks?.(); this.stopTasks = null;
    this.releaseAll();
    const socket = this.socket; this.socket = null;
    this.channel?.dispose(); this.channel = null; this.stopChannel?.(); this.stopChannel = null;
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (socket) { socket.onclose = null; socket.close(1000, reason); }
    this.connect();
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    const delay = this.reconnectDelayMs; this.reconnectDelayMs = Math.min(delay * 2, 15_000);
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let message: AstrBotInbound;
    try { message = JSON.parse(raw) as AstrBotInbound; }
    catch (error) { this.options.logger.warn('message.invalid-json', { error: sanitizeLogDetail(error) }); return; }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      this.options.logger.warn('message.invalid-shape');
      return;
    }
    if (message.type === 'stickers.catalog' && this.handshakeAccepted) {
      if (!/^[1-9][0-9]{4,19}$/.test(message.accountId) || !Array.isArray(message.items)) return;
      const items = message.items as StickerRule[];
      void syncStickerCatalog(this.options.storage, message.accountId, items).catch((error) =>
        this.options.logger.error('stickers.sync.failed', { error: sanitizeLogDetail(error) }));
      return;
    }
    if (message.type === 'ping') { this.send({ type: 'pong', timestamp: message.timestamp ?? message.ts ?? Date.now() }); return; }
    if (message.type === 'hello.ack') {
      const requested = normalizeInteractionSettings(this.settings);
      const selected = message.interaction;
      const wakeWords = normalizeWakeWords(message.wakeWords ?? []);
      const mismatch = message.version !== ASTRBOT_PROTOCOL_VERSION || message.accepted !== true || this.handshakeAccepted
        || !selected || selected.mode !== requested.mode || selected.maxConcurrent !== requested.maxConcurrent || selected.maxQueued !== requested.maxQueued
        || JSON.stringify(wakeWords) !== JSON.stringify(this.settings.wakeWords);
      if (mismatch) {
        this.options.logger.error('protocol.mismatch', { expected: ASTRBOT_PROTOCOL_VERSION, received: message.version, frame: 'hello.ack' });
        this.publish({ connection: 'protocol_mismatch' });
        this.socket?.close(1008, 'protocol mismatch');
        return;
      }
      this.handshakeAccepted = true;
      this.publish({ connection: 'ready' });
      const generation = this.generation;
      const channel = this.options.ai.openChannel({
        source: 'astrbot', conversationId: 'astrbot', interaction: requested,
        model: this.settings.model, reasoningEffort: this.settings.reasoningEffort || undefined,
        displayLang: this.settings.displayLang, speakLang: this.settings.speakLang || null,
      });
      this.channel = channel;
      this.stopChannel = channel.onResponse((response) => {
        if (this.generation !== generation || this.channel !== channel) return;
        this.handleAiResponse(response);
      });
      this.stopTasks = channel.onTask?.(({ task, sequence }) => {
        if (this.generation !== generation || this.channel !== channel) return;
        if ((this.taskSequences.get(task.id) ?? -1) >= sequence) return;
        if (this.socket?.readyState !== WebSocket.OPEN) return;
        const failed = task.status === 'failed' || Boolean(task.error?.trim());
        const diagnosticId = failed ? createDiagnosticId() : '';
        if (failed) {
          this.options.logger.warn('agent.task.failed', { taskId: task.id, requestId: task.requestId, diagnosticId, detail: sanitizeLogDetail(task.error || task.status) });
          this.noteFailure(task.requestId, 'task_failed', diagnosticId);
        }
        this.send({
          type: 'agent.task', version: ASTRBOT_PROTOCOL_VERSION, requestId: task.requestId, conversationId: task.conversationId,
          taskId: task.id, status: task.status, sequence, text: failed ? '' : task.summary.trim().slice(0, 240),
          ...(failed ? { error: { code: 'task_failed' as const, diagnosticId } } : {}),
        });
        this.taskSequences.set(task.id, sequence);
        if (this.taskSequences.size > 256) this.taskSequences.delete(this.taskSequences.keys().next().value!);
      }) ?? null;
      this.taskScopes.forEach((scope) => this.channel?.watchTasks?.(scope));
      return;
    }
    if (message.type === 'ai.cancel') {
      if (message.version === ASTRBOT_PROTOCOL_VERSION) this.cancelAdmission(message.requestId);
      else this.options.logger.error('protocol.mismatch', { expected: ASTRBOT_PROTOCOL_VERSION, received: message.version, frame: 'ai.cancel' });
      return;
    }
    if (message.type === 'qq.message' && message.version !== ASTRBOT_PROTOCOL_VERSION) {
      this.options.logger.error('protocol.mismatch', { expected: ASTRBOT_PROTOCOL_VERSION, received: message.version, frame: 'qq.message' });
      this.publish({ connection: 'protocol_mismatch' });
      return;
    }
    if (!this.handshakeAccepted || !isAstrBotQqMessage(message)) return;
    void this.acceptMessage(message);
  }

  private acceptMessage(message: AstrBotQqMessage): void {
    const channel = this.channel;
    if (!channel || !this.handshakeAccepted || this.disposed) {
      this.sendPublicError(message.requestId, message.conversationId, 'unavailable');
      return;
    }
    if (this.admissions.has(message.requestId)) {
      this.sendPublicError(message.requestId, message.conversationId, 'duplicate_request');
      return;
    }
    if (this.admissions.size >= this.admissionBudget()) {
      this.sendPublicError(message.requestId, message.conversationId, 'queue_full');
      return;
    }
    const key = dedupKey(message.accountId ?? '', message.conversationId, message.messageId ?? '');
    if (!this.dedup.accept(key)) {
      this.sendPublicError(message.requestId, message.conversationId, 'duplicate_request');
      return;
    }
    const admission: Admission = {
      id: message.requestId,
      conversationId: message.conversationId,
      generation: this.generation,
      channel,
      cancelled: false,
      submitted: false,
      settled: false,
      release: null,
    };
    this.admissions.set(admission.id, admission);
    const serial = this.settings.interactionMode !== 'interrupt';
    void this.lanes.run(message.conversationId, serial, () => this.executeAdmission(admission, message)).catch((error: unknown) => {
      this.options.logger.error('message.accept.failed', { error: sanitizeLogDetail(error) });
      if (this.isCurrent(admission)) this.sendPublicError(message.requestId, message.conversationId, 'generation_failed');
      this.settle(admission);
    });
  }

  private async executeAdmission(admission: Admission, message: AstrBotQqMessage): Promise<void> {
    try {
      if (!this.isCurrent(admission)) return;
      let directory = EMPTY_DIRECTORY;
      try { directory = normalizeDirectory(await this.options.storage.get('directory', EMPTY_DIRECTORY)); }
      catch (error) { this.options.logger.error('directory.load.failed', { error: sanitizeLogDetail(error) }); }
      if (!this.isCurrent(admission)) return;
      const channel = admission.channel;
      const sender = normalizeAstrBotSender(message.sender);
      const sceneKey = sceneKeyFor(message.source, message.memoryArchive);
      const mentions = normalizeAstrBotMentions(message.mentions, message.accountId);
      let stickers = message.stickers;
      if (message.accountId && Array.isArray(message.stickers)) {
        const account = message.accountId;
        const labels = await loadStickerLabels(this.options.storage);
        const items = (message.stickers as StickerRule[]).filter((item) => item && typeof item.id === 'string'
          && typeof item.url === 'string' && /^https?:\/\//.test(item.url)).map((item) => ({
            id: item.id, url: item.url, description: labels[account]?.[item.id]?.description ?? '',
          }));

        stickers = items;

      }
      this.stickerChoices.set(admission.id, Array.isArray(stickers) ? stickers
        .filter((item) => item && /^[a-f0-9]{16}$/.test(item.id) && typeof item.description === 'string'
          && item.description.trim())
        .slice(0, 12).map((item) => ({ id: item.id, description: item.description })) : []);
      const ownerRelationship = directory.ownerUserId
        ? await this.options.ai.getRelationship?.().catch((error) => {
          this.options.logger.error('relationship.load.failed', { error: sanitizeLogDetail(error) });
          return null;
        }) : null;
      if (!this.isCurrent(admission)) return;
      const turn = composeQqTurn({
        ownerRelationship: ownerRelationship?.line,
        ownerAddress: ownerRelationship?.userAddress,
        scenePrompt: [this.settings.systemPrompt, stickerPrompt(stickers)].filter(Boolean).join('\n\n'),
        directory,
        sceneKey,
        text: message.text,
        sender,
        mentions,
        quote: toConversationQuote(message),
      });
      if (sender) {
        const scope = { conversationId: message.conversationId, senderId: sender.id };
        this.taskScopes.set(JSON.stringify(scope), scope);
        if (this.taskScopes.size > 64) this.taskScopes.delete(this.taskScopes.keys().next().value!);
        channel.watchTasks?.(scope);
      } else {
        this.options.logger.warn('message.sender.missing', { requestId: message.requestId });
      }
      if (!this.isCurrent(admission)) return;
      admission.submitted = true;
      const done = this.waitTerminal(admission);
      let result: ReturnType<ConversationChannel['sendText']>;
      try {
        result = channel.sendText({
          text: turn.text,
          ...(sender?.id && sender.id === directory.ownerUserId && message.text.trim()
            ? { personalMemory: { userText: message.text } } : {}),
          systemPrompt: turn.systemPrompt,
          requestId: message.requestId,
          conversationId: message.conversationId,
          interactionKey: message.interactionKey,
          sender,
          memoryArchive: {
            platform: 'qq',
            scope: message.memoryArchive.startsWith('episode/user/') ? 'private' : 'group',
            id: message.memoryArchive.split('/').at(-1)!,
          },
          displayLang: message.displayLang ?? this.settings.displayLang,
          speakLang: message.speakLang === undefined ? (this.settings.speakLang || null) : message.speakLang,
        });
      } catch (error) {
        this.options.logger.error('message.submit.failed', { error: sanitizeLogDetail(error) });
        if (this.isCurrent(admission)) this.sendPublicError(message.requestId, message.conversationId, 'generation_failed');
        return;
      }
      if (admission.settled || !this.isCurrent(admission)) return;
      if (!result?.accepted) {
        this.sendPublicError(message.requestId, message.conversationId, rejectionCode(result?.reason));
        return;
      }
      this.publish({ lastRequestId: message.requestId });
      await done;
    } catch (error) {
      this.options.logger.error('message.submit.failed', { error: sanitizeLogDetail(error) });
      if (this.isCurrent(admission)) this.sendPublicError(message.requestId, message.conversationId, 'generation_failed');
    } finally {
      this.settle(admission);
    }
  }

  private handleAiResponse(response: ConversationResponse): void {
    const admission = this.admissions.get(response.requestId);
    if (!admission || !this.owns(admission) || !admission.submitted) return;
    if (response.status === 'streaming') return;
    if (response.status === 'error') {
      const diagnosticId = response.diagnosticId && /^diag_[a-z0-9]{8,32}$/.test(response.diagnosticId) ? response.diagnosticId : createDiagnosticId();
      const code = response.error ?? 'generation_failed';
      this.noteFailure(response.requestId, code, diagnosticId);
      this.send({ type: 'ai.response', version: ASTRBOT_PROTOCOL_VERSION, requestId: response.requestId, conversationId: response.conversationId, status: 'error', text: '', error: { code, diagnosticId } });
      this.settle(admission);
      return;
    }
    if (response.status === 'cancelled') {
      this.send({ type: 'ai.response', version: ASTRBOT_PROTOCOL_VERSION, requestId: response.requestId, conversationId: response.conversationId, status: 'cancelled', text: '' });
      this.settle(admission);
      return;
    }
    this.send({
      type: 'ai.response', version: ASTRBOT_PROTOCOL_VERSION, requestId: response.requestId, conversationId: response.conversationId,
      status: 'done', text: mapStickerReply(response.text, this.stickerChoices.get(admission.id) ?? []), ...(response.speakText ? { speakText: response.speakText } : {}),
    });
    this.settle(admission);
  }

  private cancelAdmission(requestId: string): void {
    const admission = this.admissions.get(requestId);
    if (!admission || !this.owns(admission)) return;
    admission.cancelled = true;
    if (admission.submitted) {
      admission.channel.cancel(requestId);
      return;
    }
    this.send({
      type: 'ai.response', version: ASTRBOT_PROTOCOL_VERSION, requestId: admission.id, conversationId: admission.conversationId,
      status: 'cancelled', text: '',
    });
    this.settle(admission);
  }

  private sendPublicError(requestId: string, conversationId: string, code: ConversationErrorCode): void {
    const diagnosticId = createDiagnosticId();
    this.noteFailure(requestId, code, diagnosticId);
    this.send({ type: 'ai.response', version: ASTRBOT_PROTOCOL_VERSION, requestId, conversationId, status: 'error', text: '', error: { code, diagnosticId } });
  }

  private waitTerminal(admission: Admission): Promise<void> {
    return new Promise((resolve) => { admission.release = resolve; });
  }

  /** Drops this admission only. A newer request with the same id keeps its own resolver. */
  private settle(admission: Admission): void {
    if (admission.settled) return;
    admission.settled = true;
    this.stickerChoices.delete(admission.id);
    if (this.admissions.get(admission.id) === admission) this.admissions.delete(admission.id);
    const release = admission.release;
    admission.release = null;
    release?.();
  }

  private releaseAll(): void {
    this.generation += 1;
    const stale = [...this.admissions.values()];
    this.admissions.clear();
    for (const admission of stale) this.settle(admission);
  }

  private admissionBudget(): number {
    const interaction = normalizeInteractionSettings(this.settings);
    return interaction.maxConcurrent + interaction.maxQueued;
  }

  private owns(admission: Admission): boolean {
    return !admission.settled
      && !this.disposed
      && admission.generation === this.generation
      && this.admissions.get(admission.id) === admission;
  }

  private isCurrent(admission: Admission): boolean {
    return this.owns(admission)
      && !admission.cancelled
      && this.handshakeAccepted
      && this.channel === admission.channel;
  }

  private publish(patch: Partial<BridgeRuntimeStatus>): void {
    this.status = { ...this.status, ...patch, protocol: ASTRBOT_PROTOCOL_VERSION, expectedProtocol: ASTRBOT_PROTOCOL_VERSION, updatedAt: Date.now() };
    try { this.options.onStatus?.(this.status); }
    catch (error) { this.options.logger.error('status.publish.failed', { error: sanitizeLogDetail(error) }); }
  }

  private noteFailure(requestId: string, code: string, diagnosticId: string): void {
    this.publish({ lastRequestId: requestId, lastError: { code, diagnosticId, requestId, at: Date.now() } });
  }

  private send(payload: AstrBotOutbound): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    try { this.socket.send(JSON.stringify(payload)); }
    catch (error) { this.options.logger.error('message.send.failed', { type: payload.type, error: sanitizeLogDetail(error) }); }
  }
}

interface Admission {
  readonly id: string;
  readonly conversationId: string;
  readonly generation: number;
  readonly channel: ConversationChannel;
  cancelled: boolean;
  submitted: boolean;
  settled: boolean;
  release: (() => void) | null;
}

const rejectionCode = (reason: string | undefined): ConversationErrorCode => {
  if (reason === 'duplicate') return 'duplicate_request';
  if (reason === 'queue-full') return 'queue_full';
  if (reason === 'invalid') return 'request_rejected';
  return 'unavailable';
};
