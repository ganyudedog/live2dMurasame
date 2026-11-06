/** Bounded memory of account + conversation + platform message id. Empty ids are not cacheable. */
export class MessageDedup {
  private readonly keys = new Map<string, true>();
  private readonly limit: number;

  constructor(limit = 256) { this.limit = limit; }

  /** Returns true when this delivery should generate a reply. */
  accept(key: string): boolean {
    if (!key) return true;
    if (this.keys.has(key)) return false;
    this.keys.set(key, true);
    while (this.keys.size > this.limit) this.keys.delete(this.keys.keys().next().value!);
    return true;
  }
}

export const dedupKey = (accountId: string, conversationId: string, messageId: string): string => {
  const message = messageId.trim();
  if (!message) return '';
  return `${accountId.trim()}\n${conversationId.trim()}\n${message}`;
};

/** Holds a backlog for one conversation without occupying another conversation's turn. */
export class ConversationLanes {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(conversationId: string, serial: boolean, task: () => Promise<T>): Promise<T> {
    if (!serial) return task();
    const previous = this.tails.get(conversationId) ?? Promise.resolve();
    let release!: () => void;
    const done = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => done, () => done);
    this.tails.set(conversationId, tail);
    return previous.catch(() => undefined).then(async () => {
      try { return await task(); }
      finally {
        release();
        queueMicrotask(() => { if (this.tails.get(conversationId) === tail) this.tails.delete(conversationId); });
      }
    });
  }
}
