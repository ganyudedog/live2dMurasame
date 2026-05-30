# ASR 完整链路架构文档

> 最后更新：2026-05-19
> 目标架构：onnx-web 前端推理，无 SAB，无跨进程音频传输

---

## 一、架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│  PetCanvas（主窗口，始终在线）                                        │
│                                                                      │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐   │
│  │ onnx-web ASR 引擎        │    │ Chat 管道                    │   │
│  │                          │    │                              │   │
│  │ getUserMedia(mono)       │    │ Stage2Runtime.ask()          │   │
│  │   → AudioContext         │    │   LLM 流式请求               │   │
│  │   → AudioWorkletNode     │    │ TtsRuntime.speakFromQwenReply│   │
│  │   → PCM 帧 → onnx-web    │    │   LiveKit 房间音频播放       │   │
│  │   → 识别结果             │    │                              │   │
│  └──────────┬───────────────┘    └──────────────┬───────────────┘   │
│             │                                    │                   │
│             │ dispatchPatch(chat.request)         │ dispatchPatch     │
│             │ source='asr'                       │ (chat.response)   │
│             └────────────┬───────────────────────┘                   │
└──────────────────────────┼──────────────────────────────────────────┘
                           │
                  ┌────────┴────────┐
                  │  SharedWorker   │
                  │                 │
                  │  SharedState    │
                  │   asr.enabled   │
                  │   chat.request  │
                  │   chat.response │
                  │   config.*      │
                  └────────┬────────┘
                           │
┌──────────────────────────┼──────────────────────────────────────────┐
│  ControlPanel（控制面板，可选开关）                                    │
│                                                                      │
│  文字输入 → dispatchPatch(chat.request)                               │
│  subscribe chat.request (source='asr') → 创建用户消息 UI               │
│  subscribe chat.response → 流式更新 assistant 消息 UI                  │
│  配置修改 → dispatchPatch(config.*)                                    │
│  ASR toggle → dispatchPatch(asr.enabled)                              │
└─────────────────────────────────────────────────────────────────────┘
```

### 核心原则

| 职责 | 执行端 | 说明 |
|------|--------|------|
| ASR 识别 | **PetCanvas** | onnx-web 全在渲染进程内完成 |
| LLM 请求 | **PetCanvas** | Stage2Runtime.ask() |
| TTS 合成 | **PetCanvas** | TtsRuntime.speakFromQwenReply() |
| 音频播放 | **PetCanvas** | LiveKit 房间下行 |
| 聊天 UI | **ControlPanel** | 纯界面，不执行 LLM/TTS |
| 配置管理 | **ControlPanel** | 通过 SharedWorker 同步到 PetCanvas |

---

## 二、数据流

### 2.1 音频采集 → ASR 识别（全在 PetCanvas 进程内）

```
麦克风 → getUserMedia({ channelCount: 1, echoCancellation: true, noiseSuppression: true })
  → AudioContext({ latencyHint: 'interactive' })
  → AudioWorkletNode (PCM 帧采集)
  → onnx-web (前端 WASM 推理)
  → 识别文本
```

**无需** SharedArrayBuffer、跨进程通信或主进程参与。onnx-web 的 WebAssembly 运行时直接消费 AudioWorklet 产出的 PCM 帧。

### 2.2 ASR 文本 → LLM → TTS

```
PetCanvas onnx-web 识别完成
  │ 创建 ChatRequest { id, text, source:'asr', status:'pending' }
  │
  ├── dispatchPatch({ path:'chat.request', value: request })
  │     → SharedWorker 广播 → ControlPanel 创建用户消息 UI
  │
  └── 本地直调 processChatRequest(request, config)
        └── Stage2Runtime.ask(text, { onDisplayTextStreaming })
              │ 流式 → dispatchPatch({ path:'chat.response', value: { displayText, status:'streaming' } })
              │ LLM 完成 → speakText
              └── TtsRuntime.speakFromQwenReply({ requestId, speakText, displayText })
                    └── LiveKit 房间 → 音频播放
```

### 2.3 文字输入 → LLM → TTS

```
ControlPanel handleChatSubmit
  → 本地创建 userMessage + pendingMessage
  → dispatchPatch({ path:'chat.request', value: { id, text, source:'text', status:'pending' } })
           ↓ SharedWorker 广播
PetCanvas subscribe chat.request (source='text', pending)
  → processChatRequest → Stage2Runtime.ask()
  → 流式 dispatchPatch chat.response → TtsRuntime.speakFromQwenReply()
           ↓ SharedWorker 广播
ControlPanel subscribe chat.response → 流式更新 assistant 消息 UI
```

---

## 三、SharedWorker Chat 管道

Chat 管道是 PetCanvas 和 ControlPanel 之间唯一的通信桥梁。`speakText` 不在 SharedWorker 中共享，仅在 PetCanvas 本地流转。

### 3.1 SharedState 类型

```ts
interface ChatRequest {
  id: string;
  text: string;                                    // 用户输入文本
  source: 'text' | 'asr';                          // 来源
  status: 'pending' | 'processing' | 'done' | 'error';
  createdAt: number;
}

interface ChatResponse {
  id: string;                                      // 对应 ChatRequest.id
  displayText: string;                             // 展示文本（流式更新）
  status: 'streaming' | 'done' | 'error';          // speakText 不跨窗口
  error: string | null;
  updatedAt: number;
}

interface ChatConfig {
  apiKey: string;
  baseURL: string;
  displayLang: 'zh' | 'en' | 'ja' | 'ko';
  ttsMediaType: 'wav' | 'ogg' | 'aac';
  ttsStreamingMode: boolean;
}

type SharedState = {
  rev: number;
  global: { scale: number };
  asr: {
    enabled: boolean;
    state: 'off' | 'active' | 'error';
    lastUpdatedAt: number;
  };
  config: ChatConfig;
  chat: {
    request: ChatRequest | null;
    response: ChatResponse | null;
  };
};
```

### 3.2 PatchOp 路径

```
global.scale                          // 标量，滑块实时同步
asr.enabled / asr.state              // 标量，开关与状态
config.apiKey / config.baseURL / ... // 标量，配置字段
chat.request                         // 完整 ChatRequest 对象
chat.response                        // 完整 ChatResponse 对象
```

### 3.3 粒度策略

- 标量 / 独立字段（`config.*`、`asr.*`）→ 细粒度路径，避免全量覆盖
- 复合对象（`chat.request`、`chat.response`）→ 粗粒度路径，一次传完整对象，减少 op 数量

### 3.4 调用示例

```ts
// ControlPanel 文字输入 → 委托给 PetCanvas
sharedStoreClient.dispatchPatch([{
  path: 'chat.request',
  value: { id: 'req_1', text: 'こんにちは', source: 'text', status: 'pending', createdAt: Date.now() }
}]);

// PetCanvas LLM 流式响应 → 回写 displayText
sharedStoreClient.dispatchPatch([{
  path: 'chat.response',
  value: { id: 'req_1', displayText: '你好，今天过得如', status: 'streaming', error: null, updatedAt: Date.now() }
}]);

// ControlPanel 配置修改 → 同步到 PetCanvas
sharedStoreClient.dispatchPatch([
  { path: 'config.apiKey', value: 'sk-xxx' },
  { path: 'config.baseURL', value: 'https://api.example.com' },
  { path: 'config.displayLang', value: 'ja' },
]);
```

---

## 四、文件清单

| 文件 | 职责 |
|------|------|
| `src/renderer/components/pet/audio/asrCapture.worklet.ts` | AudioWorklet 处理器（PCM 采集 → onnx-web 输入） |
| `src/renderer/components/pet/audio/asrAudioCapture.ts` | 音频采集控制器（getUserMedia + AudioContext + AudioWorkletNode） |
| `src/renderer/components/pet/PetCanvas.tsx` | ASR 运行时 + Chat 管道 + LLM + TTS |
| `src/renderer/components/pet/hooks/useChatBridge.ts` | Chat 管道封装（配置同步 + chat.request 订阅 + ASR → chat.request） |
| `src/renderer/components/pet/hooks/useChatRuntime.ts` | LLM + TTS 运行时（Stage2Runtime + TtsRuntime） |
| `src/renderer/shared/sharedStateTypes.ts` | SharedState 类型定义 + PatchOp 路径 |
| `src/renderer/shared/sharedStore.worker.ts` | SharedWorker 状态管理（applyOp + 合帧广播） |
| `src/renderer/shared/sharedStoreClient.ts` | SharedWorker 客户端（dispatchPatch + subscribe） |
| `src/renderer/shared/sharedWorkerAsrStore.ts` | ASR 状态订阅（useSyncExternalStore） |
| `src/renderer/components/controlPanel/ControlPanel.tsx` | 控制面板（chat 委托 SharedWorker，无 LLM/TTS 运行时） |
| `src/renderer/components/controlPanel/pages/HomePage.tsx` | 首页 UI（对话区 + 麦克风开关） |
| `src/AI/core/stage2Runtime.ts` | LLM 运行时（流式请求 + 双文本输出） |
| `src/AI/tts/runtime.ts` | TTS 运行时（LiveKit 房间合成 + 播放） |

### 删除/不再需要的文件

| 文件 | 原因 |
|------|------|
| `electron/main/asrIpc.js` | ASR 引擎移至前端 onnx-web，主进程不再运行 sherpa-onnx |
| `electron/preload.js` (AsrAPI 部分) | ASR 不再需要 preload IPC 桥接 |
| `electron/main.js` (SAB 相关) | 不再需要 SAB 及对应的 COOP/COEP header 注入 |
| `vite.config.ts` (COOP/COEP) | onnx-web WASM 不需要 crossOriginIsolated |

---

## 五、关键设计决策

### 5.1 onnx-web 前端推理

ASR 识别从主进程 sherpa-onnx 迁移到前端 onnx-web WebAssembly 运行时：

- **优势**：消除跨进程 SAB 传输问题，降低架构复杂度
- **性能**：WASM 推理在渲染进程的 AudioWorklet 线程中执行，不阻塞 UI
- **模型加载**：首次启用 ASR 时异步加载 onnx 模型文件到 WASM 运行时

### 5.2 Chat 管道通过 SharedWorker

- `speakText` 不跨窗口同步（仅在 PetCanvas 本地流转 LLM → TTS）
- `displayText` 通过 SharedWorker 广播到 ControlPanel 展示
- PetCanvas 是唯一 LLM/TTS 执行端，ControlPanel 纯 UI

### 5.3 ASR final 本地直调

PetCanvas 收到 onnx-web 识别结果后：
- `dispatchPatch({ path:'chat.request', ... })` → SharedWorker → ControlPanel 展示用户消息
- 本地直调 `processChatRequest()` → 不经 Worker 绕路，避免自循环

### 5.4 ASR 状态管理

- `asr.enabled` 通过 SharedWorker 跨窗口同步
- PetCanvas 监听 `asr.enabled` 变化 → 启动/停止 onnx-web 引擎 + 音频采集
- ControlPanel toggle 仅 dispatch `asr.enabled` patch

### 5.5 配置同步

- ControlPanel 修改 AI 配置 → 同步 dispatch `config.*` patches 到 SharedWorker
- PetCanvas 首次挂载从 `ConfigAPI` 拉取，后续通过 SharedWorker patched 事件增量更新
- `globalAiDraft.onCommit` 中同时调用 `updateGlobalModelConfig`（持久化）+ `sharedStoreClient.dispatchPatch`（实时同步）

---

## 六、后续待实施

| 任务 | 说明 |
|------|------|
| onnx-web 模型加载 | 集成 sherpa-onnx WASM 到渲染进程 |
| AudioWorklet → onnx-web 数据管道 | PCM 帧直接送入 WASM 推理引擎 |
| 移除 AsrAPI | 清理 preload.js 中 ASR 相关 IPC handler |
| 移除 asrIpc.js | 主进程不再运行 sherpa-onnx |
| ControlPanel LiveKit 房间 | 加入 LiveKit 但不播放音频（订阅丢弃） |
