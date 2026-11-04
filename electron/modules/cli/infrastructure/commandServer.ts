import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { CliService } from '../service/CliService.js';
import type { CommandContext } from '../service/commandTypes.js';

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Loopback transport only. Tunnels and platform protocols belong to plugins. */
export const startCommandServer = async ({ cli, directory }: { cli: CliService; directory: string }) => {
  const token = randomBytes(32).toString('hex');
  const context: CommandContext = { owner: 'local', local: true, source: 'local-cli', conversationId: 'desktop' };
  const clients = new Set<http.ServerResponse>();
  const json = (response: http.ServerResponse, status: number, value: unknown): void => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const server = http.createServer(async (request, response) => {
    const bearer = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const providedToken = Buffer.from(bearer);
    const expectedToken = Buffer.from(token);
    if (request.headers.origin || providedToken.length !== expectedToken.length || !timingSafeEqual(providedToken, expectedToken)) {
      json(response, 401, { error: 'Unauthorized' });
      return;
    }
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/events') {
        if (clients.size >= 32) { json(response, 429, { error: 'Too many subscribers' }); return; }
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        clients.add(response);
        response.write(`event: snapshot\ndata: ${JSON.stringify(cli.listTasks(context.owner))}\n\n`);
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
        request.on('close', () => { clearInterval(heartbeat); clients.delete(response); });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/tasks') { json(response, 200, cli.listTasks(context.owner)); return; }
      if (request.method === 'GET' && url.pathname.startsWith('/tasks/')) {
        json(response, 200, cli.getTask(decodeURIComponent(url.pathname.slice(7)), context.owner));
        return;
      }
      if (request.method !== 'POST' || url.pathname !== '/commands') { json(response, 404, { error: 'Not found' }); return; }
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 65536) { json(response, 413, { error: 'Payload too large' }); return; }
        chunks.push(buffer);
      }
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const result = await cli.invoke(body, context);
      json(response, 200, result);
    } catch (error: unknown) {
      if (!response.headersSent) json(response, 400, { error: errorMessage(error) });
    }
  });
  server.requestTimeout = 15000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const off = cli.subscribeTasks((event, owner) => {
    if (owner !== context.owner) return;
    for (const client of clients) {
      if (client.writableLength > 262144) { client.destroy(); continue; }
      client.write(`id: ${event.task.id}:${event.sequence}\nevent: task\ndata: ${JSON.stringify(event)}\n\n`);
    }
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Command server did not bind a TCP port');
  const connection = { url: `http://127.0.0.1:${address.port}`, token };
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'connection.json');
  try { fs.writeFileSync(file, JSON.stringify(connection), { mode: 0o600 }); }
  catch (error) {
    off();
    server.close();
    throw error;
  }
  return {
    connection,
    async close() {
      off();
      for (const client of clients) client.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => { server.close(() => resolve()); });
      fs.rmSync(file, { force: true });
    },
  };
};
