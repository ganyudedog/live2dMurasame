import { observer } from 'mobx-react-lite';
import toast from 'react-hot-toast';
import { useService } from '@app/core/useService';
import { TOKENS } from '@app/core/serviceTokens';
import { TTS_TEST_SENTENCES } from '../service/TtsTestService';

export const TtsTestPage = observer(() => {
  const service = useService(TOKENS.ttsTest);
  const { config, running, tasks } = service;
  const sentenceCount = TTS_TEST_SENTENCES.length;

  const handleWarmup = async (): Promise<void> => {
    try {
      await service.warmup();
      toast.success('TTS 预热完成');
    } catch (e) {
      const message = String(e instanceof Error ? e.message : e);
      toast.error(`预热失败: ${message}`);
    }
  };

  const handleStop = () => {
    service.stop();
    toast('已停止批量测试');
  };

  const handleRunAll = async () => {
    await service.runAll();
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
            onChange={(e) => service.updateConfig({ baseUrl: e.target.value })}
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm text-slate-300">refAudioPath</span>
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
            value={config.refAudioPath}
            onChange={(e) => service.updateConfig({ refAudioPath: e.target.value })}
          />
        </label>

        <label className="space-y-1 md:col-span-2">
          <span className="text-sm text-slate-300">refAudioText</span>
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
            value={config.refAudioText}
            onChange={(e) => service.updateConfig({ refAudioText: e.target.value })}
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm text-slate-300">gptWeightsPath</span>
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
            value={config.gptWeightsPath}
            onChange={(e) => service.updateConfig({ gptWeightsPath: e.target.value })}
          />
        </label>

        <label className="space-y-1">
          <span className="text-sm text-slate-300">sovitsWeightsPath</span>
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-600 px-3 py-2 text-sm"
            value={config.sovitsWeightsPath}
            onChange={(e) => service.updateConfig({ sovitsWeightsPath: e.target.value })}
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
          {TTS_TEST_SENTENCES.map((sentence, index) => (
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
});

export default TtsTestPage;
