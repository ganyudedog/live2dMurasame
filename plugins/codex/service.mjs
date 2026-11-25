import { imageStats, redactImageData } from '../../shared/ai/turnImages.js';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';

const bounded = (value, limit = 1024) => redactImageData(String(value ?? '')).slice(0, limit);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, no) => { resolve = ok; reject = no; });
  return { promise, resolve, reject };
};
const directory = input => {
  if (typeof input !== 'string' || !path.isAbsolute(input)) throw new Error('An absolute working directory is required');
  const cwd = realpathSync.native(input);
  if (!statSync(cwd).isDirectory()) throw new Error('Working directory is not a directory');
  return cwd;
};
function requireTrustedDirectory(dirs, cwd) {
  if (!dirs.includes(cwd)) throw new Error(`CODEX_CWD_NOT_TRUSTED: Codex 插件未信任工作目录 ${JSON.stringify(cwd)}。仅在用户明确同意后，用 codex.task 的 action="trust" 登记同一 cwd。shellReadRoots 不参与此判断。`);
}

function codexExecutable() {
  const os = { win32: 'pc-windows-msvc', linux: 'unknown-linux-musl', darwin: 'apple-darwin' }[process.platform];
  const arch = { x64: 'x86_64', arm64: 'aarch64' }[process.arch];
  if (!os || !arch) throw new Error(`Unsupported Codex platform: ${process.platform}/${process.arch}`);
  try {
    // pnpm installs the native platform package as a dependency of the CLI, not of this plugin.
    const cli = createRequire(import.meta.url).resolve('@openai/codex/package.json');
    const native = createRequire(cli).resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`);
    const binary = path.join(path.dirname(native), 'vendor', `${arch}-${os}`, 'bin', process.platform === 'win32' ? 'codex.exe' : 'codex');
    if (!statSync(binary).isFile()) throw new Error('Not an executable file');
    return binary;
  } catch (cause) {
    throw new Error(`Codex plugin CLI missing for ${process.platform}/${process.arch}; run pnpm install with optional dependencies enabled.`, { cause });
  }
}

// One stdio transport per active task isolates approval requests and process failures.
export function openServer(cwd, onMessage, onClose) {
  const child = spawn(codexExecutable(), ['app-server'], { cwd, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const pending = new Map();
  let next = 0, closed = false;
  const lines = createInterface({ input: child.stdout });
  function close(reason = new Error('Codex app-server stopped')) {
    if (closed) return;
    closed = true;
    lines.close();
    child.kill();
    for (const call of pending.values()) call.reject(reason);
    pending.clear();
    onClose(reason);
  }
  child.once('error', close);
  child.once('exit', (code, signal) => close(new Error(`Codex disconnected (${signal ?? code})`)));
  child.stdin.on('error', close);
  lines.on('line', line => {
    try {
      const msg = JSON.parse(line);
      if (msg.method) return onMessage(msg);
      const call = pending.get(msg.id);
      if (!call) return;
      pending.delete(msg.id);
      if (msg.error) call.reject(Object.assign(new Error(bounded(msg.error.message)), { code: msg.error.code }));
      else call.resolve(msg.result);
    } catch (error) { close(error); }
  });
  function send(msg) {
    if (closed) throw new Error('Codex disconnected');
    child.stdin.write(`${JSON.stringify(msg)}\n`);
  }
  return { send, close, request(method, params) {
    const id = ++next, call = deferred();
    send({ method, id, params });
    pending.set(id, call);
    return call.promise;
  } };
}

const instructions = '每次用 cwd 指定绝对工作目录。Codex 插件自行保存受信目录，与 shell.run 的 shellReadRoots 无关。收到 CODEX_CWD_NOT_TRUSTED 时，向用户确认是否信任该目录，不要查询或修改 shellReadRoots。只有用户明确要求时才 trust 或 newTask。收到 needs_approval 时结束工具循环，向用户说明操作，等待下一轮明确答复，再传 approvalId 和 decision。不得自行批准。';
const parameters = { type: 'object', additionalProperties: false, required: ['cwd'], properties: {
  images: { type: 'array', items: { type: 'string' }, maxItems: 4 },
  cwd: { type: 'string', description: '本次调用的绝对工作目录；trust 只登记这个目录。' }, task: { type: 'string' }, newTask: { type: 'boolean' },
  action: { type: 'string', enum: ['run', 'trust', 'untrust', 'answer'] }, approvalId: { type: 'string' }, decision: { type: 'string', enum: ['accept', 'decline'] },
} };

export function createService(connect = openServer, sleep = delay) {
  const queue = [], active = new Map();
  let stopped = false;
  const pump = () => {
    while (!stopped && active.size < 3) {
      const index = queue.findIndex(job => !active.has(job.scope));
      if (index < 0) break;
      const [job] = queue.splice(index, 1);
      active.set(job.scope, job);
      void run(job).then(value => job.reply.resolve(value), error => job.reply.reject(error)).finally(() => {
        active.delete(job.scope);
        pump();
      });
    }
  };
  const facts = (job, status, final = '') => ({ status, completed: status === 'completed', actions: [...job.actions], paths: [...job.paths], final: bounded(final, 3000) });
  function attempt(job) {
    const end = deferred();
    let finished = false;
    function finish(result, error) {
      if (finished) return;
      finished = true;
      job.approval = null;
      if (error) end.reject(error); else end.resolve(result);
    }
    const server = connect(job.cwd, msg => {
      if (finished) return;
      const { id, method, params = {} } = msg;
      if (id !== undefined) {
        if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method)) {
          if (job.approval) return finish(null, new Error('Overlapping approval requests'));
          const token = randomUUID();
          job.approval = { id, token, requestId: job.requestId };
          job.traceLink = job.span?.context();
          job.span?.event('approval.requested');
          job.reply.resolve({ ...facts(job, 'needs_approval'), approvalId: token, operation: bounded(params.command || job.currentOperation || method), reason: bounded(params.reason) });
        } else server.send({ id, error: { code: -32601, message: 'Unsupported server request' } });
      } else if (method === 'item/started' || method === 'item/completed') {
        const item = params.item ?? {};
        if (item.type === 'commandExecution' || item.type === 'fileChange') {
          job.startedWork = true;
          job.currentOperation = bounded(item.command || item.changes?.map(c => c.path).join(', '));
          if (method === 'item/completed' && job.actions.size < 16) job.actions.add(bounded(job.currentOperation, 200));
          for (const c of [...(item.changes ?? []), ...(item.commandActions ?? [])]) if (c.path && job.paths.size < 24) job.paths.add(bounded(c.path, 260));
        } else if (item.type === 'agentMessage' && method === 'item/completed') job.final = bounded(redactImageData(String(item.text ?? ''), job.images), 3000);
      } else if (method === 'turn/completed') {
        const turn = params.turn;
        if (turn?.status === 'completed') finish(facts(job, 'completed', job.final));
        else finish(null, Object.assign(new Error(bounded(turn?.error?.message || turn?.status || 'Turn failed')), { rateLimited: Object.values(turn?.error?.codexErrorInfo ?? {}).some(info => info?.httpStatusCode === 429) }));
      }
    }, error => finish(null, error));
    job.server = server;
    void (async () => {
      await server.request('initialize', { clientInfo: { name: 'live2d_codex', version: '1.0' } });
      server.send({ method: 'initialized' });
      const threadId = job.newTask ? null : job.storage.get(job.scope);
      const settings = { cwd: job.cwd, approvalPolicy: 'on-request', sandbox: 'danger-full-access' };
      const result = await server.request(threadId ? 'thread/resume' : 'thread/start', threadId ? { ...settings, threadId } : settings);
      if (finished) return;
      job.storage.set(job.scope, result.thread.id);
      job.newTask = false;
      const input = [{ type: 'text', text: job.task }, ...job.images.map(url => ({ type: 'image', url }))];
      await server.request('turn/start', { threadId: result.thread.id, input });
    })().catch(error => finish(null, error));
    return end.promise.finally(() => { server.close(); job.server = null; });
  }
  async function run(job) {
    for (let i = 0; ; i++) {
      if (stopped) throw new Error('Plugin stopped');
      requireTrustedDirectory(job.storage.get('directories') ?? [], directory(job.cwd));
      try { return await attempt(job); }
      catch (error) {
        if (i >= 2 || stopped || job.startedWork || !(error.rateLimited || error.code === 429 || /\b429\b/.test(error.message))) throw error;
        job.span?.event('retry.scheduled', { attempt: i + 1 });
        await sleep(500 * (2 ** i));
      }
    }
  }
  function execute(args, context, invocationId, { storage }) {
    if (stopped) throw new Error('Plugin stopped');
    imageStats(args.images);
    const cwd = directory(args.cwd), action = args.action ?? 'run';
    const dirs = storage.get('directories') ?? [];
    if (action === 'trust' || action === 'untrust') {
      storage.set('directories', action === 'trust' ? [...new Set([...dirs, cwd])] : dirs.filter(d => d !== cwd));
      return { completed: true, actions: [action], paths: [cwd], final: `${action}: ${cwd}` };
    }
    const scope = 'thread.' + createHash('sha256').update(JSON.stringify([context.source, context.conversationId, context.senderId ?? ''])).digest('hex');
    const requestId = context.requestId ?? invocationId;
    const observed = context.observability;
    const runObserved = (span) => {
      if (action === 'answer') {
        const job = active.get(scope), approval = job?.approval;
        if (!approval || approval.token !== args.approvalId || job.cwd !== cwd || !['accept', 'decline'].includes(args.decision) || requestId === approval.requestId) throw new Error('No matching approval from a previous turn');
        const continueAnswer = () => {
          job.reply = deferred(); job.approval = null; job.requestId = requestId;
          job.server.send({ id: approval.id, result: { decision: args.decision } });
          return job.reply.promise;
        };
        return span?.withSpan ? span.withSpan('approval.continue', { links: job.traceLink ? [job.traceLink] : [], attributes: { taskId: scope } }, () => continueAnswer()) : continueAnswer();
      }
      if (action !== 'run' || typeof args.task !== 'string' || !args.task.trim() || args.task.length > 32000) throw new Error('A non-empty task of at most 32000 characters is required');
      requireTrustedDirectory(dirs, cwd);
      if (active.get(scope)?.approval) throw new Error('Answer the pending approval first');
      const start = (attempt) => {
        const reply = deferred();
        queue.push({ reply, scope, storage, requestId, cwd, task: args.task, images: args.images ?? [], newTask: args.newTask, actions: new Set(), paths: new Set(), final: '', span: attempt });
        pump();
        return reply.promise;
      };
      return span?.withSpan ? span.withSpan('executor.attempt', { attributes: { taskId: scope } }, start) : start();
    };
    if (!observed?.withSpan) return runObserved();
    return observed.withSpan('codex.task', { attributes: { taskId: scope } }, runObserved);
  }
  return { execute, dispose() {
    stopped = true;
    for (const job of queue.splice(0)) job.reply.reject(new Error('Plugin stopped'));
    for (const job of active.values()) job.server?.close();
  } };
}

let service;
export function activate() { service ??= createService(); process.once('exit', dispose); }
export function dispose() { process.off('exit', dispose); service?.dispose(); service = undefined; }
export const commands = [{ name: 'codex.task', skill: 'codex', description: 'Run or resume a local Codex task; return facts to the calling turn.', instructions, parameters,
  journalExcludedArgs: ['images'], turnImageArgument: 'images',
  execute: (...args) => { if (!service) throw new Error('Plugin not active'); return service.execute(...args); } }];
