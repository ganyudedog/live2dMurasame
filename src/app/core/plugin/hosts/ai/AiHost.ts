import type { AiHostApi, ConversationChannel, ConversationChannelOptions } from '../../types';
import { ConversationScheduler, type PluginConversationExecutor } from './ConversationScheduler';

/** Single AI capability: conversations and the model catalog. */
export class AiHost implements AiHostApi {
  private readonly conversations: ConversationScheduler;
  private readonly readModels: AiHostApi['getModels'];
  private readonly listen: AiHostApi['subscribe'];

  constructor(
    execute: PluginConversationExecutor,
    readModels: AiHostApi['getModels'],
    listen: AiHostApi['subscribe'],
  ) {
    this.conversations = new ConversationScheduler(execute);
    this.readModels = readModels;
    this.listen = listen;
  }

  openChannel(options: ConversationChannelOptions): ConversationChannel {
    return this.conversations.openChannel(options);
  }

  getModels(): ReturnType<AiHostApi['getModels']> {
    return this.readModels();
  }

  subscribe(listener: () => void): ReturnType<AiHostApi['subscribe']> {
    return this.listen(listener);
  }

  dispose(): void {
    this.conversations.dispose();
  }
}
