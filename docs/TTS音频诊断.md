# TTS 音频诊断

前端仅记录请求结果、关键耗时及失败原因，波形、频谱和音频差异交给 FFmpeg 离线分析。
查看 `INFO [TtsService.tts.request] completed` 的 `data`；请求失败时查看同一业务服务的失败日志。
`traceId` 经 `tts.speak` 传到后端，`backendTraceId` 对应后端日志的短 ID。

## 摘要字段

| 字段 | 含义 |
| --- | --- |
| `state / transport` | 请求终态及 LiveKit 或 HTTP 播放方式 |
| `submittedMs` | 从本句前端请求开始到发布完成，包含会话准备、模型就绪和提交顺序等待 |
| `firstPcmMs` | 从本句前端请求开始到收到首块 PCM 元信息，包含后端队列等待，不是扬声器起播时延 |
| `backendFirstFrameMs` | 后端本句处理开始到首次提交 AudioSource；预合成句子还包含等待前句播放的时间 |
| `latencyMs` | 本句请求总耗时，不等于首帧延迟；调试录制时包含尾部观察时间 |
| `feedback.failures / reason` | 仅在播放反馈失败时输出失败次数和最后原因 |
| `reason / err` | 取消或失败原因 |

不再输出逐块、逐帧异常日志、接收计数差分或在线波形评价。LiveKit 传输层不重复保存 TTS 请求的回环 trace，也不记录播放反馈和帧事件载荷。AI 对话只累计提交、完成、跳过和失败句数；句子的失败由 TtsService 记录。全部日志仍走现有 LogService 的上下文、trace 和源文件定位规则。

## 解释边界

FFmpeg 可以分析波形、静音、响度和频谱，但不能仅从 WAV 确定模型等待或 RTP 丢包。因此调试文件保留后端终态载荷中的生成、发送、缓冲摘要，以及接收统计的首末快照，不将这些数据展开为前端日志。

LiveKit RTP/Opus 仍是主播放链路，后端 Shadow 静音传输保持原有行为。正常模式前端不解析 Shadow PCM，也不创建解码 AudioContext。调试录制使用远端音轨的独立静音分支，退订时释放节点，不停止或替换实际播放音轨。自适应接收缓冲及后端播放反馈仍运行，不属于离线诊断。

后端等待 AudioSource 排空后发送 `tts.finished`。调试录制额外保留 160ms 尾部观察时间，不阻塞下一句提交。共用音轨的观察窗口可能包含相邻句首尾，文件不保证逐样本对齐，不能将波形差异直接归为丢包或音质下降。

## 后端句子队列

前端每收到一句即提交 `tts.speak`，用 `queue_group_id` 关联同一轮对话，`sentence_index` 标记句序。前端不再保存待播放句子，也不轮询等待上一句终态；仅保留未完成请求的状态。会话和模型准备、DataChannel 发布按提交顺序执行，发布完成立即释放下一次提交。

后端对同一对话追加请求，模型串行推理，下行音轨按入队顺序播放。当前句播放期间最多提前合成下一句，PCM 复用原有磁盘 spool，播放后删除。更后面的句子暂存文本，避免生成音频无限占用磁盘。队列最多容纳 128 个未完成请求，达到上限明确返回 `TTS_QUEUE_FULL`，不静默丢句。

入队深度仅写入调试 JSON。实际播放开始才启用该句的播放反馈；取消对话会取消其所有已提交请求，并阻止后续流式句子继续提交。新一轮对话仍可替换旧对话。HTTP 降级维持顺序播放。

发送侧 Source 队列低于目标缓冲的一半时重新补足缓冲，再恢复固定节拍。`capture_diagnostics.source_refill_count` 记录重建次数，`playout_drained` 表示终态前 Source 已排空。补缓冲不能恢复模型尚未生成的音频，但可防止一次断供后一直维持过低余量。

## 音频文件与 FFmpeg 外挂分析

当 `LogService.debugModeEnabled` 开启，或在前端地址追加 `?ttsAudioArtifacts=1` 时，TTS 业务层会为每句请求额外下载四个文件：

- `*.reference.wav`：后端送入 LiveKit 之前的 Shadow 原始交错 int16 PCM；
- `*.decoded.wav`：LiveKit 解码后、静音观察分支取得的 PCM；
- `*.analysis.json`：trace、运行时、原生采样率、样本数、截断标记及后端/接收时序信息；
- `*.analysis.cmd`：可直接交给 FFmpeg/ffprobe 的分析命令。

文件通过 Electron utils 中的辅助写入接口静默保存到 `C:\Users\super\Downloads\tts`，不会弹出下载窗口。FFmpeg 仍是独立工具，不加入播放业务依赖。正式运行关闭调试和查询参数时不会录制或导出文件。

录制保留原生采样率，不在前端重采样或做波形计算。每条分支最多保留开头 60 秒且不超过 32MB，超出时写入 `truncated: true`；采样率或声道变化时停止追加并标记 `formatChanged: true`。该限制只影响调试文件，不影响播放。

在音频目录运行对应 `.analysis.cmd`，或使用 JSON 中的 `ffmpegCommands`，可生成 ffprobe 信息、astats 和频谱图。跨分支比较时先根据各自文件头统一采样率和观察范围，再做对齐。不会移动或覆盖 WinGet 管理的 FFmpeg。

此次精简仅修改前端，刷新前端后新请求生效，不需要重启 TTS 后端。
