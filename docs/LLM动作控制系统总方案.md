# LLM 动作控制系统落地方案

更新：2026-10-15。本稿统一配置生成、Electron 持久化和参数动画执行协议，替代原生 motion 别名表及旧 targets 姿态方案。

## 1. 产品边界

日常 LLM 只从当前模型动作表选择 `action_id`。配置 LLM 读取模型真实动作参数，生成可编辑的参数动画。用户在动作设置中重新生成、预览、用 @ 引用、拖入对话、增删和微调。语音优先，动作 best-effort，不阻塞 TTS。

生成动作不包含 sound、原生文件路径、group/index 来源引用或旧 targets 字段；不调用 MotionService 播放原生动作，不用延迟暂停音频的补丁。

## 2. 服务归属和数据路径

```text
Electron ModelEnvironmentService
  ├─ ActionSourceReader → model3 / motion3 / cdi3 实际文件
  └─ JsonModelEnvironmentRepository → configDao → 模型配置文件
            ↕ IPC / preload
ElectronService.bridge → ConfigService（注入配置和保存端口）
            ↕
ControlPanelService.actionSettings
  └─ ActionSettingsService（编辑工作区、会话、模型切换、提交）
            → LlmService.actionCatalog
                └─ ActionCatalogService（参数分析、生成、微调）
                    → LlmService.requestStructured（复用连接和模型配置）
            → ConfigService.saveActionCatalog → IPC → 后端校验/DAO/磁盘回读
            → Electron 快照广播 → Pet ConfigService
                ├─ LlmService.ask → 动作语义目录 → 日常对话 prompt
                └─ bindActionCatalog → Live2dService.actions
                    ├─ SentenceActionSchedulerService
                    └─ ActionExecutor（参数关键帧执行）
```

- `ActionCatalogService` 是 LLM 子域服务，由 LlmService 唯一创建；不注册为 controlPanel 的 AI 子服务，不访问 window、缓存、ConfigService 或 IPC。
- 控制面板的 `ActionSettingsService` 只管理编辑用例，调用注入的生成与配置端口，不直接访问 ModelAPI。
- 动作设置组件只接收普通数据快照及 onGenerate / onPreview / onSubmit 等回调，不传入服务实例。
- 编辑对话及草稿缓存属于 control-panel/action-settings/infrastructure，按模型路径隔离。动作表本身以 Electron 配置文件为准。
- LLM 参数和 API 配置沿用现有 Electron → ConfigService → LlmService 的注入链路，不创建第二套连接配置。
- `getConfigSnapshot` 是必需的注入依赖，LlmService 直接调用，RagService 复用同一个 getter；不再经 configRepository 包装，也不读取全局 SnapshotAPI / AIAPI。getter 用于读取实时配置，缺少配置明确报错。
- `module.ts` 构造 LlmService 时注入配置快照读取器及宠物窗口的运行时版本读取器。`ask()` 从 `snapshot.modelConfig.actions` 投影 id/名称/类别/说明，动作目录不再依赖 `bindAiActions` 后置 setter 或 core 挂载；该绑定只连接对话、语音和调度事件。每次请求固定当次目录及模型版本，保存/删除后的下一次请求读取新快照。

## 3. 读取真实动作参数

后端解析每个原生 motion 的 Parameter 曲线：参数 ID、可用 cdi 名称、实际数值范围、时间与数值关键点。支持 linear、bezier、stepped、inverseStepped 四种 segment。Model/PartOpacity 曲线不混入参数动画。

原始文件中逐帧曲线可能很大。分析输入使用每条曲线最多 32 个代表点，包含贝塞尔极值采样，记录 `maxSampleError`。该误差是摘要相对于已采样点的误差，不宣称是连续曲线的数学保证。`observedMin/Max` 是实际曲线观测范围，不等于模型硬边界；运行时仍使用 Cubism 实际参数最小/最大值。

不把文件名或台词当作动作内容。LLM 从实际 samples 推断语义；不确定的自定义参数不得凭空宣称为脸红、害羞等能力，视觉效果由用户预览确认。

兼容 Editor 的 Duration 舍入：末关键帧可在声明时长的一帧导出误差内，分析时长取实际末帧。缺文件、JSON 错误、非法路径或无法解析的曲线明确报错，不生成残缺表。

较大上下文按曲线分批，读取全部 motion，不静默截掉后半部分。各批产生短动作候选，最后统一整理动作表；任一批失败不保存。界面显示批次进度，切换模型取消请求。精调被引用动作时优先提供其涉及的参数曲线，其他参数的观测清单仍可见。

## 4. 单一动作数据契约

`shared/actionCatalog.js` 与 `.d.ts` 定义生成、IPC、DAO 和渲染共用的契约。

```json
{
  "id": "turn_head",
  "label": "转头",
  "category": "head",
  "description": "自然转头后回正",
  "durationMs": 900,
  "enterMs": 200,
  "returnMs": 250,
  "tracks": [{
    "parameterId": "ParamAngleX",
    "keyframes": [
      { "timeMs": 0, "value": 0 },
      { "timeMs": 400, "value": 20 },
      { "timeMs": 900, "value": 0 }
    ]
  }]
}
```

示例数值仅说明结构，实际动作来自模型参数分析与预览微调。

- ID 为小写英文、数字、下划线或短横线，整表不可重复。
- category 为 head/gaze/blink/emotion/body/other；description 可选。
- durationMs 是轨迹长度，enterMs / returnMs 是额外进入和回退时间。首帧时间为 0，后续严格递增且不超出 durationMs。
- 前端线性插值关键帧；曲线末关键帧之后保持最后值直到 durationMs。
- ParamMouthOpenY 保留给音量口型；ParamBreath 保留给本地呼吸。禁止生成这两个轨迹。
- 不再用通用小幅范围压缩动作。模型声明的其他参数也可由动作表控制；缺少某个参数时整项不可执行，不播放残缺动作。
- schema 显式投影成普通 DTO，避免 observable proxy 进入 Electron structured clone。非法整表更新拒绝保存，空数组明确表示删除全部。
- 旧原生别名表没有参数轨迹，不能继续执行，需要重新生成，不回退旧实现。

## 5. 保存与预览

IPC：

| 通道 | 输入 | 结果 |
| --- | --- | --- |
| ddd:modelenv:actions:sources | modelPath | 实际参数轨迹分析数据 |
| ddd:modelenv:actions:save | modelPath、actions | DAO 落盘回读后的模型配置 |
| ddd:modelenv:actions:preview | modelPath、actionId | 验证已保存动作后转发 Pet 窗口 |

保存路径：ConfigService → preload invoke → ModelEnvironmentService 严格校验 → repository → configDao → userData/config/<modelKey>/<modelKey>.json → 清除后端缓存并从磁盘回读 → 广播活动模型快照。

后端验证模型可用参数，整表错误不改盘。repository 的字段清单包含 actions；DAO 加载/规范化保留完整 tracks/时序。修改其他设置不清空动作表。

前端使用后端返回值更新工作区，不用请求原样回填来假装保存成功。保存期间切换模型时，旧结果不会覆盖新模型；preload 广播活动 snapshot，不把被编辑的非活动模型设置为当前模型。

每项动作提供“编辑”入口，直接修改名称和描述（描述可清空）。不调用 LLM，保留稳定 ID、类别、轨迹和时序，经同一保存 IPC 落盘并广播；下一次日常对话和配置微调均读取修正后的语义。保存失败保留原动作与编辑输入，模型切换隔离未完成的编辑。

预览只传模型路径和已保存 actionId，不传 observable 动作对象；Pet 解析本地配置并调用 `Live2dService.actions.dispatch`，与日常动作共用同一个关键帧执行器。IPC accepted 表示指令已转发，实际渲染仍以动作执行诊断为准。

## 6. 运行时、鼠标和音量

保留已有初始动作、随机 Idle、库内置自然运动以及连续鼠标混合；不恢复随机 2～5 秒看一眼方案。

在 beforeModelUpdate 中，原生 Idle、呼吸等先完成，远程轨迹覆盖涉及的参数。远程进入、执行和回退期间暂停整路鼠标权重；结束后 300 ms 平滑恢复本地混合。眼球/头部已有向上保护保留，不恢复旧强制覆盖补丁。

鼠标混合也放入 beforeModelUpdate，在 SDK 保存本地基线之后、动作执行器之前完成。参数随 SDK 帧末 loadParameters 恢复，避免独立 Pixi ticker 的鼠标写入污染下一帧基线。预览使用同一调度优先级：进入、播放、回退全程不执行鼠标写入；气泡和拖动手柄的位置仍正常更新。

进入从实际显示值过渡到轨迹首帧，然后按时间采样。自然结束从末帧回退到当前本地结果；打断从最近实际显示值回退，其他本地参数持续活动。新动作接替时从当前显示状态连续过渡。

口型仅消费播放器/AudioContext 已有音量观察。无法分析或持续静音时恢复正常本地口型，不强行闭嘴。动作配置生成与实时音频链路独立。

SentenceActionSchedulerService 归属 Live2dActionService。跨域绑定先获取 Live2dService，再取 actions，再取 sentenceActionScheduler。运行时模型只得到 id/名称/类别/说明并输出可选 action_intent.action_id；参数曲线不进入日常对话 prompt。

语音优先：动作先到等待对应语音；播放中到达立即尝试执行；语音结束后到达丢弃；无语音的句子就绪即执行。句子结束、人工打断、模型切换按调度状态回退或清理，不等待动作才播语音。

## 7. 诊断与验证

### 对话动作数组执行

```json
{"speak_text":"你好","display_text":"你好","action_intent":{"action_id":[["turn_head","blush"],"blink"]}}
```

外层顺序执行，内层同时执行；上述输入规范化为 `[["turn_head","blush"],["blink"]]`。单个动作使用 `["turn_head"]`；预览的单字符串入口仍可用。最多 8 个阶段，每组最多 4 个动作，不允许更深嵌套或同组重复 ID。执行前校验整条计划的 ID 和可用参数，任意一项无效则拒绝整条动作计划，文本与语音继续。

ActionExecutor 在渲染帧内推进组队列，不新增独立定时器。每个成员按自身 enterMs、durationMs、returnMs 采样；组完成时间取这些总时长的最大值，全部回退后才启动下一组。下一组从当帧本地基线进入，整条计划及回退期间暂停鼠标权重，结束后平滑恢复。

同组动作控制不同参数时并行；相同参数由数组中后列动作独占，不相加或平均，前列动作的其他参数仍执行。后列轨迹提前结束也不会恢复被覆盖的前列轨迹；组仍按所有成员声明的最长总时长等待。提示词要求尽量选择不同部位的组合，冲突情况写入日志。

对应语音结束、人工打断或目录修改时清空待执行组，当前参数从实际显示值平滑回退；新计划替换旧计划时不会继续旧队列。模型切换或渲染故障直接清理执行状态。语音优先，不为播完数组延长语音；无语音句子按自身时间轴执行。

整条计划共用一条 action.execute trace，包含分组、参数冲突、action.groupStarted/action.groupFinished 和取消组数。测试覆盖流式 JSON 任意分片、AI 事件透传、并行独立时长、顺序推进、参数冲突、鼠标暂停及打断后不补播。

运行时同一句调度、接收、首帧、时间轴开始、释放、结束在 action.execute trace 中关联。接收记录含实际 tracks、模型限幅结果；渲染记录是 core 参数读回，不等于视觉验收。`render.timelineStarted` 表示开始采样，不再把连续动画称作 hold。

测试覆盖：模型曲线解码、整表契约、LLM 子服务归属、批次完整性/取消、UI 服务边界、编辑缓存与 @ 引用、模型隔离、真实临时磁盘的 IPC→repository→DAO→重启回读、observable 克隆、预览关键帧、鼠标暂停、打断回退、语音调度。

对话集成测试通过真实 `module.ts` 创建 LlmService，验证保存 IPC→DAO→Live2dEnvironmentService 快照组装→preload store→ConfigService→实际请求 prompt；覆盖宠物和控制面板窗口、执行器未挂载、保存后即时可见、重启回读和清空动作表。`action.capabilitySnapshot` 日志记录来源、模型路径、动作数和版本，区分未保存目录与运行时不可执行问题。

集成测试模拟 Electron 进程传输和 LLM 回复，使用真实文件系统；不等于真实模型的视觉验收，也不代替实际提供商请求验收。主进程/preload 有修改，使用前需完整重启 Electron 后重新生成动作表。

## 8. Prompt cache

日常提示词按“固定规则及输出协议 → 语言与按稳定 ID 排序的动作目录 → 动态 RAG/本次输入”组织。运行时版本、时间戳、请求编号不进入固定前缀。动作描述修改会更新实际发送的目录，服务端仅复用仍相同的前缀，不复用旧回复。

OpenAI 官方端点发送按用途固定的 prompt_cache_key（对话与动作配置分开）；不指定依赖具体模型支持的 retention 字段。DeepSeek 自动进行前缀缓存，不发送 OpenAI 专用缓存字段。其他兼容端点保留完整标准消息，缓存支持及计费由提供商决定。

流式请求开启 stream_options.include_usage，读取没有文本的最终 usage 帧；普通和配置请求读取 response.usage。统一记录 promptTokens、cachedTokens、uncachedTokens、completionTokens 和 cacheStatus，兼容 OpenAI prompt_tokens_details.cached_tokens 与 DeepSeek prompt_cache_hit_tokens / prompt_cache_miss_tokens。缺少统计时为 unreported，不能当作命中或零费用。日常记录在 ask.usage，配置记录在 LlmService.actionCatalog.request 的 prompt-cache.usage。

缓存节省服务端重复计算并按提供商规则计费，Chat Completions 仍发送完整消息，并不会减少网络上传内容；首次请求、前缀不足或缓存过期时不保证命中。依据：[OpenAI Prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)、[DeepSeek 上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache/)。
