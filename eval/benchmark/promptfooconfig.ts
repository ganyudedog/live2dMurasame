import * as ticket from './cases/ticket';
import type { Replay, Sample } from './provider';
// Import reviewed case modules here. Drafts never enter this list automatically.
const cases: { sample: Sample; accept: (result: Replay) => void | boolean | Promise<void | boolean> }[] = [
  ticket,
];
if (!cases.length)
  throw Error('No reviewed model benchmarks registered in eval/benchmark/promptfooconfig.ts');
export default {
  prompts: ['Replay captured request'],
  providers: ['file://./provider.ts'],
  tests: cases.map(({ sample, accept }) => ({
    description: `${sample.source.traceId}/${sample.source.spanId}`,
    vars: { sample },
    assert: [
      {
        type: 'javascript',
        value: async (raw: string | Replay) => {
          const pass = (await accept(typeof raw === 'string' ? JSON.parse(raw) : raw)) !== false;
          return { pass, score: Number(pass), reason: 'model case accept()' };
        },
      },
    ],
  })),
};
