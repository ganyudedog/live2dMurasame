import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_ARTIFACTS = 16;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const TTS_DIAGNOSTICS_DIRECTORY = 'C:\\Users\\super\\Downloads\\tts';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const safeFilename = (value: unknown): string => {
  const normalized = String(value || 'tts-artifact').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160);
  return normalized || 'tts-artifact';
};

export const registerTtsDiagnosticsIpc = ({ ipcMain }: {
  ipcMain: { handle(channel: string, listener: (event: unknown, payload?: unknown) => Promise<{ ok: true; directory: string; files: string[] }>): void };
}): void => {
  ipcMain.handle('ddd:tts:save-artifacts', async (_event, payload: unknown = {}) => {
    const body = isRecord(payload) ? payload : {};
    const artifacts = Array.isArray(body.artifacts) ? body.artifacts : [];
    if (artifacts.length === 0 || artifacts.length > MAX_ARTIFACTS) {
      throw new Error(`invalid artifact count: ${artifacts.length}`);
    }

    const directory = TTS_DIAGNOSTICS_DIRECTORY;
    await fs.mkdir(directory, { recursive: true });
    const files: string[] = [];
    for (const artifact of artifacts) {
      const item = isRecord(artifact) ? artifact : {};
      const filename = safeFilename(item.filename);
      const encoded = typeof item.base64 === 'string' ? item.base64 : '';
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length > MAX_ARTIFACT_BYTES) {
        throw new Error(`artifact too large: ${filename}`);
      }
      const target = path.join(directory, filename);
      await fs.writeFile(target, bytes);
      files.push(filename);
    }
    return { ok: true as const, directory, files };
  });
};
