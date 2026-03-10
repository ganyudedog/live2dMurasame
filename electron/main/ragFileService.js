import fs from 'node:fs';
import path from 'node:path';

const MAX_RAG_TEXT_FILE_CHARS = 120000;

export const createRagFileService = ({ app }) => {
  const resolveRagKnowledgeFilePath = ({ knowledgeBasePath, modelPath } = {}) => {
    const raw = typeof knowledgeBasePath === 'string' ? knowledgeBasePath.trim() : '';
    if (!raw) return null;

    const candidates = [];
    if (path.isAbsolute(raw)) {
      candidates.push(raw);
    } else {
      if (typeof modelPath === 'string' && modelPath.trim()) {
        candidates.push(path.resolve(modelPath, raw));
      }
      try {
        candidates.push(path.resolve(app.getAppPath(), raw));
        candidates.push(path.resolve(app.getAppPath(), 'public', raw));
      } catch { }
      candidates.push(path.resolve(process.cwd(), raw));
    }

    for (const candidate of candidates) {
      try {
        const stat = fs.statSync(candidate);
        if (stat.isFile()) return candidate;
      } catch { }
    }
    return null;
  };

  const readRagTextFile = ({ knowledgeBasePath, modelPath } = {}) => {
    const resolvedPath = resolveRagKnowledgeFilePath({ knowledgeBasePath, modelPath });
    if (!resolvedPath) {
      return {
        ok: false,
        path: null,
        content: '',
        error: '知识库文件不存在或路径无效',
      };
    }

    try {
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      const content = String(raw ?? '').slice(0, MAX_RAG_TEXT_FILE_CHARS);
      return {
        ok: true,
        path: resolvedPath,
        content,
      };
    } catch (error) {
      return {
        ok: false,
        path: resolvedPath,
        content: '',
        error: String(error instanceof Error ? error.message : error),
      };
    }
  };

  return {
    readRagTextFile,
  };
};