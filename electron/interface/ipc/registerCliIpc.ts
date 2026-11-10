import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron';
import type { CliService } from '../../modules/cli/service/CliService.js';
import type { CommandContext } from '../../modules/cli/service/commandTypes.js';

const scopeSchema = z.object({
  source: z.string().min(1).max(120),
  conversationId: z.string().min(1).max(200),
  senderId: z.string().max(120).optional(),
}).strict();

interface BoundSession {
  context: CommandContext;
  sender: WebContents;
}

export const registerCliIpc = ({ ipcMain, cli }: { ipcMain: IpcMain; cli: CliService }): (() => void) => {
  const sessions = new Map<string, BoundSession>();
  const watched = new Set<number>();
  const trusted = (event: IpcMainInvokeEvent): void => {
    const url = new URL(event.senderFrame?.url ?? 'about:blank');
    const dev = process.env.VITE_DEV_SERVER_URL;
    if (url.protocol !== 'app:' && (!dev || url.origin !== new URL(dev).origin)) throw new Error('Untrusted command caller');
  };
  const requireSession = (event: IpcMainInvokeEvent, id: unknown): BoundSession => {
    trusted(event);
    const session = typeof id === 'string' ? sessions.get(id) : undefined;
    if (!session || session.sender !== event.sender) throw new Error('Invalid command session');
    cli.authorize(session.context);
    return session;
  };
  ipcMain.handle('cli:open', (event, input: unknown) => {
    trusted(event);
    const scope = scopeSchema.parse(input);
    const local = scope.source === 'local';
    const context: CommandContext = {
      ...scope,
      local,
      owner: local ? 'local' : JSON.stringify([scope.source, scope.conversationId, scope.senderId ?? '']),
    };
    if (!cli.isAvailable(context)) return null;
    if ([...sessions.values()].filter((item) => item.sender === event.sender).length >= 256) throw new Error('Too many command sessions');
    const id = randomUUID();
    sessions.set(id, { context, sender: event.sender });
    if (!watched.has(event.sender.id)) {
      watched.add(event.sender.id);
      event.sender.once('destroyed', () => {
        watched.delete(event.sender.id);
        for (const [key, session] of sessions) if (session.sender === event.sender) sessions.delete(key);
      });
    }
    return id;
  });
  ipcMain.handle('cli:invoke', (event, session: unknown, request: unknown) => cli.invoke(request, requireSession(event, session).context));
  ipcMain.handle('cli:tasks', (event, id: unknown) => cli.listTasks(requireSession(event, id).context.owner));
  ipcMain.handle('cli:claim', (event, id: unknown, requestId: unknown, text: unknown) => cli.claim(requireSession(event, id).context, requestId, text));
  ipcMain.handle('cli:finish', (event, id: unknown, requestId: unknown, result: unknown) => {
    cli.finish(requireSession(event, id).context, requestId, result);
  });
  ipcMain.handle('cli:close', (event, id: unknown) => {
    if (typeof id === 'string' && sessions.get(id)?.sender === event.sender) sessions.delete(id);
  });
  const off = cli.subscribeTasks((update, owner) => {
    for (const [id, session] of sessions) {
      try { cli.authorize(session.context); }
      catch { continue; }
      if (session.context.owner === owner && !session.sender.isDestroyed()) session.sender.send('cli:task', { session: id, ...update });
    }
  });
  return () => {
    off();
    sessions.clear();
    for (const channel of ['cli:open', 'cli:invoke', 'cli:tasks', 'cli:close', 'cli:claim', 'cli:finish']) ipcMain.removeHandler(channel);
  };
};
