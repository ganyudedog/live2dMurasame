import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { BootstrapContext } from '@app/core/bootstrapContext';
import { LogService } from '@app/shared/logging/LogService';
import type { CommandSession } from '../shared/cli/contracts';
import { CallStore } from '../electron/modules/cli/infrastructure/CallStore';
import { CliService } from '../electron/modules/cli/service/CliService';
import type { CommandContext } from '../electron/modules/cli/service/commandTypes';
import { BackendLogService } from '../electron/modules/logging/BackendLogService';
import { runSkillLoop, type SkillLoopOptions } from '../src/app/modules/ai/modules/llm/application/skillLoop';

const roots: string[] = [];
afterEach(() => { roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })); });

const call = (name: string, args: unknown) => ({
  content: null,
  tool_calls: [{ id: `tool-${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }],
});

describe('cli.invoke', () => {
  it('joins the renderer trace and the command log by the same traceId and boundary', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'live2d-boundary-cli-'));
    roots.push(root);
    const log = new LogService({ windowKind: 'pet', startedAt: 0, configSnapshot: null } satisfies BootstrapContext);
    const backend = new BackendLogService();
    const recorded: Array<{ traceId: string; boundary: string; event: string; scope: string }> = [];
    backend.onLineage = (entry) => { recorded.push(entry); };
    const cli = new CliService(new CallStore(path.join(root, 'calls.json')), undefined, undefined, backend);
    cli.register('jobs.run', {
      skill: 'development',
      description: 'Run a job',
      schema: z.object({ text: z.string() }).strict(),
      execute: () => ({ ok: true }),
    });
    const context: CommandContext = { owner: 'local', local: true, source: 'local', conversationId: 'desktop' };
    const session: CommandSession = {
      claim: vi.fn(async () => ({})),
      finish: vi.fn(async () => {}),
      reply: vi.fn(async () => {}),
      compact: vi.fn(async () => true),
      close: vi.fn(async () => {}),
      invoke: (request) => cli.invoke(request, context),
    };
    let round = 0;
    const complete: NonNullable<SkillLoopOptions['complete']> = async () => {
      round += 1;
      if (round === 1) return call('loadSkill', { name: 'development' });
      if (round === 2) return call('jobs_run', { text: 'hi' });
      return { content: 'done' };
    };

    const result = await runSkillLoop({ config: {}, text: '跑一下', requestId: 'job-1', session, log, complete });

    const traces = log.readBoundary('cli.invoke');
    expect(result.context).toContain('jobs.run');
    expect(traces.map((trace) => trace.status)).toEqual(['completed']);
    expect(recorded).toEqual([{
      traceId: traces[0]?.traceId,
      boundary: 'cli.invoke',
      event: 'cli.execute',
      scope: 'backend',
    }]);
  });
});
