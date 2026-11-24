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
