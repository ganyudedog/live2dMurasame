import { listRemoteModels, type RemoteModel } from './modelCatalog';
import { probeModelEfforts } from './effortProbe';

/** Re-detection replaces endpoint capabilities, including models previously disabled. */
export const detectModels = async (
  options: { apiKey: string; baseURL: string; signal: AbortSignal },
  onProgress: (model: string) => void,
): Promise<{ available: RemoteModel[]; models: PetLlmModel[]; unknown: string[] }> => {
  const available = await listRemoteModels(options);
  const models: PetLlmModel[] = [];
  const unknown: string[] = [];
  for (const remote of available) {
    options.signal.throwIfAborted();
    onProgress(remote.id);
    const result = remote.efforts.length
      ? { status: 'ok' as const, efforts: remote.efforts, source: 'catalog' as const }
      : await probeModelEfforts({ ...options, model: remote.id });
    options.signal.throwIfAborted();
    if (result.status === 'unknown') unknown.push(remote.id);
    models.push({ id: remote.id, efforts: result.efforts,
      effortsSource: result.status === 'ok' ? result.source : 'none',
      probedAt: result.status === 'ok' ? Date.now() : 0 });
  }
  return { available, models, unknown };
};
