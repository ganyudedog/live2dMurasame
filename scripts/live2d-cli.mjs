import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// No shell evaluation. JSON preserves paths and multiline prompts unchanged.
const args = process.argv.slice(2);
const take = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name} value`);
  args.splice(index, 2); return value;
};
async function main() {
try {
  const connectionPath = take('--connection') ?? process.env.LIVE2D_CLI_CONNECTION;
  if (!connectionPath) throw new Error('Use --connection <Electron userData/cli/connection.json> or LIVE2D_CLI_CONNECTION');
  const connection = JSON.parse(fs.readFileSync(connectionPath, 'utf8'));
  const endpoint = new URL(connection.url);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1') throw new Error('Only the local Electron endpoint is supported');
  const payload = JSON.parse(take('--json') ?? '{}');
  const invocationId = take('--id') ?? randomUUID();
  const issuedAt = Number(take('--issued-at') ?? Date.now());
  const mapping = { '--workspace': 'workspaceId', '--prompt': 'prompt', '--task': 'taskId', '--provider': 'provider', '--scope': 'scope', '--revision': 'expectedRevision', '--model-path': 'modelPath' };
  for (const [flag, key] of Object.entries(mapping)) { const value = take(flag); if (value !== undefined) payload[key] = value; }
  if (args.some((arg) => arg.startsWith('--')) || args.length > 2 || !args.length) throw new Error('Usage: live2d <group> <operation> --json <object> [--id <retry-id>]');
  const command = args.join('.');
  const response = await fetch(new URL('/commands', endpoint), { method: 'POST', headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ invocationId, issuedAt, command, args: payload }) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Command failed');
  process.stdout.write(`${JSON.stringify({ invocationId, issuedAt, result }, null, 2)}\n`);
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
void main();
