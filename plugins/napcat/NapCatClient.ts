import { OneBotConnection } from './OneBotConnection';
import { Outbox } from './Outbox';
import { readMessage, readQuote, type Segment } from './protocol';
import { composeQqTurn } from './turn';
import { ConversationLanes } from './inbound';
import { isQqUserId, privateUserAllowlist, type BridgeDirectory } from './directory';
import { loadStickerLabels, syncStickerCatalog, type StickerRule } from './stickers/catalog';
import { stickerPrompt } from './stickers/prompt';
import { mapStickerReply } from './stickers/reply';
import { normalizeInteractionSettings, type NapCatSettings } from './settings';
import type { BridgeRuntimeStatus } from './status';
import type {
  AiHostApi,
  ConversationChannel,
  ConversationResponse,
  PluginLogger,
  PluginStorage,
} from './types';

type Message = NonNullable<ReturnType<typeof readMessage>>;
interface Options {
  ai: AiHostApi;
  logger: PluginLogger;
  storage: PluginStorage;
  settings: NapCatSettings;
  directory: BridgeDirectory;
  onChannel: (id: string) => void;
  onReminderReceipt: (id: string) => void;
  onStatus: (status: BridgeRuntimeStatus) => void;
}
interface Admission {
  message: Message;
  stickers: StickerRule[];
  release?: () => void;
}

export class NapCatClient {
  private readonly socket: OneBotConnection;
  private readonly outbox: Outbox;
  private channel?: ConversationChannel;
  private readonly lanes = new ConversationLanes();
  private readonly admissions = new Map<string, Admission>();
  private settings: NapCatSettings;
  private directory: BridgeDirectory;
  private stopped = false;
  private connectionGeneration = 0;
  private reopen = false;
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
    this.settings = options.settings;
    this.directory = options.directory;
    this.socket = new OneBotConnection(
      this.settings.bridgeUrl,
      this.settings.token,
      options.logger,
      (frame) => this.receive(frame),
      () => {
        this.connectionGeneration++;
        this.outbox.connected();
      },
      (connection) => options.onStatus({ connection, updatedAt: Date.now() }),
    );
    this.outbox = new Outbox(options.storage, options.logger, this.socket, options.onReminderReceipt);
  }
  async start(
    pendingReminders: readonly {
      id: string;
      sentence: string;
      channelId: string;
      conversationId: string;
      submittedAt?: number;
    }[] = [],
  ) {
    await this.outbox.restore();
    if (this.stopped) return;
    this.openChannel();
    for (const record of pendingReminders) {
      this.options.onChannel(record.channelId);
      if (record.submittedAt !== undefined)
        await this.sendReminder(record.sentence, record.id, record.conversationId);
    }
    if (!this.stopped) this.socket.start();
  }
  private openChannel() {
    const channel = this.options.ai.openChannel({
      source: 'napcat',
      conversationId: 'qq',
      interaction: normalizeInteractionSettings(this.settings),
      displayLang: this.settings.displayLang,
      speakLang: this.settings.speakLang || null,
    });
    this.channel?.dispose();
    this.channel = channel;
    channel.onResponse((response) => this.respond(response));
    this.options.onChannel(channel.id);
  }
  updateDirectory(directory: BridgeDirectory) {
    this.directory = directory;
  }
  updateSettings(next: NapCatSettings) {
    this.reopen ||=
      JSON.stringify(normalizeInteractionSettings(this.settings)) !==
      JSON.stringify(normalizeInteractionSettings(next));
    this.settings = next;
    this.socket.configure(next.bridgeUrl, next.token);
    this.refreshChannel();
  }
  private refreshChannel() {
    if (!this.reopen || this.stopped || this.admissions.size) return;
    this.reopen = false;
    this.openChannel();
  }
  private receive(frame: unknown) {
    if (
      frame &&
      typeof frame === 'object' &&
      'meta_event_type' in frame &&
      frame.meta_event_type === 'lifecycle' &&
      'self_id' in frame &&
      isQqUserId(String(frame.self_id))
    ) {
      void this.refreshStickers(String(frame.self_id)).catch(() =>
        this.options.logger.info('stickers.refresh.unavailable'),
      );
      return;
    }
    const message = readMessage(frame, this.settings.wakeWords, privateUserAllowlist(this.directory));
    if (!message || !this.channel || this.stopped) return;
    const policy = normalizeInteractionSettings(this.settings);
    if (
      this.admissions.has(message.requestId) ||
      this.admissions.size >= policy.maxConcurrent + policy.maxQueued
    )
      return;
    const admission: Admission = { message, stickers: [] };
    this.admissions.set(message.requestId, admission);
    void this.lanes
      .run(message.conversationId, policy.mode !== 'interrupt', () => this.submit(admission))
      .catch(() => this.options.logger.error('message.submit.failed'))
      .finally(() => {
        this.admissions.delete(message.requestId);
        this.refreshChannel();
      });
  }
  private async refreshStickers(account: string) {
    const generation = this.connectionGeneration;
    const result = await this.socket.request('fetch_custom_face', { count: 200 }, 3000);
    if (!result.ok || !Array.isArray(result.data)) return;
    const items = await Promise.all(
      result.data
        .filter((url): url is string => typeof url === 'string' && /^https?:\/\//.test(url))
        .map(async (url) => {
          const { host, pathname } = new URL(url);
          const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(host + pathname));
          const id = Array.from(new Uint8Array(hash, 0, 8), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('');
          return { id, url, description: '' };
        }),
    );
    if (!this.stopped && this.connectionGeneration === generation)
      await syncStickerCatalog(this.options.storage, account, items);
  }
  private async submit(admission: Admission) {
    const { message } = admission;
    const seen = `onebot.seen.${message.requestId.replaceAll(':', '.')}`;
    if (this.stopped || (await this.options.storage.get(seen, false))) return;
    const labels = await loadStickerLabels(this.options.storage);
    admission.stickers = Object.entries(labels[message.self] ?? {})
      .map(([id, item]) => ({ id, ...item }))
      .filter(
        (item) => /^[a-f0-9]{16}$/.test(item.id) && item.description.trim() && /^https?:\/\//.test(item.url),
      )
      .slice(0, 12);
    const relationship = this.directory.ownerUserId
      ? await this.options.ai.getRelationship?.().catch(() => null)
      : null;
    const quoted = message.replyId
      ? await this.socket.request('get_msg', { message_id: message.replyId }, 3000)
      : undefined;
    if (
      this.stopped ||
      (message.archive.scope === 'private' &&
        !privateUserAllowlist(this.directory).includes(message.sender.id))
    )
      return;
    const turn = composeQqTurn({
      ...message,
      directory: this.directory,
      ownerAddress: relationship?.userAddress,
      ownerRelationship: relationship?.line,
      scenePrompt: [this.settings.systemPrompt, stickerPrompt(admission.stickers)]
        .filter(Boolean)
        .join('\n\n'),
      quote: quoted ? readQuote(quoted.ok ? quoted.data : undefined, message.self) : undefined,
    });
    await this.options.storage.set(seen, true);
    if (this.stopped) return;
    const done = new Promise<void>((resolve) => {
      admission.release = resolve;
    });
    const owner = message.sender.id === this.directory.ownerUserId;
    const result = this.channel!.sendText({
      ...turn,
      requestId: message.requestId,
      conversationId: message.conversationId,
      interactionKey: message.conversationId,
      sender: message.sender,
      memoryArchive: message.archive,
      isOwner: owner,
      ...(owner ? { personalMemory: { userText: message.text } } : {}),
      reasoningEffort: this.settings.reasoningEffort,
      displayLang: this.settings.displayLang,
      speakLang: this.settings.speakLang || null,
    });
    if (result.accepted) await done;
  }
  private respond(response: ConversationResponse) {
    const admission = this.admissions.get(response.requestId);
    if (!admission?.release || response.status === 'streaming') return;
    const release = admission.release;
    admission.release = undefined;
    if (response.status !== 'done' || !response.text.trim()) {
      release();
      return;
    }
    const mapped = mapStickerReply(response.text, admission.stickers);
    const marker = /\[\[sticker:([a-f0-9]{16})\]\]$/.exec(mapped);
    const text = marker ? mapped.slice(0, marker.index).trim() : mapped;
    const message: Segment[] = text ? [{ type: 'text', data: { text } }] : [];
    const image = admission.stickers.find((item) => item.id === marker?.[1]);
    if (image) message.push({ type: 'image', data: { file: image.url } });
    if (!message.length) {
      release();
      return;
    }
    void this.outbox
      .enqueue({
        id: response.requestId,
        conversationId: admission.message.conversationId,
        message,
        parent: response.trace,
      })
      .catch(() => this.options.logger.error('outbox.enqueue.failed'))
      .finally(release);
  }
  async sendReminder(text: string, id: string, conversationId: string): Promise<false | 'submitted'> {
    if (this.stopped || this.admissions.size || !/^qq:(user|group):[1-9]\d{4,19}$/.test(conversationId))
      return false;
    await this.outbox.enqueue({
      id,
      conversationId,
      message: [{ type: 'text', data: { text } }],
      reminder: true,
    });
    return 'submitted';
  }
  async dispose() {
    this.stopped = true;
    this.socket.dispose();
    const drained = this.outbox.dispose();
    for (const admission of this.admissions.values()) admission.release?.();
    this.channel?.dispose();
    await drained;
  }
}
