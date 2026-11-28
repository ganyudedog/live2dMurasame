import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = path.join(root, 'release', 'client');
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'live2d-client-'));
const run = (args, cwd) => execFileSync('pnpm', args, { cwd, stdio: 'inherit', shell: true });

const copyRuntime = (from, to) => {
  fs.cpSync(from, to, {
    recursive: true,
    filter: (source) => path.extname(source) !== '.map' && path.basename(source) !== '.npmrc',
  });
};

const source = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const unpacked = path.join(output, 'win-unpacked');
const archive = path.join(output, `Murasame-${source.version}-win-x64.zip`);

try {
  run(['build'], root);
  fs.rmSync(output, { recursive: true, force: true });
  fs.rmSync(path.join(root, 'release', 'app'), { recursive: true, force: true });
  for (const name of ['dist', 'dist-electron', 'shared']) copyRuntime(path.join(root, name), path.join(stage, name));
  fs.writeFileSync(path.join(stage, '.npmrc'), 'ignore-workspace=true\nnode-linker=hoisted\n');
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: source.name,
    version: source.version,
    private: true,
    description: source.description,
    type: 'module',
    main: 'dist-electron/main.js',
    dependencies: {
      koffi: source.dependencies.koffi,
      zod: source.dependencies.zod,
    },
  }, null, 2));
  run(['install', '--prod', '--ignore-workspace'], stage);

  const electronDist = path.join(root, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) throw new Error('Electron 运行时尚未安装');
  fs.cpSync(electronDist, unpacked, { recursive: true });
  fs.renameSync(path.join(unpacked, 'electron.exe'), path.join(unpacked, 'Murasame.exe'));
  const appDir = path.join(unpacked, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });
  for (const name of ['dist', 'dist-electron', 'shared', 'node_modules', 'package.json']) {
    copyRuntime(path.join(stage, name), path.join(appDir, name));
  }
  // Electron can abort before main.js when the build directory inherits a Low integrity label.
  execFileSync('icacls.exe', [unpacked, '/setintegritylevel', '(OI)(CI)M', '/T', '/Q'], { stdio: 'pipe' });
  execFileSync('tar.exe', ['-a', '-cf', archive, '-C', unpacked, '.'], { stdio: 'inherit' });
  console.log(`Client written to ${unpacked}`);
  console.log(`Archive written to ${archive}`);
} finally {
  fs.rmSync(stage, { recursive: true, force: true });
}
