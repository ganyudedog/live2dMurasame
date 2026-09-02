import { logDebugTrace, logPetEvent } from '../../utils/log.js';

export class LogIngestService {
  #rendererEntries = 0;
  #backendEntries = 0;

  ingestRendererTrace(event, payload = {}) {
    if (!payload || typeof payload !== 'object' || payload.kind === 'policy.patch') return;
    const senderId = event?.sender?.id;
    const renderer = payload.renderer && typeof payload.renderer === 'object'
      ? { ...payload.renderer, webContentsId: senderId }
      : payload.renderer;
    logDebugTrace({ ...payload, renderer });
    this.#rendererEntries += 1;
  }

  ingestBackendEvent(event, payload = {}, options = {}) {
    logPetEvent(`backend.${event}`, payload, options);
    this.#backendEntries += 1;
  }

  getStats() {
    return {
      rendererEntries: this.#rendererEntries,
      backendEntries: this.#backendEntries,
    };
  }
}

export const createLogIngestService = () => new LogIngestService();
