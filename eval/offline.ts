import net from 'node:net';
import dgram from 'node:dgram';
import childProcess from 'node:child_process';

// Installed only inside the case worker, before any project or case modules load.
const attempts: string[] = [];
function deny(operation: string) {
  return () => {
    attempts.push(operation);
    throw Error(`Offline evaluation attempted ${operation}`);
  };
}
globalThis.fetch = deny('fetch');
net.Socket.prototype.connect = deny('socket connection');
dgram.Socket.prototype.send = deny('UDP send');
for (const method of [
  'spawn',
  'spawnSync',
  'exec',
  'execSync',
  'execFile',
  'execFileSync',
  'fork',
] as const) {
  Object.defineProperty(childProcess, method, { value: deny(method) });
}
export function checkOffline() {
  if (attempts.length) throw Error(`Unexpected external calls: ${attempts.join(', ')}`);
}
