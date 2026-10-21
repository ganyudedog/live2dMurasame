import OpenAI from 'openai';
import { normalizeEfforts } from '../../../../../../../shared/llmModels.js';

export interface RemoteModel {
  id: string;
  ownedBy: string;
  created: number;
  /** 网关直接给出的推理档位（扩展字段），没有则为空数组。 */
  efforts: PetReasoningEffort[];
  /** 网关声明该模型接受推理参数，但没给具体档位，需要探测。 */
  declaresReasoning: boolean;
}

const REASONING_PARAMETERS = ['reasoning_effort', 'reasoning', 'include_reasoning', 'verbosity'];

const readDeclaredEfforts = (entry: Record<string, unknown>): PetReasoningEffort[] => {
  const raw = entry.reasoning_efforts ?? entry.supported_reasoning_efforts ?? entry.reasoningEfforts;
  return Array.isArray(raw) ? normalizeEfforts(raw as string[]) : [];
};

const declaresReasoning = (entry: Record<string, unknown>): boolean => {
  const supported = entry.supported_parameters ?? entry.supportedParameters;
  if (!Array.isArray(supported)) return false;
  return supported.some((value) => typeof value === 'string'
    && REASONING_PARAMETERS.includes(value.trim().toLowerCase()));
};

const toFriendlyError = (error: unknown, baseURL: string): Error => {
  const message = String(error instanceof Error ? error.message : error);
  const status = Number((error as { status?: unknown } | null)?.status);
  const target = baseURL.trim() || '默认接口地址';
  if (status === 401 || status === 403) return new Error(`API Key 无效或没有访问权限（${target}）`);
  if (status === 404) return new Error(`${target} 没有 /models 接口，无法拉取模型清单`);
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|timed? ?out/i.test(message)) {
    return new Error(`无法连接 ${target}：${message}`);
  }
  return new Error(message);
};

/**
 * 读取接口的模型列表。凭据与对话请求一样只存在于渲染进程，
 * 所以这里直接请求，不额外引入 IPC 契约。
 */
export const listRemoteModels = async (
  options: { apiKey: string; baseURL: string; signal?: AbortSignal },
): Promise<RemoteModel[]> => {
  try {
    // 地址非法时构造函数就会抛错，所以它也在 try 内，统一转成可读文案。
    const client = new OpenAI({
      // 本地免鉴权接口允许留空，但 SDK 不接受空字符串，这里给一个占位值。
      apiKey: options.apiKey.trim() || 'not-required',
      baseURL: options.baseURL.trim() || undefined,
      dangerouslyAllowBrowser: true,
      maxRetries: 0,
    });
    const page = await client.models.list({ signal: options.signal });
    const models: RemoteModel[] = [];
    for (const entry of page.data ?? []) {
      const id = typeof entry.id === 'string' ? entry.id.trim() : '';
      if (!id) continue;
      const raw = entry as unknown as Record<string, unknown>;
      models.push({
        id,
        ownedBy: typeof entry.owned_by === 'string' ? entry.owned_by : '',
        created: Number.isFinite(entry.created) ? entry.created : 0,
        efforts: readDeclaredEfforts(raw),
        declaresReasoning: declaresReasoning(raw),
      });
    }
    models.sort((left, right) => left.id.localeCompare(right.id));
    if (!models.length) throw new Error('接口返回了空模型列表，确认这个地址是 OpenAI 兼容的 /v1 接口');
    return models;
  } catch (error) {
    throw toFriendlyError(error, options.baseURL);
  }
};
