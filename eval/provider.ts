import { build } from 'esbuild';
import { Worker } from 'node:worker_threads';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';

export default class ProjectProvider {
  id() {
    return 'in-process-project';
  }
  async callApi(name: string) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) return { error: 'Invalid case filename' };
    const dir = await mkdtemp(join(tmpdir(), 'project-eval-'));
    let worker: Worker | undefined;
    let timeout: NodeJS.Timeout | undefined;
    try {
      const { outputFiles, metafile } = await build({
        entryPoints: ['eval/worker.ts'],
        bundle: true,
        write: false,
        metafile: true,
        sourcemap: 'inline',
        platform: 'node',
        format: 'cjs',
        tsconfig: 'tsconfig.app.json',
        alias: {
          'registered-case': resolve('eval/cases', `${name}.ts`),
          openai: resolve('eval/model.ts'),
          '@app/modules/ai/modules/llm/infrastructure/llmClient': resolve('eval/model.ts'),
        },
        external: ['mobx', 'zod'],
      });
      for (const path of Object.keys(metafile.inputs)) {
        if (relative('plugins', path).split(/[\\/]/)[0] !== '..')
          throw Error(`Production plugin import in evaluation: ${path}`);
      }
      worker = new Worker(outputFiles[0].text, {
        eval: true,
        workerData: { dir },
        env: { NODE_ENV: 'test' },
      });
      const output = await new Promise<unknown>((ok, fail) => {
        timeout = setTimeout(() => fail(Error(`${name}: case timed out`)), 10000);
        worker!.once('error', fail);
        worker!.once('exit', (code) => fail(Error(`Premature exit ${code}`)));
        worker!.once('message', (result) => (result.error ? fail(Error(result.error)) : ok(result.output)));
      });
      return { output };
    } catch (error) {
      return { error: String(error) };
    } finally {
      clearTimeout(timeout);
      await worker?.terminate();
      await rm(dir, { recursive: true, force: true });
    }
  }
}
