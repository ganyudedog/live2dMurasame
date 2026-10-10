import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_ARTIFACTS = 16;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const TTS_DIAGNOSTICS_DIRECTORY = 'C:\\Users\\super\\Downloads\\tts';

const safeFilename = (value) => {
  const normalized = String(value || 'tts-artifact').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160);
  return normalized || 'tts-artifact';
};

export const registerTtsDiagnosticsIpc = ({ ipcMain }) => {
  ipcMain.handle('ddd:tts:save-artifacts', async (_event, payload = {}) => {
    const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
    if (artifacts.length === 0 || artifacts.length > MAX_ARTIFACTS) {
      throw new Error(`invalid artifact count: ${artifacts.length}`);
    }

    // This is a debug-only artifact sink. Production playback never enters this IPC.
    const directory = TTS_DIAGNOSTICS_DIRECTORY;
    await fs.mkdir(directory, { recursive: true });
    const files = [];
    for (const artifact of artifacts) {
      const filename = safeFilename(artifact?.filename);
      const encoded = typeof artifact?.base64 === 'string' ? artifact.base64 : '';
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length > MAX_ARTIFACT_BYTES) {
        throw new Error(`artifact too large: ${filename}`);
      }
      const target = path.join(directory, filename);
      await fs.writeFile(target, bytes);
      files.push(filename);
    }
    return { ok: true, directory, files };
  });
};
