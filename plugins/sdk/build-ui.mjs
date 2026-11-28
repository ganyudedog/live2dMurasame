#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const hostModules = { react: 'React', 'react/jsx-runtime': 'jsxRuntime', 'react-dom': 'ReactDOM' };
const hostReact = {
  name: 'host-react',
  setup(builder) {
    builder.onResolve({ filter: /^(?:react(?:\/jsx-runtime)?|react-dom)$/ }, ({ path }) => ({ path, namespace: 'host-react' }));
    builder.onLoad({ filter: /.*/, namespace: 'host-react' }, ({ path }) => ({
      contents: `module.exports = globalThis.live2dPluginReact.${hostModules[path]}`,
    }));
  },
};

export async function buildPluginUi(entry, outfile) {
  await build({
    entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'browser',
    target: 'es2022', jsx: 'automatic', minify: true,
    plugins: [hostReact, {
      name: 'runtime-sdk',
      setup(builder) {
        builder.onResolve({ filter: /^@live2d\/plugin-sdk$/ }, () => ({
          path: 'plugin://runtime/live2d.sdk/index.js', external: true,
        }));
      },
    }],
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , entry, outfile = 'index.js'] = process.argv;
  if (!entry) throw new Error('Usage: live2d-build-ui <entry.tsx> [index.js]');
  await buildPluginUi(entry, outfile);
}
