# Live2D AI 接入方案（中文）

## 1. 目标与原则

本项目 AI 化目标分为三条主线：

1. 语言思考：LLM + RAG
2. 动作控制：结构化意图 -> Live2D 动作执行
3. 语音输出：GPT-SoVITS

当前确认接入范围：

- 对话 AI
- ASR
- TTS

说明：

- 视觉信号链路保留设计，但不作为当前实施重点。

设计原则：

- 动作响应优先：先保证交互稳定和低延迟，再追求复杂能力。
- 分层解耦：语言、动作、语音、视觉各层可独立替换。
- 强约束协议：AI 输出必须结构化并可校验。
- 可观测优先：每条链路可追踪，便于后续排障。

---

## 2. 推荐实施顺序

1. 动作协议与动作控制器
2. 语言思考（Qwen）+ RAG
3. 语音输出（GPT-SoVITS）
4. 简单面部识别信号接入

原因：

- 语音是表现层，不是控制核心。
- 动作协议先稳定，后续接 LLM/TTS 才不会造成“会说不会动”或“乱动”。

---

## 3. 总体架构

### 3.1 动作层（Action Controller）

输入：

- `action_intent`（来自 LLM 或规则引擎）

输出：

- Live2D motion / expression / parameter 调用

建议协议（V1）：

```json
{
	"emotion": "neutral|happy|sad|angry|surprised",
	"motion": "idle|greet|nod|shake_head|thinking|listening",
	"intensity": 0.0,
	"duration_ms": 800,
	"priority": 50,
	"cooldown_ms": 300,
	"reason": "optional-debug-reason"
}
```

控制器职责：

- 校验和归一化
- 去重与冷却
- 优先级仲裁
- 非阻塞执行

### 3.2 语言层（Qwen + RAG）

输入：

- 用户文本（后续可加入视觉信号）

输出：

- `reply_text`
- `action_intent`

RAG 上下文建议：

- 角色卡
- 最近会话摘要
- 世界观/知识片段
- 可用动作能力表

要求：

- LLM 结果必须是严格 JSON，禁止自由文本协议。

### 3.3 语音层（GPT-SoVITS）

输入：

- `reply_text`

输出：

- 可播放音频（流或文件）

执行策略：

- 文本一产出，立即触发“预备动作”。
- TTS 与动作并行。
- 播放结束执行收尾动作。

---

## 4. 建议引入库

### 4.1 当前阶段（V1 必选）

1. `openai`

- 用于调用 Qwen（OpenAI 兼容接口）。

2. `zod`

- 校验 LLM 输出、动作意图、IPC 数据。

3. `p-queue`

- 管理并发、限流、优先级。

4. `@mediapipe/tasks-vision`

- 后续简单面部识别与关键点信号。

5. `better-sqlite3`

- 暂列为后续可选持久化方案，当前阶段不作为必选实现。

### 4.2 可选（V2）

1. `xstate`

- 当多模态状态机复杂后再引入。

2. `langchain` / `llamaindex`

- 仅在 RAG 编排复杂到手写维护困难时引入。

### 4.3 暂不建议现在引入

- 重型全家桶 Agent 框架（早期收益低、维护成本高）。
- 视觉直接驱动动作（应先进入动作仲裁器）。

---

## 5. 目录落位建议（结合当前仓库）

建议新增目录：

- `src/AI/core/`：调度、队列、编排
- `src/AI/llm/`：Qwen 客户端、Prompt、输出解析
- `src/AI/rag/`：检索、索引、上下文拼装
- `src/AI/action/`：动作协议、仲裁器、执行器
- `src/AI/voice/`：GPT-SoVITS 适配层
- `src/AI/vision/`：人脸信号采集与标准化
- `src/AI/types/`：统一类型与 zod schema

Electron 侧建议：

- `electron/runtime/ai/`：主进程 AI 调度入口（如需主进程统一编排）

文档建议：

- `docs/ai.md`（本文件）：总体方案
- `docs/ai-contract.md`：协议与字段定义
- `docs/ai-perf.md`：性能预算与压测结论

---

## 6. 协议与接口约定

统一请求结果结构：

```json
{
	"request_id": "uuid-or-ts",
	"reply_text": "...",
	"action_intent": {
		"emotion": "neutral",
		"motion": "listening",
		"intensity": 0.5,
		"duration_ms": 700,
		"priority": 40,
		"cooldown_ms": 300
	},
	"meta": {
		"latency_ms": 0,
		"model": "qwen-..."
	}
}
```

错误约定：

- LLM 超时：回落预设文本 + `idle` 动作
- 解析失败：记录错误并丢弃动作，仅保留文本
- TTS 失败：文本展示 + 静音动作

---

## 7. 队列与调度策略

队列划分：

1. `textQueue`
2. `actionQueue`
3. `voiceQueue`

策略：

- `textQueue`：并发 1~2，新输入可中断旧请求
- `actionQueue`：低优先级动作 latest-wins
- `voiceQueue`：按会话串行，支持打断策略

建议增加：

- `request_id` 全链路透传
- 可取消标记（AbortSignal）

---

## 8. 性能优化与延迟预算

优化方向：

1. 并行流水

- 文本生成后立即触发动作，不等待 TTS。

2. RAG 轻量化

- TopK 3~5，短 chunk，历史摘要。

3. 缓存

- 高频短句 TTS 缓存
- 高频模板与动作意图缓存

4. 流式策略

- LLM 流式输出
- TTS 支持时做分段或预热

建议预算：

- 检索 < 80ms
- 首 token < 300ms
- 动作触发 < 50ms
- 首音频包 < 500ms

---

## 9. 面部识别接入（后续）

视觉模块只产出“信号”，不直接控制动作：

```json
{
	"face_present": true,
	"attention_score": 0.83,
	"distance_bucket": "near|mid|far",
	"emotion_hint": "neutral|happy|surprised",
	"ts": 0
}
```

接入原则：

- 视觉 -> 标准化信号 -> 动作仲裁器
- 禁止视觉层直接调用 motion API

---

## 10. 里程碑计划

### M1 动作协议与控制器

- 完成 `action_intent` schema
- 完成冷却/优先级/去重仲裁

### M2 Qwen 文本与结构化输出

- 接入 Qwen
- 输出严格 JSON
- 接入动作控制器

### M3 GPT-SoVITS

- 建立语音队列
- 增加 speaking 生命周期动作钩子

### M4 RAG 与记忆

- RAG 检索 + 轻量记忆分层
- 上下文压缩与摘要

### M5 视觉信号

- 面部信号采集
- 信号映射到动作意图

---

## 11. 观测与验收

建议观测指标：

- `llm_first_token_ms`
- `rag_retrieval_ms`
- `action_dispatch_ms`
- `tts_first_packet_ms`
- `end_to_end_reply_ms`

验收标准（V1）：

- 文字到动作首次反馈 < 400ms
- 文字到可听语音首包 < 900ms
- AI 输出解析失败率 < 1%

---

## 12. 当前阶段非目标

- 不引入重型全栈 Agent 框架
- 不在早期引入复杂状态机框架
- 不允许视觉层绕过仲裁器直接驱动动作

---

## 13. 流式语音识别到流式 AI（低延迟方案）

### 13.1 目标

在“用户尚未说完整句”时，系统即可开始理解与预动作，降低主观等待时间。

核心思路：

- ASR 输出分为 `partial`（中间稿）与 `final`（定稿）
- AI 分为两条通道：
	- `fast lane`：处理 `partial`，只做低风险动作预判
	- `commit lane`：处理 `final`，输出正式文本与最终动作

### 13.2 处理原则

1. `partial` 只触发“可撤销”行为

- 例如：`listening`、`thinking`、轻点头
- 禁止直接触发高风险动作和正式播报

2. `final` 才触发正式输出

- 正式 `reply_text`
- 正式 `action_intent`
- 语音合成（GPT-SoVITS）

3. 所有在途任务必须可取消

- 新 `partial` 到来时取消旧 `partial` 推理
- `final` 到来时取消同会话所有 `partial` 推理

### 13.3 防抖与触发门槛

建议参数（V1 默认）：

- `partial_emit_interval_ms`: 250~300ms
- `stable_tail_frames`: 2
- `min_new_tokens_to_trigger`: 4~6
- `silence_commit_ms`: 250~400ms

触发条件（满足其一即可）：

- 连续 N 帧尾词不变
- 新增 token 超过阈值
- 进入短静音窗口

### 13.4 并行策略

1. ASR `partial` 到来

- 快速更新“理解中”状态
- 执行 fast lane（动作预判）

2. ASR `final` 到来

- 进入 commit lane（正式回复）
- 并行触发：动作预备 + TTS 预热

3. TTS 首包到来

- 切换 speaking 动作
- 播放结束触发收尾动作

---

## 14. 事件协议草案（Draft）

> 该草案用于定义 ASR、LLM、动作、语音之间的标准事件。后续实现时建议用 `zod` 做运行时校验。

### 14.1 ASR 输入事件

```json
{
	"type": "asr.partial",
	"session_id": "sess_xxx",
	"segment_id": "seg_xxx",
	"text": "我想问一下",
	"is_final": false,
	"confidence": 0.86,
	"start_ms": 120,
	"end_ms": 980,
	"ts": 0
}
```

```json
{
	"type": "asr.final",
	"session_id": "sess_xxx",
	"segment_id": "seg_xxx",
	"text": "我想问一下今天的天气怎么样",
	"is_final": true,
	"confidence": 0.93,
	"start_ms": 120,
	"end_ms": 1860,
	"ts": 0
}
```

### 14.2 LLM 增量事件（fast lane）

```json
{
	"type": "llm.delta",
	"session_id": "sess_xxx",
	"request_id": "req_xxx",
	"source": "fast-lane",
	"partial_text": "你在问天气",
	"action_hint": {
		"emotion": "neutral",
		"motion": "thinking",
		"intensity": 0.4,
		"duration_ms": 500,
		"priority": 20,
		"cooldown_ms": 200
	},
	"cancelable": true,
	"ts": 0
}
```

### 14.3 LLM 提交事件（commit lane）

```json
{
	"type": "llm.commit",
	"session_id": "sess_xxx",
	"request_id": "req_xxx",
	"source": "commit-lane",
	"reply_text": "今天晴，最高温度 28 度。",
	"action_intent": {
		"emotion": "happy",
		"motion": "nod",
		"intensity": 0.6,
		"duration_ms": 700,
		"priority": 50,
		"cooldown_ms": 300
	},
	"meta": {
		"model": "qwen-xxx",
		"latency_ms": 420
	},
	"ts": 0
}
```

### 14.4 动作执行事件

```json
{
	"type": "action.dispatch",
	"session_id": "sess_xxx",
	"request_id": "req_xxx",
	"intent": {
		"emotion": "happy",
		"motion": "nod",
		"intensity": 0.6,
		"duration_ms": 700,
		"priority": 50,
		"cooldown_ms": 300
	},
	"reason": "commit",
	"ts": 0
}
```

### 14.5 语音输出事件

```json
{
	"type": "voice.start",
	"session_id": "sess_xxx",
	"request_id": "req_xxx",
	"text": "今天晴，最高温度 28 度。",
	"provider": "gpt-sovits",
	"ts": 0
}
```

```json
{
	"type": "voice.first_chunk",
	"session_id": "sess_xxx",
	"request_id": "req_xxx",
	"latency_ms": 380,
	"ts": 0
}
```

```json
{
	"type": "voice.end",
	"session_id": "sess_xxx",
	"request_id": "req_xxx",
	"duration_ms": 2140,
	"ts": 0
}
```

### 14.6 取消事件

```json
{
	"type": "task.cancel",
	"session_id": "sess_xxx",
	"request_id": "req_xxx",
	"target": "fast-lane|commit-lane|voice",
	"reason": "new-final-arrived",
	"ts": 0
}
```

---

## 15. 流式链路验收标准（新增）

1. `partial -> fast action` 首次反馈 < 350ms
2. `final -> commit text` < 800ms
3. `final -> tts first chunk` < 900ms
4. 取消成功率 > 99%
5. partial 误触发正式播报次数 = 0

---

## 16. 分步实施方案（可中断续做）

本节用于记录“当前进度 + 下一步入口”，确保开发中断后可以快速恢复。

### 16.1 执行原则

1. 每个阶段独立可运行、可回滚
2. 每个阶段完成后都做最小验收与日志留痕
3. 先动作后语言，先稳定后复杂

### 16.2 阶段总览

1. 阶段 1：极简动作控制器（shake_head / blink / mouth）
2. 阶段 2：LLM 结构化输出（Qwen）
3. 阶段 3：RAG 最小版（角色卡 + 最近摘要 + 能力表）
4. 阶段 4：TTS（GPT-SoVITS）并行动作
5. 阶段 5：流式 ASR -> fast/commit 双通道
6. 阶段 6：观测与压测收敛

### 16.3 阶段 1（已实现）

目标：

- 不依赖新增美术资源，只用 Live2D 参数实现轻动作
- 动作输入结构化、可校验、可仲裁、可安全降级

已完成内容：

1. 动作协议与类型

- `src/AI/types/action.ts`
- 定义 `shake_head | blink | mouth` 及归一化结构

2. 运行时校验

- `src/AI/types/action.schema.ts`
- 使用 `zod` 对动作输入做范围校验（已移除 `finite()`）

3. 归一化与默认策略

- `src/AI/action/normalize.ts`
- 默认值补齐、范围裁剪、时长/优先级/冷却标准化

4. 模型能力探测

- `src/AI/action/capability.ts`
- 自动识别 `ParamAngleX`、眼睛开闭参数、嘴巴开合参数

5. 动作执行器

- `src/AI/action/executor.ts`
- 参数驱动实现摇头、眨眼、张嘴

6. 动作控制器

- `src/AI/core/actionController.ts`
- 串联：校验 -> 归一化 -> 去重/冷却 -> 优先级 -> 执行

7. 渲染侧接入

- `src/renderer/components/pet/hooks/usePetModel.ts`
- 在 `model.on('update')` 每帧执行 `tick`
- 模型销毁/切换时正确 `dispose`

8. 调试入口（无 IPC）

- `window.__PET_AI_ACTION__.dispatch(...)`
- `window.__PET_AI_ACTION__.blink()`
- `window.__PET_AI_ACTION__.mouth()`
- `window.__PET_AI_ACTION__.shakeHead()`
- `window.__PET_AI_ACTION__.capability()`

阶段 1 验收建议：

1. `capability()` 返回与模型参数一致
2. 三个动作可触发且不会引发报错
3. 参数缺失时动作安全跳过
4. 连续触发无明显卡顿或堆积

### 16.4 阶段 2（已实现）

目标：

- 接入 Qwen，输出严格 JSON：`reply_text + action_intent`

任务清单：

1. 新增 `src/AI/llm/client.ts`（OpenAI 兼容调用）
2. 新增 `src/AI/llm/prompt.ts`（强约束 JSON 模板）
3. 新增 `src/AI/llm/parse.ts`（`zod` 校验 + 降级策略）
4. 将 `action_intent` 对接 `Live2DActionController.dispatch`

验收：

1. 解析失败不影响 UI 与动作循环
2. 结构化输出成功率达到目标

### 16.5 阶段 3（已实现 V1）

目标：

- 接入轻量 RAG，提高角色稳定性

已完成内容：

1. `src/AI/rag/retriever.ts`

- 轻量文本检索器，基于分段 + chunk + 词项覆盖率打分
- 支持 `topK/threshold` 默认推荐值

2. `src/AI/rag/contextBuilder.ts`

- 统一拼装 `rag.profile + rag.retrieval + 动作能力表 + 知识片段`
- profile 字段当前为：`personal/speakingStyle/relation/banned/world`

3. `Stage2Runtime` 已接入 RAG

- `ask()` 前自动读取当前模型 `rag` 配置
- 若存在知识库文件，则通过 Electron 只读桥加载文本
- 将命中的知识片段与角色设定一起并入 LLM prompt

4. Electron 最小文件桥

- 新增 `pet:readRagTextFile`
- 支持绝对路径，以及相对当前模型目录 / app 路径 / public 目录的解析

5. 调试入口

- `window.__PET_AI_STAGE2__.previewRag(text)`：预览当前输入的 RAG 上下文
- `window.__PET_AI_STAGE2__.ask(text)`：正式走 LLM + RAG + 动作链路

验收：

1. 无知识库文件时自动回落，仅使用 profile 与能力表
2. 有知识库文件时可命中 TopK 片段并接入 LLM
3. 解析或文件读取失败不影响阶段 2 基本回复链路

### 16.5.1 阶段 3.5（V1 已形成最小闭环，方案 A）

目标：

- 将“最近对话”纳入 RAG，但不污染模型配置文件
- 控制上下文体积，避免随会话增长导致响应变慢

已确认方案：

- 方案 A：文件存储 + 最近窗口 + 滚动摘要 + 内存缓存

当前实现状态：

- 已完成：按模型拆分存储目录
- 已完成：Electron memory 文件骨架、归一化、IPC 读写桥
- 已完成：Stage2Runtime 在 `ask()` 前读取 memory，并将其拼入 RAG 上下文
- 已完成：Stage2Runtime 在 LLM 成功返回后回写最近对话到 `recent.json`，并同步更新 `meta.json`
- 已完成：`summary.json` 的最小自动摘要生成与滚动压缩
- 未完成：渲染侧/控制面板的可视化管理入口
- 未完成：独立的内存级缓存与更精细的摘要调度器

不采用的做法：

- 不把最近对话直接写入 `config/models/<model>.json`
- 不在当前阶段直接引入 SQLite/LanceDB 作为必选路径

推荐目录：

- `config/<modelKey>/<modelKey>.json`
- `config/<modelKey>/memory/recent.json`
- `config/<modelKey>/memory/summary.json`
- `config/<modelKey>/memory/meta.json`

职责划分：

1. `config/<modelKey>/<modelKey>.json`

- 保存该模型的静态配置
- 包括 `rag.profile`、`rag.retrieval` 与其它模型级配置
- 不写入高频会话数据

2. `recent.json`

- 保存最近窗口消息
- 当前运行时写入上限：最近 12 条 message
- 当前 prompt 拼装窗口：最近 6 条 message
- 用于短期上下文拼装

3. `summary.json`

- 保存滚动摘要
- 仅保留对后续回复有价值的稳定信息
- 当前已支持在最近未摘要消息达到阈值时自动生成内容

4. `meta.json`

- 保存消息计数、最后摘要位置、更新时间等元数据
- 作为摘要触发与窗口裁剪的辅助状态
- 当前已实际写入：`messageCount`、`lastSummarizedCount`、`lastMessageAt`、`updatedAt`
- `lastSummarizedCount` 现已用于判断是否触发下一轮滚动摘要

上下文拼装顺序：

1. `rag.profile`
2. `conversation summary`
3. `recent messages window`
4. `knowledge retrieval chunks`
5. `action capability`

当前接入位置：

1. `src/AI/core/stage2Runtime.ts`

- `resolveRagRuntime()`：读取当前模型 `memory` 并传给 `buildRagContext`
- `persistConversationMemory()`：在成功回复后回写 `recent/meta`

2. `src/AI/rag/contextBuilder.ts`

- 负责将 `summary + recent window` 与原有 `rag.profile/knowledge/capability` 一并拼装为 prompt 上下文

3. Electron 桥

- `pet:getModelMemory`
- `pet:updateModelMemory`
- 当前提供基础读写；摘要调度发生在 Stage2Runtime 成功回写 memory 时

窗口与压缩策略（V1 建议）：

- 最近窗口：保留最近 6~10 条消息
- 未摘要消息超过 20~30 条时触发一次摘要
- 摘要目标长度控制在约 120~300 字
- 摘要硬上限不超过 400 字
- Prompt 中不直接拼接完整历史对话

摘要长度说明：

- 300~800 字对当前桌宠场景偏长，会明显挤占 prompt 预算
- 当前还有 `rag.profile`、最近窗口、知识片段与动作能力表共同参与上下文拼装
- 因此摘要应优先追求信息密度，而不是长文本完整复述

摘要保留内容：

- 用户稳定偏好
- 已确认事实
- 关系变化
- 当前长期话题
- 未完成事项或承诺

摘要不保留内容：

- 普通寒暄
- 重复情绪表达
- 已失效上下文
- 可由最近窗口直接覆盖的短期内容

运行时策略：

- 写入层：最近窗口与摘要分别写入 `recent.json` / `summary.json`
- 缓存层：内存中保留最近窗口与当前摘要
- 读取层：`ask()` 优先读取内存缓存，冷启动再读文件

当前实际行为（截至本轮实现）：

- 读取层：`ask()` 前从 Electron 读取当前模型的 `recent/summary/meta`
- Prompt 层：把“最近对话摘要”和“最近对话窗口”拼进 RAG 上下文
- 写入层：在 `ask()` 成功后回写 `recent.json` 与 `meta.json`
- 摘要层：当最近未摘要消息达到阈值时，自动生成新的 `summary.json`，并推进 `lastSummarizedCount`
- 缓存层：尚未建立独立 memory cache，当前以文件读取 + Runtime 临时使用为主

V1 精简原则：

- 当前不额外引入 `history.jsonl`
- 先用 `recent + summary + meta` 三文件满足最近对话接入
- 若后续确实需要完整原始追溯，再追加历史日志文件

当前已验证：

1. memory 不再写入模型静态配置文件
2. 每个模型目录会自动创建 `memory/recent.json`、`summary.json`、`meta.json`
3. AI 主链路已能读取 memory 参与回复，并在回复成功后写回最近对话
4. 最近对话在达到阈值后会自动滚动生成摘要，形成 `recent -> summary -> prompt -> writeback` 的最小闭环
5. 当前改动已通过项目构建验证

当前阶段范围说明：

- 当前只围绕三条链路推进：ASR、TTS、对话 AI
- 视觉信号暂不进入阶段 3.5 的记忆设计

后续升级路径：

1. 先完成文件方案 A
2. 再根据体量决定是否迁移到 SQLite
3. 若长期记忆需要语义检索，再接入向量库

### 16.6 阶段 4（待实现）

目标：

- 文本、动作、语音并行

范围：

- 采用 GPT-SoVITS 本地 HTTP 服务（`api_v2.py`）作为 TTS Provider
- 以 Electron 主进程为统一代理层（Renderer 不直接跨域请求 Python 服务）
- 每个模型拥有独立 TTS 配置，避免不同角色互相污染

架构结论：

1. Python 端 `api_v2.py` 支持“音频流式返回”，但不是标准 SSE（`text/event-stream`）
2. 长连接能力由服务端决定，前端仅消费流
3. 本项目采用：`Renderer -> IPC -> Electron Main -> GPT-SoVITS HTTP`
4. 不建议 Renderer 直接请求 `127.0.0.1:9880`，避免 CORS/路径暴露/参数绕过校验

#### 16.6.1 每模型配置（新增）

在模型独立配置中新增 `tts` 节点（示例字段）：

```json
{
	"tts": {
		"enabled": true,
		"provider": "gpt-sovits",
		"baseUrl": "http://127.0.0.1:9880",
		"gptWeightsPath": "GPT_weights_v2Pro/murasame_ja_v1-e24.ckpt",
		"sovitsWeightsPath": "SoVITS_weights_v2Pro/murasame_ja_v1_e16_s3056.pth",
		"textLang": "ja",
		"promptLang": "ja",
		"refAudioPath": "",
		"refAudioText": "",
		"textSplitMode": "cut4",
		"speedFactor": 1.0,
		"fragmentInterval": 0.3,
		"useLastGeneratedAsRef": false,
		"topK": 20,
		"topP": 0.8,
		"temperature": 0.5
	}
}
```

说明：

- `gptWeightsPath` 与 `sovitsWeightsPath` 为模型级路径，不放全局共享配置
- `refAudioPath`、`refAudioText` 也应按模型隔离
- `textLang/promptLang` 由模型默认值提供，UI 可覆盖

#### 16.6.2 参数与 UI 约束（按产品需求）

语言选择：

- 中文、日语、英语、韩语、粤语

文本切分（产品枚举）：

- 四字切
- 50 字切
- 中文逗号
- 英文逗号
- 标点符号
- 不切

建议映射到 GPT-SoVITS `text_split_method`（项目内统一映射，不在 UI 直接暴露底层字符串）。

数值参数：

- `speedFactor`: 0~2，步长 0.01，默认 1.00
- `fragmentInterval`: 0~0.5，步长 0.01，默认 0.30
- `topK`: 1~100，步长 1，默认 20
- `topP`: 0~1，步长 0.01，默认 0.80
- `temperature`: 0~1，步长 0.01，默认 0.50

文件类输入：

- GPT 权重路径（文件选择）
- SoVITS 权重路径（文件选择）
- 参考音频路径（文件选择）
- 参考音频文本（文本框）

#### 16.6.3 运行时编排（Main 侧）

建议新增：

1. `src/AI/voice/gptSovitsClient.ts`
2. `voiceQueue`（串行、可中断）
3. `voice runtime manager`（位于 Electron Main）

主流程：

1. 接收 LLM `reply_text`
2. 立即触发预备动作（不等待 TTS）
3. 发出 `voice.start`
4. 调用 GPT-SoVITS `/tts`
5. 收到首块音频后发出 `voice.first_chunk`
6. 播放结束发出 `voice.end`
7. 失败时发出 `voice.error` 并降级到“文本 + 静默动作”

中断策略：

- 新请求到来可取消在途 `voiceQueue` 项
- 支持 `AbortSignal`
- 保证同一会话只有一个正在播放的语音任务

#### 16.6.4 生命周期事件（最小集合）

```json
{ "type": "voice.start", "request_id": "req_xxx", "provider": "gpt-sovits", "ts": 0 }
{ "type": "voice.first_chunk", "request_id": "req_xxx", "latency_ms": 0, "ts": 0 }
{ "type": "voice.end", "request_id": "req_xxx", "duration_ms": 0, "ts": 0 }
{ "type": "voice.error", "request_id": "req_xxx", "error": "...", "ts": 0 }
```

#### 16.6.5 与 transformer.js 的关系（评估结论）

结论：

- `transformer.js` 适合纯文本/通用 Transformer 推理场景
- 当前 GPT-SoVITS 属于语音生成链路（包含声学/声码器流程），不建议在本阶段迁移到 `transformer.js`

本阶段建议：

1. 保留 Python TTS 服务作为语音后端
2. Electron Main 做统一代理与参数校验
3. 后续若确实需要打包一体化，再评估 ONNX/WebGPU 方向

#### 16.6.6 任务清单（更新）

1. 新增 `src/AI/voice/gptSovitsClient.ts`（HTTP 客户端 + 参数映射 + 错误归一化）
2. 建立 `voiceQueue`（串行、可取消、latest-wins 策略）
3. 增加 `voice.start/first_chunk/end/error` 生命周期事件
4. 在模型配置中新增 `tts` 独立节点（路径、语种、切分、采样参数）
5. 增加权重切换与配置热更新（`set_gpt_weights` / `set_sovits_weights`）
6. 主进程统一代理 TTS 请求，Renderer 不直连 Python

验收：

1. 首音频包延迟达标（目标 < 900ms）
2. 语音失败可降级为文本 + 静默动作
3. 模型切换后可自动加载对应 TTS 配置
4. 取消与打断行为可复现且稳定

### 16.7 阶段 5（待实现）

目标：

- 建立 fast lane（partial）与 commit lane（final）

任务清单：

1. `asr.partial` 只触发可撤销轻动作
2. `asr.final` 触发正式文本/动作/语音
3. 全链路取消（`task.cancel` + AbortSignal）

验收：

1. partial 误触发正式播报次数为 0
2. 取消成功率达标

### 16.8 阶段 6（待实现）

目标：

- 完整观测与压测闭环

任务清单：

1. 统一指标：`llm_first_token_ms`、`action_dispatch_ms`、`tts_first_packet_ms`
2. 压测脚本：高频输入、打断风暴、超时降级
3. 形成 `docs/ai-perf.md` 的基线数据

### 16.9 中断恢复清单

恢复开发时按以下顺序检查：

1. 当前分支是否保留阶段 1 文件
2. `window.__PET_AI_ACTION__.capability()` 是否可用
3. 三动作手动触发是否正常
4. 再进入下一阶段开发（从阶段 2 开始）

推荐恢复命令（在控制台）：

```js
window.__PET_AI_ACTION__.capability()
window.__PET_AI_ACTION__.blink()
window.__PET_AI_ACTION__.mouth()
window.__PET_AI_ACTION__.shakeHead()
```

