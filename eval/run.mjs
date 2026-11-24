import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { findPackageJSON } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const manifest = findPackageJSON('promptfoo', import.meta.url);
const { bin } = JSON.parse(readFileSync(manifest, 'utf8'));
const cli = join(dirname(manifest), bin.promptfoo);

const dir = mkdtempSync(join(tmpdir(), 'project-promptfoo-'));
const benchmark = process.argv[2] === '--benchmark';
try {
  const result = spawnSync(
    process.execPath,
    [
      cli,
      'eval',
      '-c',
      benchmark ? 'eval/benchmark/promptfooconfig.ts' : 'eval/promptfooconfig.ts',
      '--no-cache',
      '--no-progress-bar',
      ...process.argv.slice(benchmark ? 3 : 2),
    ],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        PROMPTFOO_CONFIG_DIR: dir,
        PROMPTFOO_DISABLE_TELEMETRY: '1',
        PROMPTFOO_DISABLE_UPDATE: '1',
        PROMPTFOO_DISABLE_REMOTE_GENERATION: '1',
      },
    },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
