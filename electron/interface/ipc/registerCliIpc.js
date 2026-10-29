import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const scopeSchema = z.object({ source: z.string().min(1).max(120), conversationId: z.string().min(1).max(200), senderId: z.string().max(120).optional() }).strict();
export const registerCliIpc = ({ ipcMain, runtime }) => {
  const sessions = new Map();
  const watched = new Set();
  const trusted = (event) => {
    const url = new URL(event.senderFrame?.url ?? 'about:blank');
    const dev = process.env.VITE_DEV_SERVER_URL;
    if (url.protocol !== 'app:' && (!dev || url.origin !== new URL(dev).origin)) throw new Error('Untrusted command caller');
  };
  const requireSession = (event, id) => {
    trusted(event);
    const session = sessions.get(id);
    if (!session || session.sender !== event.sender) throw new Error('Invalid command session');
    runtime.cli.authorize(session.context);
    return session;
  };
  ipcMain.handle('cli:open', (event, input) => {
    trusted(event);
    const scope = scopeSchema.parse(input);
    const local = scope.source === 'local';
    const context = { ...scope, local, owner: local ? 'local' : JSON.stringify([scope.source, scope.conversationId, scope.senderId ?? '']) };
    runtime.cli.authorize(context);
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
  ipcMain.handle('cli:invoke', (event, session, request) => runtime.cli.invoke(request, requireSession(event, session).context));
  ipcMain.handle('cli:tasks', (event, id) => runtime.tasks.list(requireSession(event, id).context.owner));
  ipcMain.handle('cli:claim', (event, id, requestId, text) => runtime.cli.claim(requireSession(event, id).context, requestId, text));
  ipcMain.handle('cli:finish', (event, id, requestId, result) => runtime.cli.finish(requireSession(event, id).context, requestId, result));
  ipcMain.handle('cli:close', (event, id) => { if (sessions.get(id)?.sender === event.sender) sessions.delete(id); });
  const off = runtime.tasks.subscribe((update, owner) => {
    for (const [id, session] of sessions) {
      try { runtime.cli.authorize(session.context); } catch { continue; }
      if (session.context.owner === owner && !session.sender.isDestroyed()) session.sender.send('cli:task', { session: id, ...update });
    }
  });
  return () => { off(); sessions.clear(); for (const channel of ['cli:open', 'cli:invoke', 'cli:tasks', 'cli:close', 'cli:claim', 'cli:finish']) ipcMain.removeHandler(channel); };
};
