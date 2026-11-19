export type ReminderChannel =
  | { kind: 'desktop' }
  | { kind: 'channel'; channelId: string; source: string; conversationId: string; requestId?: string };

export type ReminderChannelDelivery = (record: ReminderRecord) => boolean | 'submitted' | Promise<boolean | 'submitted'>;

export interface ReminderRecord {
  id: string;
  dueAt: number;
  sentence: string;
  speakText?: string;
  submittedAt?: number;
  history?: { modelPath: string; archive?: PetMemoryArchive; sender?: PetMemoryTurn['sender'] };
  channel: ReminderChannel;
}

type StoredReminder = ReminderRecord;

const STORAGE_KEY = 'live2d.reminders.v1';
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const validChannel = (value: unknown): value is StoredReminder['channel'] => {
  if (!isRecord(value) || value.kind === 'desktop') return isRecord(value) && value.kind === 'desktop';
  return value.kind === 'channel' && typeof value.channelId === 'string' && typeof value.source === 'string' && typeof value.conversationId === 'string';
};
const readStored = (): StoredReminder[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    // Migrate the old completion flag before any caller can schedule restored records.
    const pending = parsed.flatMap(item => {
      if (!isRecord(item) || !('delivered' in item)) return [item];
      const { delivered, ...rest } = item;
      return delivered === false ? [rest] : [];
    });
    const records = pending.filter((item): item is StoredReminder => isRecord(item)
      && typeof item.id === 'string' && Number.isFinite(item.dueAt) && typeof item.sentence === 'string'
      && (item.speakText === undefined || typeof item.speakText === 'string')
      && (item.submittedAt === undefined || Number.isFinite(item.submittedAt))
      && item.sentence.trim().length > 0 && validChannel(item.channel));
    if (parsed.some(item => isRecord(item) && 'delivered' in item)) writeStored(records);
    return records;
  } catch { return []; }
};
const writeStored = (items: StoredReminder[]): void => localStorage.setItem(STORAGE_KEY, JSON.stringify(items));

export class ReminderRuntime {
  private records: StoredReminder[] = readStored();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly retries = new Map<string, number>();
  private active = false;
  private disposed = false;
  private readonly desktopDeliver: (sentence: string, reminderId: string, speakText?: string) => Promise<void>;
  private readonly channelDeliveries = new Map<string, ReminderChannelDelivery>();
  private readonly onDelivered?: (record: ReminderRecord) => void;

  constructor(options: {
    desktopDeliver: (sentence: string, reminderId: string, speakText?: string) => Promise<void>;
    channelDeliver?: (record: StoredReminder) => boolean;
    onDelivered?: (record: ReminderRecord) => void;
  }) {
    this.desktopDeliver = options.desktopDeliver;
    this.onDelivered = options.onDelivered;
    if (options.channelDeliver) this.channelDeliveries.set('*', options.channelDeliver);
  }

  start(): void {
    if (this.disposed) return;
    void this.pump();
  }

  retryDue(): void {
    if (this.disposed) return;
    void this.pump();
  }

  registerChannel(channelId: string, deliver: ReminderChannelDelivery): () => void {
    if (!channelId.trim()) throw new Error('提醒渠道标识不能为空');
    this.channelDeliveries.set(channelId, deliver);
    for (const item of this.records) {
      if (item.channel.kind === 'channel' && item.channel.channelId === channelId && !item.submittedAt) this.retries.delete(item.id);
    }
    this.retryDue();
    return () => {
      if (this.channelDeliveries.get(channelId) === deliver) this.channelDeliveries.delete(channelId);
    };
  }

  add(dueAt: number, sentence: string, channel: ReminderChannel, speakText?: string, history?: ReminderRecord['history']): { id: string; dueAt: number; sentence: string } {
    if (!Number.isFinite(dueAt) || dueAt <= Date.now() || !sentence.trim()) throw new Error('提醒时间必须在未来，且成品句不能为空');
    const id = `reminder_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const storedChannel = channel.kind === 'desktop' ? channel : {
      kind: 'channel' as const, channelId: channel.channelId, source: channel.source, conversationId: channel.conversationId, requestId: channel.requestId,
    };
    this.records.push({ id, dueAt: Math.floor(dueAt), sentence: sentence.trim(), ...(speakText?.trim() ? { speakText: speakText.trim() } : {}), channel: storedChannel, history });
    writeStored(this.records);
    this.schedule();
    return { id, dueAt: Math.floor(dueAt), sentence: sentence.trim() };
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.disposed || this.active) return;
    if (this.timer !== null) clearTimeout(this.timer);
    const next = this.records.reduce((min, item) => Math.min(min, this.wakeAt(item)), Infinity);
    if (Number.isFinite(next)) this.timer = setTimeout(() => { this.timer = null; void this.pump(); }, Math.min(0x7fffffff, Math.max(0, next - Date.now())));
  }

  private wakeAt(item: ReminderRecord): number {
    if (item.submittedAt !== undefined) return Infinity;
    return Math.max(item.dueAt, this.retries.get(item.id) ?? 0);
  }

  confirmDelivery(reminderId: string, delivered: boolean, source: string): void {
    if (this.disposed) return;
    const item = this.records.find(record => record.id === reminderId);
    if (!item || item.submittedAt === undefined || item.channel.kind !== 'channel' || item.channel.source !== source) return;
    if (delivered) {
      this.complete(item);
      this.schedule();
      return;
    }
    delete item.submittedAt;
    this.retries.set(reminderId, Date.now() + 30_000);
    writeStored(this.records);
    this.schedule();
  }

  private complete(item: ReminderRecord): void {
    this.retries.delete(item.id);
    this.records = this.records.filter(record => record.id !== item.id);
    writeStored(this.records);
    this.onDelivered?.(item);
  }

  private async pump(): Promise<void> {
    if (this.active || this.disposed) return;
    this.active = true;
    try {
      const due = this.records.filter(item => this.wakeAt(item) <= Date.now()).sort((a, b) => a.dueAt - b.dueAt);
      for (const item of due) {
        if (this.disposed) break;
        let result: boolean | 'submitted' = false;
        try {
          if (item.channel.kind === 'desktop') {
            await this.desktopDeliver(item.sentence, item.id, item.speakText);
            result = true;
          } else {
            const deliver = this.channelDeliveries.get(item.channel.channelId) ?? this.channelDeliveries.get('*');
            result = deliver ? await deliver(item) : false;
          }
        } catch { /* A failed attempt remains eligible after the retry delay. */ }
        if (result === true) {
          this.complete(item);
        } else if (result === 'submitted') {
            item.submittedAt = Date.now();
            writeStored(this.records);
        } else {
          this.retries.set(item.id, Date.now() + 30_000);
        }
      }
    } finally {
      this.active = false;
      this.schedule();
    }
  }
}

export const reminderStorageKey = STORAGE_KEY;
