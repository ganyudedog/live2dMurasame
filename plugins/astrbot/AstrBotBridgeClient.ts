import type { AiConversationHostApi, ConversationChannel, ConversationResponse, PluginLogger } from './types';
import type { AstrBotBridgeSettings } from './settings';
import { normalizeInteractionSettings } from './settings';
import type { AstrBotInbound, AstrBotOutbound } from './protocol';
import { isAstrBotQqMessage } from './protocol';

export interface AstrBotBridgeClientOptions {
  readonly url: string; readonly token?: string; readonly clientId: string;
  readonly ai: AiConversationHostApi; readonly logger: PluginLogger; readonly settings: AstrBotBridgeSettings;
}

/** Pet-window WebSocket adapter. It owns one channel whose policy is fixed by each successful handshake. */
export class AstrBotBridgeClient {
  private readonly options: AstrBotBridgeClientOptions;
  private settings: AstrBotBridgeSettings;
  private bridgeUrl: string;
  private token: string;
  private socket: WebSocket | null = null;
  private channel: ConversationChannel | null = null;
  private stopChannel: (() => void) | null = null;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private reconnectDelayMs = 1000;
  private handshakeAccepted = false;
  private disposed = false;
  private readonly pending = new Set<string>();

  constructor(options: AstrBotBridgeClientOptions) { this.options = options; this.settings = options.settings; this.bridgeUrl = options.url; this.token = options.token ?? ''; }
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
    this.settings = settings;
    this.bridgeUrl = settings.bridgeUrl;
    this.token = settings.token;
    if (this.socket && reconnectRequired) this.reconnect('settings changed');
    else this.connect();
  }
  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.channel?.dispose(); this.channel = null; this.stopChannel?.(); this.stopChannel = null;
    this.pending.clear();
    const socket = this.socket; this.socket = null;
    if (socket) { socket.onopen = null; socket.onmessage = null; socket.onerror = null; socket.onclose = null; socket.close(1000, 'plugin disposed'); }
  }
  private connect(): void {
    if (this.disposed || this.socket) return;
    let socket: WebSocket;
    try { socket = new WebSocket(this.bridgeUrl); }
    catch (error) { this.options.logger.error('websocket.create.failed', { error: toErrorMessage(error), url: this.bridgeUrl }); this.scheduleReconnect(); return; }
    this.socket = socket; this.handshakeAccepted = false;
    socket.onopen = () => {
      this.reconnectDelayMs = 1000;
      this.send({ type: 'hello', version: 2, clientId: this.options.clientId, ...(this.token ? { token: this.token } : {}), capabilities: { streaming: true, ttsText: this.settings.speakLang !== '', agent: false }, interaction: normalizeInteractionSettings(this.settings) });
      this.heartbeatTimer = window.setInterval(() => this.send({ type: 'ping', ts: Date.now() }), 15_000);
    };
    socket.onmessage = (event) => this.handleMessage(event.data);
    socket.onerror = () => this.options.logger.warn('websocket.error', { url: this.options.url });
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null; this.handshakeAccepted = false;
      this.channel?.dispose(); this.channel = null; this.stopChannel?.(); this.stopChannel = null;
      this.pending.clear();
      if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.options.logger.warn('websocket.closed', { code: event.code, reason: event.reason });
      this.scheduleReconnect();
    };
  }
  private reconnect(reason: string): void {
    const socket = this.socket; this.socket = null;
    this.channel?.dispose(); this.channel = null; this.stopChannel?.(); this.stopChannel = null;
    this.pending.clear();
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (socket) { socket.onclose = null; socket.close(1000, reason); }
    this.connect();
  }
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== null) return;
    const delay = this.reconnectDelayMs; this.reconnectDelayMs = Math.min(delay * 2, 15_000);
    this.reconnectTimer = window.setTimeout(() => { this.reconnectTimer = null; this.connect(); }, delay);
  }
  private handleMessage(raw: unknown): void {
    if (typeof raw !== 'string') return;
    let message: AstrBotInbound;
    try { message = JSON.parse(raw) as AstrBotInbound; }
    catch (error) { this.options.logger.warn('message.invalid-json', { error: toErrorMessage(error) }); return; }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      this.options.logger.warn('message.invalid-shape');
      return;
    }
    if (message.type === 'ping') { this.send({ type: 'pong', timestamp: message.timestamp ?? message.ts ?? Date.now() }); return; }
    if (message.type === 'hello.ack') {
      const requested = normalizeInteractionSettings(this.settings);
      const selected = message.interaction;
      if (message.version !== 2 || message.accepted !== true || this.handshakeAccepted
        || !selected || selected.mode !== requested.mode || selected.maxConcurrent !== requested.maxConcurrent || selected.maxQueued !== requested.maxQueued) {
        this.options.logger.error('handshake.rejected', { version: message.version });
        this.socket?.close(1008, 'unsupported bridge protocol');
        return;
      }
      this.handshakeAccepted = true;
      this.channel = this.options.ai.openChannel({
        source: 'astrbot', conversationId: 'astrbot', interaction: normalizeInteractionSettings(this.settings),
        model: this.settings.model, reasoningEffort: this.settings.reasoningEffort || undefined,
        displayLang: this.settings.displayLang, speakLang: this.settings.speakLang || null,
      });
      this.stopChannel = this.channel.onResponse((response) => this.handleAiResponse(response));
      return;
    }
    if (message.type === 'ai.cancel') {
      if (message.version === 2 && this.pending.has(message.requestId)) this.channel?.cancel(message.requestId);
      return;
    }
    if (!this.handshakeAccepted || !isAstrBotQqMessage(message)) return;
    if (this.pending.has(message.requestId)) { this.sendError(message.requestId, message.conversationId, 'Duplicate request id'); return; }
    this.pending.add(message.requestId);
    const result = this.channel?.sendText({
      text: message.text, requestId: message.requestId, conversationId: message.conversationId,
      interactionKey: message.interactionKey,
      systemPrompt: this.settings.systemPrompt,
      displayLang: message.displayLang ?? this.settings.displayLang,
      speakLang: message.speakLang === undefined ? (this.settings.speakLang || null) : message.speakLang,
    });
    if (!result?.accepted) {
      this.pending.delete(message.requestId);
      this.sendError(message.requestId, message.conversationId, `AI request rejected: ${result?.reason ?? 'unavailable'}`);
    }
  }
  private handleAiResponse(response: ConversationResponse): void {
    if (!this.pending.has(response.requestId)) return;
    this.send({ type: 'ai.response', version: 2, requestId: response.requestId, conversationId: response.conversationId,
      status: response.status, text: response.text, ...(response.speakText ? { speakText: response.speakText } : {}),
      ...(response.error ? { error: response.error } : {}) });
    if (response.status === 'done' || response.status === 'error' || response.status === 'cancelled') this.pending.delete(response.requestId);
  }
  private sendError(requestId: string, conversationId: string, error: string): void {
    this.send({ type: 'ai.response', version: 2, requestId, conversationId, status: 'error', text: '', error });
  }
  private send(payload: AstrBotOutbound): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    try { this.socket.send(JSON.stringify(payload)); }
    catch (error) { this.options.logger.error('message.send.failed', { type: payload.type, error: toErrorMessage(error) }); }
  }
}

const toErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);
