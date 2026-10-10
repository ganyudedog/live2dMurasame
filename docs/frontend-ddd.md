# 前端服务与 DDD 分层

## 目录约定

- 多能力模块统一采用“业务能力在外，技术分层在内”。模块根目录保留主服务和聚合 UI；业务子模块集中在 `modules/`，各自独立做 DDD 分层。不按每个服务机械创建业务域。
- `service/`、`services/` 仅存放 `*Service.ts` 服务类；子服务也使用同样命名。
- `domain/` 存放业务模型、类型、校验、解析、配置归一化及纯计算规则，不依赖服务、UI 或外部适配器。
- `application/` 存放请求级用例与流程协调，例如本轮对话的句子分发，不承担浏览器或网络 I/O。
- `infrastructure/` 存放网络协议映射、HTTP、SDK、浏览器音频、文件和持久化适配器。
- `ui/` 存放展示与通知适配器，服务通过回调报告错误，不直接调用通知组件。
- `module.ts` 是模块唯一注册入口，注册定义集中在此处。`modules/` 是业务子模块目录，不是注册目录，子模块内不设置注册入口；测试不放入服务目录。

## AI 业务域

```text
ai/
  module.ts
  service/AiService.ts
  tests/
  modules/
    llm/
      service/LlmService.ts
      service/RagService.ts
      domain/{replyParser,prompt,config,memory,rag,...}
      infrastructure/{llmClient,configRepository,LlmMemoryRepository}
      tests/
    tts/
      service/TtsService.ts
      service/LiveKitService.ts
      service/TtsPlaybackFeedbackService.ts
      application/sentenceDispatcher.ts
      domain/{types,config,requestPolicy,livekit/ReceiverBufferPolicy}
      infrastructure/{ttsClient,TtsStreamPlayer,TtsAudioCapture,audioArtifactWriter,...}
      infrastructure/livekit/{LiveKitPort,LiveKitGateway,httpClient,protocol,protocolMapper,...}
      ui/notifications.ts
      tests/
    asr/
      service/AsrService.ts
      domain/{audio,config}
      infrastructure/asrAudioCapture.ts
      tests/
```

`AiService` 只协调聊天、流式显示、语音提交及插件入口。`LlmService` 管理对话请求，委托 `RagService` 读取知识和保存记忆。`TtsService` 管理预热、合成、播放、取消及音频诊断，委托 `LiveKitService` 管理实时连接，委托 `TtsPlaybackFeedbackService` 管理反馈。`AsrService` 独立管理识别后端与麦克风启停。

控制面板只调用 `TtsService`，不直接依赖 LiveKit、合成客户端或播放器。TTS 适配器使用 `LiveKitPort` 契约，不反向依赖业务服务类。

## 其他业务模块

```text
live2d/
  module.ts
  service/Live2dService.ts
  ui/{PetCanvas,hooks,...}
  modules/
    model/{runtime,ui}
    motion/service/MotionService.ts
    layout/{domain,infrastructure,service,ui,tests}
    bubble/{domain,runtime,ui,tests}
    interaction/{domain,runtime,service,ui,tests}
    actions/{domain,infrastructure,service}

control-panel/
  module.ts
  service/ControlPanelService.ts
  domain/{configuration,defaults,types}
  ui/{ControlPanel,ControlPanelLayout,...}
  modules/
    interaction/{domain,service,ui,tests}
    chat/infrastructure/chatSessionCache.ts
```

`Live2dService` 保留模型展示的统一编排，能力目录收拢各自实现。布局的窗口事务仍由 `Live2dLayoutService` 独占，动画调度服务为 `MotionService`，参数动作协调为 `Live2dActionService`。气泡与模型的共享展示版本、测量和三矩形规则保持原样。

控制面板根目录保留聚合页面和模块级配置类型；交互配置子服务与其规则、页面、测试独立归组。单能力模块直接在模块内分层，不额外创建只有一个能力的嵌套目录。共享平台服务和核心容器不按业务能力机械拆分。

## 注册入口

全局加载器仅扫描业务模块根部的 `module.ts`。简单模块导出 `serviceModule`；AI 在根部 `ai/module.ts` 内定义并导出 `serviceModules`，以保留各项服务不同的窗口启用范围，但没有额外的注册文件或子模块注册入口。加载器展开定义后，统一按窗口类型筛选、完成注册，再解析 eager 服务。业务子模块通过服务和类型被使用，不参与全局入口发现，也不让主服务接管容器的生命周期。

## 生命周期

容器先启动依赖服务，再启动消费服务，逆序释放。`AiService` 不再自行创建或释放 LLM、TTS、ASR。`LlmService` 负责释放其内部 RAG 子服务，`TtsService` 负责释放其内部反馈服务和播放器；LiveKit 由容器统一释放，避免重复释放或漏启动。

应用仅保留宠物和控制面板两种窗口。只有宠物窗口启动 LLM、ASR 和自动 TTS 预热；控制面板可解析 TTS，但不会启动麦克风或自动预热。ASR 启停串行执行，释放会等待尚未完成的启停操作。

`src/app/core/architecture.test.ts` 检查服务目录、AI 领域依赖和 TTS 消费边界；各域测试覆盖注册与生命周期。迁移没有修改气泡布局规则，也没有移除已有 TTS 离线音频诊断。
