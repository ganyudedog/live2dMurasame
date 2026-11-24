import * as scenario from 'registered-case';
import { observed } from './observations';
let round = 0;
export default class OfflineModel {
  chat = {
    completions: {
      create: async () => {
        if (scenario.entry !== 'channel.turn') throw Error('Unexpected tool-model call');
        const call = scenario.doubles.modelCalls[round++];
        if (call === undefined) throw Error('Unexpected tool-model call');
        return {
          choices: [
            {
              message: {
                role: 'assistant',
                tool_calls: call
                  ? [
                      {
                        type: 'function',
                        id: `call-${round}`,
                        function: { name: call.name, arguments: JSON.stringify(call.args) },
                      },
                    ]
                  : [],
              },
            },
          ],
        };
      },
    },
  };
}
export async function requestStage2LLM(_config: unknown, request: { userText: string; toolContext: string }) {
  if (scenario.entry !== 'channel.turn') throw Error('Unexpected channel model call');
  observed.questions.push(request.userText);
  observed.toolContexts.push(request.toolContext);
  return { rawText: JSON.stringify({ display_text: scenario.doubles.reply }) };
}
export function requestStructuredLLM(): never {
  throw Error('Unexpected structured model call');
}
