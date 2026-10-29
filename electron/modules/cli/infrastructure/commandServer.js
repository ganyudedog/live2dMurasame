import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** Loopback transport only. Tunnels and platform protocols belong to plugins. */
export const startCommandServer = async ({ runtime, directory }) => {
  const token = randomBytes(32).toString('hex');
  const context = { owner: 'local', local: true, source: 'local-cli', conversationId: 'desktop' };
  const clients = new Set();
  const json = (response, status, value) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
  const server = http.createServer(async (request, response) => {
    const bearer = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const providedToken = Buffer.from(bearer);
    const expectedToken = Buffer.from(token);
    if (request.headers.origin || providedToken.length !== expectedToken.length || !timingSafeEqual(providedToken, expectedToken)) {
      json(response, 401, { error: 'Unauthorized' }); return;
    }
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/events') {
        if (clients.size >= 32) { json(response, 429, { error: 'Too many subscribers' }); return; }
        response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        clients.add(response);
        // Full snapshot on every connection; merge by per-task sequence after reconnect.
        response.write(`event: snapshot\ndata: ${JSON.stringify(runtime.tasks.list(context.owner))}\n\n`);
        const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
        request.on('close', () => { clearInterval(heartbeat); clients.delete(response); });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/tasks') { json(response, 200, runtime.tasks.list(context.owner)); return; }
      if (request.method === 'GET' && url.pathname.startsWith('/tasks/')) {
        json(response, 200, runtime.tasks.view(runtime.tasks.require(decodeURIComponent(url.pathname.slice(7)), context.owner))); return;
      }
      if (request.method !== 'POST' || url.pathname !== '/commands') { json(response, 404, { error: 'Not found' }); return; }
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 65536) { json(response, 413, { error: 'Payload too large' }); return; }
        chunks.push(chunk);
      }
      const result = await runtime.cli.invoke(JSON.parse(Buffer.concat(chunks).toString('utf8')), context);
      json(response, 200, result);
    } catch (error) { if (!response.headersSent) json(response, 400, { error: String(error?.message ?? error) }); }
  });
  server.requestTimeout = 15000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const off = runtime.tasks.subscribe((event, owner) => {
    if (owner !== context.owner) return;
    for (const client of clients) {
      if (client.writableLength > 262144) { client.destroy(); continue; }
      client.write(`id: ${event.task.id}:${event.sequence}\nevent: task\ndata: ${JSON.stringify(event)}\n\n`);
    }
  });
  const connection = { url: `http://127.0.0.1:${server.address().port}`, token };
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'connection.json');
  try { fs.writeFileSync(file, JSON.stringify(connection), { mode: 0o600 }); }
  catch (error) { off(); server.close(); throw error; }
  return {
    connection,
    async close() {
      off(); for (const client of clients) client.destroy();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(file, { force: true });
    },
  };
};
