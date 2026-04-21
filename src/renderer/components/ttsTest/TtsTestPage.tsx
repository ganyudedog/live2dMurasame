import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { requestTtsSynthesis, warmupTtsModel } from '../../../AI/tts/client';
import { TtsStreamPlayer } from '../../../AI/tts/streamPlayer';
import type { TtsRuntimeConfig } from '../../../AI/tts/types';
import { info, warn } from '../../utils/log';

type SentenceTask = {
  index: number;
  requestId: string;
  text: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  firstChunkMs?: number;
  totalMs?: number;
  err?: string;
};

const STORAGE_KEY = 'tts:test:config:v1';

const FIXED_JA_SENTENCES: readonly string[] = [
  'こんにちは、今日も会えて嬉しいです。',
  '今夜はゆっくりおしゃべりしませんか。',
  '小さな幸せを一緒に見つけましょう。',
  'あなたの笑顔を見ると元気になります。',
  '温かいお茶でも飲んでひと息つこう。',
  '優しい言葉は心を明るくしてくれるね。',
  '明日の予定を少しだけ教えてください。',
  '無理せず自分のペースで進めば大丈夫。',
  '今日はいいことがきっと起こる気がする。',
  '最後にもう一度、大好きだよと言わせて。',
];

const defaultConfig: TtsRuntimeConfig = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:9881',
  gptWeightsPath: '',
  sovitsWeightsPath: '',
  textLang: 'ja',
  promptLang: 'ja',
  refAudioPath: '',
  refAudioText: '',
  textSplitMode: 'cut0',
  speedFactor: 1,
  fragmentInterval: 0.3,
  useLastGeneratedAsRef: false,
  topK: 20,
  topP: 0.8,
  temperature: 0.5,
  mediaType: 'ogg',
  streamingMode: true,
};

const makeRequestId = (index: number): string => `tts_test_${Date.now().toString(36)}_${index}`;

const loadConfig = (): TtsRuntimeConfig => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultConfig;
    const parsed = JSON.parse(raw) as Partial<TtsRuntimeConfig>;
    return {
      ...defaultConfig,
      ...parsed,
      mediaType: 'ogg',
      streamingMode: true,
    };
  } catch {
    return defaultConfig;
  }
};

const saveConfig = (config: TtsRuntimeConfig): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // ignore
  }
};

export function TtsTestPage() {
  const playerRef = useRef<TtsStreamPlayer | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [config, setConfig] = useState<TtsRuntimeConfig>(() => loadConfig());
  const [running, setRunning] = useState(false);
  const [tasks, setTasks] = useState<SentenceTask[]>([]);

  const sentenceCount = useMemo(() => FIXED_JA_SENTENCES.length, []);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  useEffect(() => {
    return () => {
      try {
        abortRef.current?.abort();
      } catch {
        // ignore
      }
      abortRef.current = null;
      try {
        playerRef.current?.dispose();
      } catch {
        // ignore
      }
      playerRef.current = null;
    };
  }, []);

  const updateTask = (index: number, patch: Partial<SentenceTask>) => {
    setTasks((prev) => prev.map((item) => (item.index === index ? { ...item, ...patch } : item)));
  };

  const handleWarmup = async () => {
    try {
      await warmupTtsModel(config, { reason: 'tts-test-page' });
      toast.success('TTS 预热完成');
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e);
      warn('tts.test', 'warmup.failed', { err: message });
      toast.error(`预热失败: ${message}`);
    }
  };

  const handleStop = () => {
    try {
      abortRef.current?.abort();
    } catch {
      // ignore
    }
    abortRef.current = null;
    try {
      playerRef.current?.stop();
    } catch {
      // ignore
    }
    setRunning(false);
    toast('已停止批量测试');
  };

  const handleRunAll = async () => {
    if (running) return;

    const controller = new AbortController();
    abortRef.current = controller;

    if (!playerRef.current) {
      playerRef.current = new TtsStreamPlayer();
    }

    const initialTasks: SentenceTask[] = FIXED_JA_SENTENCES.map((text, index) => ({
      index,
      requestId: makeRequestId(index),
      text,
      status: 'queued',
    }));
    setTasks(initialTasks);

    setRunning(true);
    info('tts.test', 'batch.start', {
      sentenceCount: FIXED_JA_SENTENCES.length,
      baseUrl: config.baseUrl,
      mediaType: config.mediaType,
      streamingMode: config.streamingMode,
    });

    for (let index = 0; index < initialTasks.length; index += 1) {
      if (controller.signal.aborted) break;
      const task = initialTasks[index];
      updateTask(index, { status: 'running', err: undefined });

      const startAt = performance.now();
      let firstChunkMs = -1;

      try {
        const response = await requestTtsSynthesis({
          requestId: task.requestId,
          speakText: task.text,
          displayText: task.text,
          config,
          signal: controller.signal,
          preferRealtime: false,
        });

        await playerRef.current!.playResponse(response, {
          requestId: task.requestId,
          preferredMediaType: 'ogg',
          streamingMode: true,
          signal: controller.signal,
          onChunk: () => {
            if (firstChunkMs >= 0) return;
            firstChunkMs = Math.round(performance.now() - startAt);
            updateTask(index, { firstChunkMs });
          },
        });

        const totalMs = Math.round(performance.now() - startAt);
        updateTask(index, {
          status: 'done',
          firstChunkMs: firstChunkMs >= 0 ? firstChunkMs : undefined,
          totalMs,
        });

        info('tts.test', 'sentence.done', {
          index,
          requestId: task.requestId,
          firstChunkMs: firstChunkMs >= 0 ? firstChunkMs : undefined,
          totalMs,
        });
      } catch (e) {
        if (controller.signal.aborted) {
          updateTask(index, { status: 'failed', err: 'aborted' });
          break;
        }
        const message = String(e instanceof Error ? e.message : e);
        updateTask(index, { status: 'failed', err: message });
        warn('tts.test', 'sentence.failed', {
          index,
          requestId: task.requestId,
          err: message,
        });
      }
    }

    setRunning(false);
    abortRef.current = null;
    toast.success('批量测试完成');
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-6 space-y-6">
      <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
        <h1 className="text-xl font-semibold">TTS OGG 流式测试页</h1>
        <p className="mt-2 text-sm text-slate-300">
          入口查询参数：window=test。该页面不依赖 Electron，可直接在浏览器中测试。固定 10 条日语句子，支持一键顺序合成与播放。
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
        <label className="space-y-1">
          <span className="text-sm text-slate-300">TTS Base URL</span>
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
            value={config.baseUrl}
            onChange={(e) => setConfig((prev) => ({ ...prev, baseUrl: e.target.value }))}
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm text-slate-300">refAudioPath</span>
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
            value={config.refAudioPath}
            onChange={(e) => setConfig((prev) => ({ ...prev, refAudioPath: e.target.value }))}
          />
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-sm text-slate-300">refAudioText</span>
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
            value={config.refAudioText}
            onChange={(e) => setConfig((prev) => ({ ...prev, refAudioText: e.target.value }))}
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm text-slate-300">gptWeightsPath</span>
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
            value={config.gptWeightsPath}
            onChange={(e) => setConfig((prev) => ({ ...prev, gptWeightsPath: e.target.value }))}
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm text-slate-300">sovitsWeightsPath</span>
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
            value={config.sovitsWeightsPath}
            onChange={(e) => setConfig((prev) => ({ ...prev, sovitsWeightsPath: e.target.value }))}
          />
        </label>

        <div className="md:col-span-2 text-xs text-slate-400">
          固定参数：mediaType=ogg，streamingMode=true，textLang=ja，promptLang=ja，textSplitMode=cut0。
        </div>

        <div className="md:col-span-2 flex flex-wrap gap-3 pt-2">
          <button
            className="rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-medium px-4 py-2 disabled:opacity-50"
            onClick={handleWarmup}
            disabled={running}
          >
            模型预热
          </button>
          <button
            className="rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium px-4 py-2 disabled:opacity-50"
            onClick={handleRunAll}
            disabled={running}
          >
            一键生成并顺序播放（{sentenceCount}句）
          </button>
          <button
            className="rounded-lg bg-rose-500 hover:bg-rose-400 text-white font-medium px-4 py-2 disabled:opacity-50"
            onClick={handleStop}
            disabled={!running}
          >
            停止
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5 space-y-3">
        <h2 className="text-lg font-semibold">固定测试句子</h2>
        <ol className="list-decimal pl-6 space-y-1 text-sm text-slate-200">
          {FIXED_JA_SENTENCES.map((sentence, index) => (
            <li key={sentence + index}>{sentence}</li>
          ))}
        </ol>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-slate-900/70 p-5">
        <h2 className="text-lg font-semibold mb-3">执行结果</h2>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-300 border-b border-slate-700">
                <th className="py-2 pr-2">#</th>
                <th className="py-2 pr-2">状态</th>
                <th className="py-2 pr-2">首包(ms)</th>
                <th className="py-2 pr-2">总耗时(ms)</th>
                <th className="py-2 pr-2">requestId</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.requestId} className="border-b border-slate-800 text-slate-200 align-top">
                  <td className="py-2 pr-2">{task.index + 1}</td>
                  <td className="py-2 pr-2">{task.status}</td>
                  <td className="py-2 pr-2">{task.firstChunkMs ?? '-'}</td>
                  <td className="py-2 pr-2">{task.totalMs ?? '-'}</td>
                  <td className="py-2 pr-2 break-all">
                    <div>{task.requestId}</div>
                    {task.err ? <div className="text-rose-300 mt-1">{task.err}</div> : null}
                  </td>
                </tr>
              ))}
              {!tasks.length ? (
                <tr>
                  <td className="py-4 text-slate-400" colSpan={5}>尚未开始测试</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default TtsTestPage;
