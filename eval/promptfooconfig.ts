import type { Observations } from './observations';

export default {
  prompts: ['{{caseName}}'],
  providers: ['file://./provider.ts'],
  tests: ['conversation', 'channel', 'cli', 'reminder'].map((caseName) => ({
    description: caseName,
    vars: { caseName },
    assert: [
      {
        type: 'javascript',
        value: (raw: string | (Observations & { acceptance: string | null })) => {
          const output = typeof raw === 'string' ? JSON.parse(raw) : raw;
          return {
            pass: output.acceptance === null,
            score: output.acceptance === null ? 1 : 0,
            reason: `cases/${caseName}.ts accept(): ${output.acceptance ?? 'passed'}`,
          };
        },
      },
    ],
  })),
};
