import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CommandScope } from '../../../../shared/cli/contracts.js';
import { boundConversationStorage, canCompactTurn, conversationView, limitText, rememberIdentifiers, type ToolConversation, type ToolOperation } from '../domain/toolConversation.js';

export interface ToolConversationRepository {
  read(key: string): ToolConversation;
  write(key: string, state: ToolConversation): void;
}
/** Scope is supplied by the bound backend session, never by a model/tool argument. */
export class ToolConversationService {
  private readonly repository: ToolConversationRepository;
  constructor(repository: ToolConversationRepository) { this.repository = repository; }
  private key(scope: CommandScope): string {
    return createHash('sha256').update(JSON.stringify([scope.source, scope.conversationId, scope.senderId ?? ''])).digest('hex');
  }
  private change(scope: CommandScope, update: (state: ToolConversation) => void) {
    const key = this.key(scope);
    const state = this.repository.read(key);
    update(state);
    state.revision++;
    boundConversationStorage(state);
    this.repository.write(key, state);
    return state;
  }
  claim(scope: CommandScope, requestId: string, text: string) {
    const state = this.change(scope, (data) => {
      if (!data.turns.some((turn) => turn.requestId === requestId)) {
        data.turns.push({ requestId, userText: limitText(text, 6000), loopStatus: 'running', operations: [] });
      }
    });
    return conversationView(state, requestId);
  }
  operation(scope: CommandScope, requestId: string, operation: ToolOperation, identifiers?: unknown): void {
    this.change(scope, (state) => {
      const turn = state.turns.find((item) => item.requestId === requestId);
      if (!turn) return; // Direct CLI calls do not invent conversational turns.
      const index = turn.operations.findIndex((item) => item.invocationId === operation.invocationId);
      if (index < 0) turn.operations.push(operation); else turn.operations[index] = operation;
      rememberIdentifiers(state, identifiers);
    });
  }
  finish(scope: CommandScope, requestId: string, error?: string): void {
    this.change(scope, (state) => {
      const turn = state.turns.find((item) => item.requestId === requestId);
      if (turn) {
        turn.loopStatus = error === undefined ? 'completed' : 'failed';
        turn.loopError = error === undefined ? undefined : limitText(error, 2000);
      }
    });
  }
  reply(scope: CommandScope, requestId: unknown, text: unknown): void {
    const id = z.string().max(200).parse(requestId);
    const assistantText = z.string().max(50000).parse(text);
    this.change(scope, (state) => {
      const turn = state.turns.find((item) => item.requestId === id);
      if (!turn) throw new Error('Unknown conversation request');
      turn.assistantText = limitText(assistantText, 6000);
    });
  }
  compact(scope: CommandScope, input: unknown): boolean {
    const data = z.object({ revision: z.number().int().nonnegative(), throughRequestId: z.string().max(200),
      text: z.string().max(50000), summary: z.string().min(1).max(6000) }).strict().parse(input);
    const key = this.key(scope);
    const state = this.repository.read(key);
    const end = state.turns.findIndex((turn) => turn.requestId === data.throughRequestId);
    if (state.revision !== data.revision || end < 0 || end >= state.turns.length - 2
      || state.turns.slice(0, end + 1).some((turn) => !canCompactTurn(turn))) return false;
    state.summary = limitText(data.summary, 4096);
    state.turns = state.turns.slice(end + 1);
    state.revision++;
    this.repository.write(key, state);
    return true;
  }
}
