import OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions';
export interface Sample {
  source: { traceId: string; spanId: string };
  question: string;
  toolContext: string;
  reference: string;
  request: {
    model: string;
    messages: { role: string; content: string }[];
    temperature?: number;
    reasoning_effort?: string;
    prompt_cache_key?: string;
    response_format?: Record<string, unknown>;
  };
}
export interface Replay extends Pick<Sample, 'source' | 'question' | 'toolContext' | 'reference'> {
  reply: string;
  model: string;
}
export default class ModelProvider {
  id() {
    return 'trace-model-replay';
  }
  async callApi(_prompt: string, context: { vars: { sample: Sample } }) {
    const { request, question, toolContext, reference, source } = context.vars.sample;
    if (!process.env.BENCHMARK_API_KEY || !process.env.BENCHMARK_BASE_URL)
      throw Error('Set BENCHMARK_API_KEY and BENCHMARK_BASE_URL for the selected model');
    const client = new OpenAI({
      apiKey: process.env.BENCHMARK_API_KEY,
      baseURL: process.env.BENCHMARK_BASE_URL,
      maxRetries: 0,
      timeout: 60000,
    });
    const result = await client.chat.completions.create({
      ...request,
      model: process.env.BENCHMARK_MODEL || request.model,
      stream: false,
    } as ChatCompletionCreateParamsNonStreaming);
    const reply = result.choices[0]?.message.content;
    if (!reply?.trim()) throw Error('Model returned an empty reply');
    return {
      output: { source, question, toolContext, reference, reply, model: result.model } satisfies Replay,
    };
  }
}
