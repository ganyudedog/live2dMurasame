import { checkOffline } from './offline';
import { workerData, parentPort } from 'node:worker_threads';
import { join } from 'node:path';
import { z } from 'zod';
import * as scenario from 'registered-case';
import { observed } from './observations';
import { CliService } from '../electron/modules/cli/service/CliService';
import { CallStore } from '../electron/modules/cli/infrastructure/CallStore';
import { AiService } from '../src/app/modules/ai/service/AiService';
import { createDefaultConversationExecutor } from '../src/app/modules/plugin/hosts/ai/createConversationExecutor';
import { ConversationScheduler } from '../src/app/modules/plugin/hosts/ai/ConversationScheduler';
import { ReminderRuntime, reminderStorageKey } from '../src/app/modules/ai/modules/reminders/ReminderRuntime';

const noop = () => {};
const log = {
  contextRegistry: {
    register: () => ({ dispose: noop, beginTrace: () => ({ record: noop, end: noop, fail: noop }) }),
  },
};
const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
};
Object.assign(globalThis, { localStorage: storage });
const cli = new CliService(new CallStore(join(workerData.dir, 'calls.json')), {
  read: () => ['plugin:sample'],
  write: noop,
});
const scope = {
  source: 'plugin:sample',
  senderId: 'sample-user',
  conversationId: 'room' in scenario.input ? scenario.input.room : 'sample',
  local: false,
  owner: 'sample',
};
const command = 'command' in scenario.doubles ? scenario.doubles.command : undefined;
if (command)
  cli.registerExternal('sample', command.name, {
    skill: 'sample',
    description: 'Look up a sample ticket',
    schema: z.record(z.string(), z.unknown()),
    execute: (args) => {
      observed.commands.push({ name: command.name, args });
      return command.result;
    },
  });
async function run() {
  switch (scenario.entry) {
    case 'cli.invoke': {
      const { input } = scenario;
      observed.result = await cli.invoke(
        { invocationId: 'sample-call', issuedAt: Date.now(), command: input.name, args: input.args },
        scope,
      );
      break;
    }
    case 'conversation.turn': {
      const { input, doubles } = scenario;
      const bus = {
        chatConfig: {},
        publishChatRequest: noop,
        publishChatResponse: (r: { displayText: string; status: string }) =>
          observed.responses.push({ text: r.displayText, status: r.status }),
      };
      const llm = {
        notePresenceInteraction: noop,
        ask: async (text: string) => {
          observed.questions.push(text);
          return { ok: true, reply: { display_text: doubles.reply } };
        },
      };
      const tts = { createDispatcher: () => ({ stop: noop, submit: noop, wait: noop, summary: () => ({}) }) };
      const ai = new AiService(bus as never, log as never, llm as never, tts as never, {} as never);
      await ai.processChatRequest({
        id: 'sample-turn',
        source: 'text',
        status: 'pending',
        createdAt: 1,
        text: input.text,
      });
      break;
    }
    case 'channel.turn': {
      const { input, doubles } = scenario;
      Object.assign(globalThis, {
        window: {
          localStorage: storage,
          CliAPI: {
            open: () => 'sample-session',
            close: async () => {},
            reply: async () => {},
            claim: (_id: string, request: string, text: string) => cli.claim(scope, request, text),
            finish: (_id: string, request: string, result: unknown) => cli.finish(scope, request, result),
            invoke: (_id: string, request: unknown) => cli.invoke(request, scope),
          },
        },
      });
      const execute = createDefaultConversationExecutor(
        { globalModelConfig: { apiKey: 'fixture', llmModels: [{ id: 'fixture', efforts: [] }] } } as never,
        log as never,
      );
      const scheduler = new ConversationScheduler(execute);
      const channel = scheduler.openChannel({
        source: scope.source,
        conversationId: 'default-room',
        interaction: { mode: 'queue' },
      });
      try {
        await new Promise<void>((resolve, reject) => {
          channel.onResponse((response) => {
            if (response.status === 'streaming') return;
            if (response.status !== 'done') {
              reject(Error(`Channel ${response.status}`));
              return;
            }
            observed.sent.push({ room: response.conversationId, text: response.text });
            if (doubles.send) resolve();
            else reject(Error('Channel sender rejected reply'));
          });
          const result = channel.sendText({
            conversationId: input.room,
            text: input.text,
            sender: { id: scope.senderId },
            isOwner: true,
          });
          if (!result.accepted) reject(Error(`Request rejected: ${result.reason}`));
        });
      } finally {
        scheduler.dispose();
      }
      break;
    }
    case 'reminder.deliver': {
      const { input, doubles } = scenario;
      const runtime = new ReminderRuntime({
        desktopDeliver: async () => {
          throw Error('Unexpected desktop delivery');
        },
      });
      try {
        let submitted!: () => void;
        const delivery = new Promise<void>((resolve) => {
          submitted = resolve;
        });
        runtime.registerChannel('sample', (record) => {
          if (record.channel.kind !== 'channel') throw Error('Unexpected channel');
          observed.sent.push({ room: record.channel.conversationId, text: record.sentence });
          submitted();
          return doubles.send;
        });
        const { id } = runtime.add(Date.now() + input.afterMs, input.text, {
          kind: 'channel',
          source: scope.source,
          channelId: 'sample',
          conversationId: input.room,
        });
        await delivery;
        await new Promise((resolve) => setImmediate(resolve));
        const pending = () =>
          JSON.parse(storage.getItem(reminderStorageKey) ?? '[]').some(
            (r: { id: string; submittedAt?: number }) => r.id === id && r.submittedAt !== undefined,
          );
        observed.pendingBeforeAck = pending();
        runtime.confirmDelivery(id, doubles.acknowledge, scope.source);
        observed.pendingAfterAck = JSON.parse(storage.getItem(reminderStorageKey) ?? '[]').some(
          (record: { id: string }) => record.id === id,
        );
      } finally {
        runtime.dispose();
      }
      break;
    }
    default:
      throw Error('Unsupported case entry');
  }
  checkOffline();
  let failure: string | undefined;
  try {
    if ((await scenario.accept(observed)) === false) throw Error('returned false');
  } catch (error) {
    failure = String(error);
  }
  checkOffline();
  return { ...observed, acceptance: failure ?? null };
}
run().then(
  (output) => parentPort!.postMessage({ output }),
  (error) => parentPort!.postMessage({ error: String(error.stack ?? error) }),
);
