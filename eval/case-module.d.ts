// The provider resolves this module to the single case being evaluated.
declare module 'registered-case' {
  type Command = { name: string; args: Record<string, unknown>; result: unknown };
  type Dialogue = { text: string; room: string };
  type Fixture =
    | { entry: 'cli.invoke'; input: Pick<Command, 'name' | 'args'>; doubles: { command: Command } }
    | {
        entry: 'channel.turn';
        input: Dialogue;
        doubles: {
          command?: Command;
          reply: string;
          send: boolean;
          modelCalls: ({ name: string; args: Record<string, unknown> } | null)[];
        };
      }
    | { entry: 'conversation.turn'; input: { text: string }; doubles: { reply: string } }
    | {
        entry: 'reminder.deliver';
        input: Dialogue & { afterMs: number };
        doubles: { send: boolean | 'submitted'; acknowledge: boolean };
      };
  const fixture: Fixture & {
    accept(result: import('./observations').Observations): void | boolean | Promise<void | boolean>;
  };
  export = fixture;
}
