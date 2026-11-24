import { OneBotConnection } from './OneBotConnection';
import { sendAction, type Segment } from './protocol';
import type { ConversationResponse, PluginLogger, PluginStorage } from './types';

export interface Delivery {
  id: string;
  conversationId: string;
  message: Segment[];
  parent?: ConversationResponse['trace'];
  reminder?: boolean;
  accepted?: boolean;
}

/** A successful echo is persisted before notifying the reminder host. All mutations share one writer. */
export class Outbox {
  private records = new Map<string, Delivery>();
  private writes = Promise.resolve();
  private attempted = new Set<string>();
  private closed = false;
  private readonly sending = new Map<string, Promise<void>>();
  private readonly storage: PluginStorage;
  private readonly logger: PluginLogger;
  private readonly connection: OneBotConnection;
  private readonly confirm: (id: string) => void;
  constructor(
    storage: PluginStorage,
    logger: PluginLogger,
    connection: OneBotConnection,
    confirm: (id: string) => void,
  ) {
    this.storage = storage;
    this.logger = logger;
    this.connection = connection;
    this.confirm = confirm;
  }

  async restore() {
    const saved = await this.storage.get<Delivery[]>('onebot.outbox', []);
    this.records = new Map((saved ?? []).map((record) => [record.id, record]));
  }
  private write(change: (records: Map<string, Delivery>) => void) {
    const write = this.writes.then(async () => {
      const next = new Map(this.records);
      change(next);
      await this.storage.set('onebot.outbox', [...next.values()]);
      this.records = next;
    });
    this.writes = write.catch(() => {});
    return write;
  }
  async enqueue(record: Delivery) {
    await this.write((records) => {
      if (!records.has(record.id)) records.set(record.id, record);
    });
    // Let the reminder runtime persist its submitted marker before a loopback echo can arrive.
    if (record.reminder) setTimeout(() => this.send(record.id), 0);
    else this.send(record.id);
  }
  connected() {
    this.attempted = new Set();
    for (const id of this.records.keys()) this.send(id);
  }
  async dispose() {
    this.closed = true;
    await Promise.allSettled(this.sending.values());
    await this.writes;
  }
  private send(id: string) {
    const record = this.records.get(id);
    if (this.closed || !this.connection.ready || !record || this.attempted.has(id) || this.sending.has(id))
      return;
    this.attempted.add(id);
    const generation = this.attempted;
    const delivery = this.deliver(record)
      .catch(() => this.logger.error('outbox.persist.failed'))
      .finally(() => {
        this.sending.delete(id);
        if (!this.records.has(id)) this.attempted.delete(id);
        else if (generation !== this.attempted) this.send(id);
      });
    this.sending.set(id, delivery);
  }
  private async deliver(record: Delivery) {
    if (!record.accepted) {
      const { action, params } = sendAction(record.conversationId, record.message);
      const finish = this.logger.beginDelivery?.(action, record.parent);
      const receipt = await this.connection.request(action, params);
      finish?.(receipt.ok);
      if (!receipt.ok) return;
      if (record.reminder)
        await this.write((records) => records.set(record.id, { ...record, accepted: true }));
    }
    if (record.reminder) {
      if (this.closed) return;
      this.confirm(record.id);
    }
    await this.write((records) => records.delete(record.id));
  }
}
