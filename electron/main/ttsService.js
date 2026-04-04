import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { logDebugTrace } from '../utils/log.js';

const SPLIT_MODE_MAP = {
  cut4: 'cut4',
  cut50: 'cut3',
  zhComma: 'cut1',
  enComma: 'cut2',
  punctuation: 'cut5',
  none: 'cut0',
};

const toSafeObject = (value) => (value && typeof value === 'object' ? value : {});
const toText = (value) => (typeof value === 'string' ? value : '');

const normalizeBaseUrl = (value) => {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : 'http://127.0.0.1:9880';
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
};

const clampNumber = (value, fallback, min, max) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
};

const ensureDir = (dirPath) => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    // ignore
  }
};

const readResponseStream = async (response) => {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const rawBuffer = Buffer.from(await response.arrayBuffer());
    return {
      chunks: [rawBuffer],
      firstChunkAt: Date.now(),
      byteLength: rawBuffer.length,
    };
  }

  const reader = response.body.getReader();
  const chunks = [];
  let firstChunkAt = 0;
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    if (!firstChunkAt) firstChunkAt = Date.now();
    chunks.push(chunk);
    total += chunk.length;
  }

  return {
    chunks,
    firstChunkAt: firstChunkAt || Date.now(),
    byteLength: total,
  };
};

// 专注于 TTS 相关的功能，尤其是与外部 TTS 服务的交互和性能追踪。它不直接处理模型记忆或全局配置等内容，而是提供一个独立的服务接口，供其他模块调用以实现文本到语音的转换。
export const createTtsService = () => {
  const throttledAtMap = new Map();
  const lastWeightsByBaseUrl = new Map();
  const lastAudioPathByModelPath = new Map();

  const throttledTrace = (key, payload = {}, throttleMs = 1200) => {
    const now = Date.now();
    const last = throttledAtMap.get(key) ?? 0;
    if (now - last < throttleMs) return;
    throttledAtMap.set(key, now);

    logDebugTrace({
      kind: 'tts',
      profile: 'perf',
      level: 'info',
      request: {
        source: 'main.tts',
        phase: key,
        ts: now,
      },
      perf: {
        costMs: Number.isFinite(payload?.costMs) ? payload.costMs : undefined,
      },
      model: {
        hasActiveModelFileUrl: typeof payload?.modelPath === 'string' && payload.modelPath.length > 0,
        currentPath: typeof payload?.modelPath === 'string' ? payload.modelPath : undefined,
        error: typeof payload?.error === 'string' ? payload.error : undefined,
      },
      layout: {
        kind: 'tts',
        source: 'main.tts',
        reason: typeof payload?.reason === 'string' ? payload.reason : key,
      },
    });
  };

  const applyWeightsIfNeeded = async ({ baseUrl, gptWeightsPath, sovitsWeightsPath, requestId }) => {
    const cache = lastWeightsByBaseUrl.get(baseUrl) ?? { gptWeightsPath: '', sovitsWeightsPath: '' };

    if (gptWeightsPath && cache.gptWeightsPath !== gptWeightsPath) {
      const url = `${baseUrl}/set_gpt_weights?${new URLSearchParams({ weights_path: gptWeightsPath }).toString()}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`set_gpt_weights failed: ${body || res.status}`);
      }
      cache.gptWeightsPath = gptWeightsPath;
      throttledTrace('weights.gpt.applied', { reason: requestId, modelPath: gptWeightsPath });
    }

    if (sovitsWeightsPath && cache.sovitsWeightsPath !== sovitsWeightsPath) {
      const url = `${baseUrl}/set_sovits_weights?${new URLSearchParams({ weights_path: sovitsWeightsPath }).toString()}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`set_sovits_weights failed: ${body || res.status}`);
      }
      cache.sovitsWeightsPath = sovitsWeightsPath;
      throttledTrace('weights.sovits.applied', { reason: requestId, modelPath: sovitsWeightsPath });
    }

    lastWeightsByBaseUrl.set(baseUrl, cache);
  };

  const synthesize = async ({ text, requestId, modelPath, modelConfig }) => {
    const tts = toSafeObject(modelConfig?.tts);
    const enabled = Boolean(tts.enabled);
    if (!enabled) {
      throttledTrace('tts.disabled', { reason: requestId, modelPath }, 2000);
      return { ok: false, skipped: true, reason: 'tts-disabled' };
    }

    const baseUrl = normalizeBaseUrl(tts.baseUrl);
    const gptWeightsPath = toText(tts.gptWeightsPath);
    const sovitsWeightsPath = toText(tts.sovitsWeightsPath);
    const refAudioPathFromConfig = toText(tts.refAudioPath);
    const refAudioText = toText(tts.refAudioText);
    const useLastGeneratedAsRef = Boolean(tts.useLastGeneratedAsRef);
    const textLang = toText(tts.textLang || 'ja');
    const promptLang = toText(tts.promptLang || textLang || 'ja');

    const reusedRefAudioPath = modelPath && useLastGeneratedAsRef ? lastAudioPathByModelPath.get(modelPath) : '';
    const refAudioPath = reusedRefAudioPath || refAudioPathFromConfig;

    if (!refAudioPath) {
      throttledTrace('tts.no-ref-audio', { reason: requestId, modelPath }, 2000);
      return { ok: false, skipped: true, reason: 'tts-ref-audio-missing' };
    }

    if (!refAudioText) {
      throttledTrace('tts.no-ref-text', { reason: requestId, modelPath }, 2000);
      return { ok: false, skipped: true, reason: 'tts-ref-text-missing' };
    }

    const splitMode = toText(tts.textSplitMode || 'punctuation');
    const splitMethod = SPLIT_MODE_MAP[splitMode] ?? SPLIT_MODE_MAP.punctuation;
    const mediaType = tts.mediaType === 'ogg' || tts.mediaType === 'aac' ? tts.mediaType : 'wav';

    const payload = {
      text,
      text_lang: textLang,
      ref_audio_path: refAudioPath,
      prompt_text: refAudioText,
      prompt_lang: promptLang,
      text_split_method: splitMethod,
      speed_factor: clampNumber(tts.speedFactor, 1, 0, 2),
      fragment_interval: clampNumber(tts.fragmentInterval, 0.3, 0, 0.5),
      top_k: Math.max(1, Math.min(100, Number.isFinite(tts.topK) ? Math.floor(tts.topK) : 20)),
      top_p: clampNumber(tts.topP, 0.8, 0, 1),
      temperature: clampNumber(tts.temperature, 0.5, 0, 1),
      media_type: mediaType,
      streaming_mode: Boolean(tts.streamingMode),
    };

    const startAt = Date.now();
    throttledTrace('voice.start', { reason: requestId, modelPath }, 0);

    try {
      await applyWeightsIfNeeded({ baseUrl, gptWeightsPath, sovitsWeightsPath, requestId });

      const response = await fetch(`${baseUrl}/tts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(body || `HTTP ${response.status}`);
      }

      const streamResult = await readResponseStream(response);
      const firstChunkMs = Math.max(0, streamResult.firstChunkAt - startAt);
      throttledTrace('voice.first_chunk', { reason: requestId, costMs: firstChunkMs, modelPath }, 0);

      const outputDir = path.join(app.getPath('userData'), 'tts-cache');
      ensureDir(outputDir);
      const ext = mediaType === 'aac' ? 'aac' : mediaType === 'ogg' ? 'ogg' : 'wav';
      const outputPath = path.join(outputDir, `${requestId}_${Date.now()}.${ext}`);
      const merged = Buffer.concat(streamResult.chunks);
      fs.writeFileSync(outputPath, merged);

      if (modelPath) {
        lastAudioPathByModelPath.set(modelPath, outputPath);
      }

      const totalMs = Date.now() - startAt;
      throttledTrace('voice.end', { reason: requestId, costMs: totalMs, modelPath }, 0);

      return {
        ok: true,
        audioPath: outputPath,
        mediaType,
        byteLength: streamResult.byteLength,
        firstChunkMs,
        totalMs,
      };
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error);
      throttledTrace('voice.error', { reason: requestId, error: message, modelPath }, 0);
      return {
        ok: false,
        skipped: false,
        reason: 'tts-request-failed',
        error: message,
      };
    }
  };

  return {
    synthesize,
  };
};
