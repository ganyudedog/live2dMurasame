# 实时语音输入链路

更新日期：2026-10-11。本文描述当前实现。

## 执行链路

```text
Pet 窗口麦克风
  -> AudioWorklet：单声道、连续重采样、16 kHz / 512 样本（32 ms）
  -> Electron IPC
  -> ASR Worker：Silero VAD + sherpa-onnx OnlineRecognizer
       -> asr.speech-start：已确认人声，立即打断 LLM / TTS
       -> asr.partial：展示识别中的文本
       -> asr.speech-end：已确认语音结束，刷新识别器尾部
       -> asr.final：提交该句最终文本
  -> AsrService 本地通知 AiService
  -> LLM 流式句子 -> TTS

SharedWorker：同步 ASR 状态、用户文本、助手文本到控制面板
```

Silero 的 `minSpeechDuration` 默认 0.2 秒，限制在 0.15 到 0.3 秒之间。
确认人声后先发出打断事件，再做 ASR 解码。实际打断还包含音频帧量化、
推理、IPC 和系统调度时间，不能将配置的 200 ms 等同于实测延迟。
VAD 默认在 0.7 秒静音后结束当前语音轮次。
ASR 自身端点可以拆分较长的识别片段，但不会在用户仍讲话时提交对话。
最终识别不需要在 VAD 结束后再等待另一轮 ASR 端点静音。

识别线程避免阻塞 Electron 主线程。音频待处理积压超过 1 秒时会停止识别并
明确报错，避免丢掉中间语音后提交错误转写。需要降低模型负载后重新开启。

## 打断与请求接替

`AsrService.onSpeechStart` 通知 `AiService.cancel('barge-in')`：

- 中止当前 LLM 请求，取消信号同时覆盖模型流式请求与超时。
- 停止当前句子分发器，取消 TTS 请求，并立即静音本地 LiveKit 播放。
- 下一次有效 TTS 开始时恢复播放；已取消请求的晚到事件不会恢复声音。
- 当前对话标记为 `cancelled`，保留已经显示的文本。
- 新语音最终结果可立即接替；旧请求的回调、失败和清理不会覆盖新请求。

`asr.final` 通过本地订阅送入 AI，SharedWorker 只承担跨窗口同步，避免合帧
覆盖最终结果导致漏提交。重复或晚到的语音结果会被忽略。
每次识别会话使用唯一 ID，重新开关麦克风不会复用历史请求 ID。

## 两档语音输入

| 档次 | 处理方式 | 当前可用性 |
| --- | --- | --- |
| `conversation` | VAD 结束后提交流式 ASR 最终文本 | 已实现 |
| `agent` | 保留整句音频，经过第二次高精度转写才允许提交 | 已预留接口，待接复核模型 |

高精度档复用同一套 VAD 打断逻辑，区别在最终文本的准入条件。
未来 ASR 适配器提供以下接口：

```js
async refineFinal({ samples, sampleRate, draftText, utteranceId, signal }) {
  // samples: 完整语句的 Float32 PCM，包含 VAD 保留的句首。
  // sampleRate: 16000；draftText 仅是初稿，不能直接驱动 agent。
  // 返回离线大模型或远程服务的复核结果。
  return { text: verifiedText };
}
```

入口在 `AsrSession.js`，由 `asrWorker.js` 从适配器注入 `refineFinal`。
新的语音开始会取消前一轮复核；即使复核服务忽略取消信号，晚到结果也不会提交。
复核失败、结果为空或未配置复核适配器时，不会降级使用初稿驱动 agent。
最终事件与 `ChatRequest.voice` 包含 `profile`、`refined`，供后续 agent 路由使用。
当前设置界面禁用高精度档选项，接入具体模型后再开放。
高精度档目前仅预留转写接口，不包含 agent 执行逻辑或说话人识别。

## 配置模型

复用项目已有的 `sherpa-onnx-node`，无需新增 npm 依赖。
除了原有 `encoder.onnx`、`decoder.onnx`、`joiner.onnx`、`tokens.txt`，还需要：

- sherpa-onnx 兼容的 `silero_vad.onnx`。
- [官方模型下载](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx)。
- [官方 Silero VAD 说明](https://k2-fsa.github.io/sherpa/onnx/vad/silero-vad.html)。

将其放入 ASR 模型目录，或在控制面板 ASR 设置的“Silero VAD 模型路径”中填写完整路径。
此链路要求 16 kHz；已有其他采样率配置需改为 16000。
设置在下次开启麦克风时生效，修改参数后关闭再开启 ASR。

| 配置字段 | 默认值 | 含义 |
| --- | --- | --- |
| `profile` | `conversation` | 语音输入档次 |
| `vadModelPath` | 空 | 空时查找 ASR 目录中的 `silero_vad.onnx` |
| `vadThreshold` | 0.5 | 人声概率阈值 |
| `vadMinSpeechDuration` | 0.2 | 连续人声确认时长，秒 |
| `rule1MinTrailingSilence` | 1.2 | ASR 无文本端点静音，秒 |
| `rule2MinTrailingSilence` | 0.7 | ASR 有文本端点 / VAD 句尾静音，秒 |
| `rule3MinUtteranceLength` | 20 | ASR 长片段端点，秒 |

旧配置中未标记版本的默认组合 `2.4 / 1.2` 会迁移成 `1.2 / 0.7`，
自定义组合会保留。迁移结果标记 `endpointPresetVersion: 1`，避免反复修改。
VAD 的长语音保护为 60 秒；长于此值的连续讲话可能按 VAD 的保护策略分句。

## 验证与调参

自动测试覆盖状态机、端点迁移、旧结果修订、请求取消、重复事件、加载失败、
音频积压和高精度复核失败。它们不能替代真实语音和扬声器环境测试。

可使用录音回放脚本比较 `0.6 / 0.7 / 0.8 / 1.2` 秒的句尾设置，脚本直接调用
生产识别 Worker，输出音频时间轴上的开始、结束、最终文本及离线处理实时率：

```powershell
pnpm exec node scripts/checkAsrRecording.mjs "D:/models/asr" "D:/recordings/test.wav"
```

已回放本地 Zipformer 模型附带的 `0.wav`、`1.wav`、`8k.wav`（8 kHz 样本先重采样）。
这三个样本在四组参数下均输出一条最终结果，文本一致。
`0.7` 秒相对 `1.2` 秒均提前约 512 ms 提交，未出现额外分句。
这只验证所测样本的相对变化，不能据此推断真实插话和扬声器环境的总体误切率。

建议录音覆盖：短句、句中 300/500/800 ms 停顿、连续插话、轻声、背景噪声、
TTS 扬声器回声以及长指令。分别记录句中误切、漏打断、错误打断、句首漏字
和语音结束到请求提交的时间。

先对比句尾静音 `0.6 / 0.7 / 0.8` 秒；误切较多时增加句尾静音，
错误打断较多时提高人声阈值或确认时长。浏览器回声消除已开启，但 Silero
只区分语音与非语音，不能保证过滤扬声器回声或只识别指定用户。
