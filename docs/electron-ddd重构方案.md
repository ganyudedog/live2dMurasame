# Electron 后端的 DDD 重构评估与方案

本文基于当前项目的 Electron 主进程结构、配置持久化方式、模型记忆读写方式和窗口几何控制方式，评估 `live2denv`、`modelenv`、`windowstate` 三个候选聚合根，并给出渐进式重构方案。

## 一、三个候选聚合根的评估

### 1. `live2denv`

`live2denv` 可以作为一个有效的聚合根。它代表桌宠运行时选择的 Live2D 环境，身份可以是应用级单例，例如 `id = default`。

它可以负责：

- 可用模型路径集合；
- 当前选中的模型路径；
- 默认模型路径或默认路径策略；
- 模型路径的添加、删除、选择和规范化。

它应当维护的核心不变式是：

- 路径经过规范化后不能重复；
- 当前模型为空，或者当前模型属于可用路径集合；
- 添加、删除路径和切换当前模型需要通过同一个入口完成；
- 删除当前模型时，必须同时决定新的当前模型或明确进入空状态。

“默认路径”需要先区分两种含义。如果它是应用内置、不可修改的路径规则，它更适合是一个策略或值对象；如果它是用户可以修改并需要持久化的路径集合，才属于 `live2denv` 的状态。

当前 `electron/live2denv/globalState.js` 中的路径缓存、当前路径和 `live2denv.json` 持久化内容，基本可以演化为这个聚合。模型文件 URL、模型 key 和配置快照则是派生数据或查询结果，不应成为聚合内部的重复状态。

### 2. `modelenv`

`modelenv` 也可以作为模型范围内的聚合，但它的身份必须是某一个具体模型，而不是整个应用。推荐使用 `ModelId` 作为身份，兼容当前实现时可以先由规范化后的模型路径生成 `modelKey`。

它可以负责：

- 当前模型的视觉配置；
- 气泡和交互区域配置；
- RAG 配置；
- TTS 配置；
- 与该模型绑定的记忆数据。

这里要注意：配置和记忆虽然都属于模型环境，但不一定必须属于同一个严格聚合。聚合边界由“一致性要求”决定，而不是由文件目录决定。

当前项目中，模型配置和记忆是独立读写的：配置保存到模型配置文件，记忆保存到 `memory/recent.json`、`summary.json` 和 `meta.json`，记忆还可能比配置更频繁地更新。因此更稳妥的划分是：

- `ModelEnvironment`：模型配置的聚合根；
- `ModelMemory`：同一 `modelId` 下的记忆聚合，属于 `modelenv` 限界上下文。

如果为了保持“三个聚合根”的表达，也可以把二者统称为 `modelenv` 聚合根，但实现时不要每次保存记忆都重新加载并写回完整模型配置。文件分片是持久化策略，不能直接等同于聚合边界；同时，若两个部分没有必须一起提交的一致性规则，就不应强制使用一个大对象和一个大事务。

当前 `electron/modelenv/service.js` 可以演化为 `ModelEnvironment` 的应用服务，`electron/main/modelMemoryIpc.js` 则可以演化为 `ModelMemory` 用例。模型配置和记忆的所有读写都应经过同一个模型身份解析规则，避免同一个模型因为路径格式不同产生多套配置。

### 3. `windowstate`

你指出 `position`、`bounds`、`scale` 是前端 DTO，这个判断仍然正确：DTO 只是跨进程传输结构，不能因为它包含几个字段就成为实体或聚合根。

但现在已经明确有“关闭后恢复上次位置”的业务规则，因此窗口状态不再只是临时运行时事实。它至少应该有一个可持久化的领域概念：`WindowState`。

在当前项目只有一个桌宠主窗口的前提下，把 `WindowState` 放进 `Live2dEnvironment` 是可行的，而且比立即增加一个独立聚合根更合适：

```text
Live2dEnvironment（应用级聚合根，id = default）
├─ ModelPathCollection       值对象
├─ ActiveModelPath           值对象
└─ WindowState               聚合内部实体
   └─ Bounds                 值对象
```

这里的理由不是“窗口脱离 Live2D 就没有意义”，而是当前窗口是这个桌宠运行环境的组成部分，和模型路径、当前模型一起由应用级环境管理，且只有一个主窗口。`WindowState` 有自己的身份和变化过程，因此它更准确地说是 `Live2dEnvironment` 内部的实体，而不是第三个独立聚合根。所有修改仍应通过 `Live2dEnvironment` 的方法完成，例如 `recordWindowBounds`、`restoreWindowState`。

需要保留两个边界：

- `position` 是 `Bounds.x` 和 `Bounds.y` 的投影，不需要单独建模；
- `scale` 当前属于模型或全局显示配置，不应放进原生窗口状态。scale 变化可能导致窗口尺寸变化，但“显示比例配置”和“上次窗口位置”是两条不同的规则。

窗口状态的持久化也不等于每次 `bounds` 变化都立即写磁盘。拖拽和布局调整仍由主进程单写者控制；应用层只在用户拖拽结束或窗口状态稳定后保存，避免高频 I/O。建议默认保存用户位置 `x/y`，窗口宽高继续由当前模型和布局计算决定；如果产品确实要求恢复完整窗口大小，再把 `width/height` 加入持久化策略，并明确它和布局自动缩放之间的优先级。

启动时应按以下规则恢复：

1. 读取 `Live2dEnvironment` 中的持久化窗口状态；
2. 校验数值、窗口最小尺寸和显示器工作区；
3. 状态不存在或已失效时，不生成伪造的默认值，直接使用 Electron 默认窗口位置；
4. 状态有效时，在窗口显示前应用恢复位置；
5. 后续只把用户拖拽产生的最终位置记入 `WindowState`，由模型布局引起的尺寸调整不覆盖用户位置。

如果未来出现多个独立窗口、窗口可以脱离桌宠单独恢复，或者窗口状态需要独立部署和独立演化，再把 `WindowState` 提升为以 `WindowId` 为身份的独立聚合根。当前阶段没有这个必要。

## 二、建议的边界和依赖方向

Electron 主进程更适合采用“领域层、应用层、端口、基础设施、IPC 适配层、组合根”的结构：

```text
渲染进程
  ↓ IPC DTO
IPC 适配层
  ↓ Command / Query
应用层
  ↓ 调用领域对象和端口
领域层       基础设施端口
  ↑             ↓
纯业务规则    JSON 文件、BrowserWindow、ASR、日志
```

具体职责如下：

- **领域层**：定义聚合根、实体、值对象和不变式，不导入 Electron，不直接读写文件。
- **应用层**：实现“选择模型”“修改模型配置”“保存记忆”“处理窗口意图”等用例，负责事务顺序和结果组装。
- **端口**：定义模型环境仓储、记忆仓储、Live2D 环境仓储、原生窗口操作接口和 ASR 接口。
- **基础设施层**：实现 JSON 文件读写、Electron `BrowserWindow` 适配、ASR 子进程和日志输出。
- **IPC 适配层**：校验 DTO、调用应用服务、把结果转换为 DTO，不保存业务状态，也不直接访问 DAO。
- **组合根**：由 `electron/main.js` 或单独的 `compositionRoot.js` 创建仓储、服务、控制器并注册 IPC。

依赖方向应始终指向领域规则。领域对象不能依赖 `configManager`、`BrowserWindow` 或 IPC；只有基础设施实现端口时才依赖这些具体技术。

## 三、日志边界和输出策略

前端镜像日志和 Electron 后端日志应该采用不同的输出策略。前端需要观察模型布局、窗口反馈、ASR 状态和渲染时序，因此可以继续使用现有的 trace 注册、上下文注入、采样和聚合机制。后端主要承担文件读写、窗口原生操作和 ASR 适配，不应该把每次状态变化都打印出来。

推荐将日志策略定为：

| 来源 | 默认输出 | 说明 |
| --- | --- | --- |
| renderer 镜像日志 | 沿用前端 trace 策略 | 保留前端日志的 namespace、event、traceId 和上下文，方便在 DevTools 中观察复杂交互 |
| Electron 业务日志 | 仅 `error` | 成功读写、正常窗口移动、ASR partial/final 和普通状态切换不输出 |
| Electron 未处理异常 | `error` | 由应用层或基础设施适配器记录，包含 operation、traceId 和安全的错误上下文 |
| 文件日志 | 暂不启用 | 通过 `LogSink` 端口预留扩展点，当前只使用控制台 sink |

“只有错误态输出”应理解为后端只输出已经影响用例完成或进入错误状态的事件，而不是把所有失败都静默掉。例如 ASR 进程崩溃、设备初始化失败、窗口持久化写入失败、模型配置读取失败应该记录错误；ASR 的正常 partial/final、窗口拖动过程中的 bounds 变化、正常使用 Electron 默认位置都不需要记录。

日志控制应下沉到应用服务和基础设施适配器：

- 领域对象只返回领域错误或结果，不直接依赖 logger；
- 应用服务在用例失败、状态进入 `error` 时调用 `LogPort.error`；
- ASR 适配器记录进程、设备和协议错误；
- 窗口适配器只在恢复失败、原生操作异常或状态持久化失败时记录错误；
- IPC 层负责传递 `traceId` 和 operation，不负责决定每个业务步骤是否输出。

可以定义一个很小的端口：

```text
LogPort
  error(scope, event, data, context)
  trace(scope, event, data, context)   # 当前可以是空实现，预留追踪能力
```

`trace` 的注册和上下文格式可以参考前端日志，但后端默认实现只让 `error` 进入控制台。这样后续需要排查窗口或 ASR 的时序问题时，可以在组合根替换日志策略，而不需要修改领域服务。现有 `electron/services/logging/LogIngestService.js` 可以继续负责接收 renderer 镜像；`ingestBackendEvent` 则应收敛为错误日志入口，避免把后端正常事件和前端 trace 混在一起。

暂时不把日志写入 `log` 文件，也不把日志文件纳入任何聚合或配置事务。将来需要文件、滚动、上传或诊断导出时，只需增加 `FileLogSink` 或组合多个 sink，业务层的 `LogPort` 不变。

## 四、推荐目录结构

可以先在现有目录中增量建立结构，不必一次性移动所有文件：

```text
electron/
  domain/
    live2denv/
      Live2dEnvironment.js
      ModelPath.js
      WindowState.js
    modelenv/
      ModelId.js
      ModelEnvironment.js
      ModelConfiguration.js
      ModelMemory.js
    window/
      Bounds.js
  application/
    live2denv/
      Live2dEnvironmentService.js
    modelenv/
      ModelEnvironmentService.js
      ModelMemoryService.js
    window/
      WindowGeometryService.js
  ports/
    Live2dEnvironmentRepository.js
    ModelEnvironmentRepository.js
    ModelMemoryRepository.js
    NativeWindowPort.js
    LogPort.js
  infrastructure/
    persistence/
      JsonLive2dEnvironmentRepository.js
      JsonModelEnvironmentRepository.js
      JsonModelMemoryRepository.js
    window/
      ElectronWindowAdapter.js
    logging/
      ConsoleLogSink.js
  interface/
    ipc/
      registerLive2dEnvironmentIpc.js
      registerModelEnvironmentIpc.js
      registerWindowIpc.js
      dto.js
  compositionRoot.js
```

这里的 `domain/window/Bounds.js` 只负责窗口边界值对象；`WindowState` 放在 `domain/live2denv` 下，表示它是 `Live2dEnvironment` 的内部实体，而不是独立聚合根。

## 五、从当前代码到目标结构的映射

### `live2denv`

当前代码：

- `electron/live2denv/globalState.js`：聚合状态加载、缓存和持久化；
- `electron/live2denv/snapshot.js`：查询模型和生成快照；
- `electron/config/configManager.js`：JSON 持久化实现；
- `electron/main/configIpc.js`：IPC 入口。

目标结构：

- `Live2dEnvironment` 只负责路径集合和当前模型的不变式；
- `Live2dEnvironment` 同时负责窗口状态实体的恢复和更新不变式；
- `JsonLive2dEnvironmentRepository` 负责 `live2denv.json`，并持久化窗口状态；
- `Live2dEnvironmentService` 负责选择模型、增删路径和发布 `ActiveModelChanged`；
- `Live2dEnvironmentService` 负责启动恢复窗口位置，以及在拖拽稳定后保存最终位置；
- 快照生成放在查询服务或应用层组装器中，不塞回聚合根。

### `modelenv`

当前代码：

- `electron/modelenv/service.js`：模型配置缓存和更新；
- `electron/main/modelMemoryIpc.js`：模型记忆 IPC；
- `electron/config/configManager.js`：模型配置和记忆文件读写。

目标结构：

- `ModelEnvironment` 维护模型配置规则；
- `ModelMemory` 维护记忆更新规则；
- 两个仓储可以继续使用同一个配置目录，但分别负责配置文件和记忆文件；
- 删除模型时由应用服务协调配置仓储和记忆仓储，保证不会留下孤立记忆目录。

### `windowstate` 与窗口运行时服务

当前代码：

- `electron/main/windowIntentController.js`：窗口意图、版本、拖拽期间挂起和窗口事实广播；
- `electron/services/window/WindowDragService.js`：拖拽状态；
- `electron/preload.js`：暴露窗口 DTO 和 IPC 方法；
- `docs/架构.md`：已经明确主进程是窗口几何的唯一写入者。

目标结构：

- 保留主进程单写者原则；
- 将 `WindowState` 建模为 `Live2dEnvironment` 内部实体，将 `Bounds` 建模为不可变值对象；
- 在 `live2denv.json` 中保存经过验证的窗口恢复状态；
- 把布局计算、边界合法性和版本判断提取为纯函数或 `WindowGeometryService`；
- 把 `BrowserWindow` 的移动、缩放和读取封装到 `NativeWindowPort`；
- 渲染进程只提交布局意图，不能直接修改 native bounds；
- 拖拽结束后才提交持久化命令，普通 bounds 回流只更新运行时事实；
- 应用启动时先恢复有效位置，失效或缺失时交给 Electron 默认定位。

### 日志模块

当前代码中的 `electron/utils/log.js` 已经具备 trace 规范化、过滤和 renderer 镜像能力，`electron/services/logging/LogIngestService.js` 负责接收前端日志。重构时可以保留这条前端镜像链路，但把后端业务日志改成独立的 `LogPort`：

- `main/asrIpc.js` 不再输出正常的 runtime start/stop、partial、final 和 throttle 过程，只在 ASR 进入 error 或适配器调用失败时记录；
- `main/windowIntentController.js` 和 `services/window/WindowDragService.js` 不再为每次窗口意图、拖拽和 bounds 回流输出日志，只在原生操作失败、恢复状态无效或持久化失败时记录；
- `main.js` 只保留启动级未处理异常和组合根初始化失败，业务过程日志由对应应用服务控制；
- `LogIngestService` 的 renderer 镜像继续保留前端上下文，后端错误日志使用 `origin: backend` 标识，避免两种来源混淆。

## 六、IPC 和用例设计

IPC 名称可以暂时保持兼容，内部改为调用用例：

| 现有 IPC | 目标用例 |
| --- | --- |
| `pet:updateLive2denvConfig` | `UpdateLive2dEnvironment` |
| `pet:getLive2denvConfig`、`pet:listModelPaths` | `GetLive2dEnvironment` |
| `pet:getModelConfig` | `GetModelEnvironment` |
| `pet:updateModelConfig` | `UpdateModelConfiguration` |
| `pet:getModelMemory`、`pet:updateModelMemory` | `GetModelMemory`、`UpdateModelMemory` |
| `pet:removeModelConfig` | `RemoveModelEnvironment` |
| `pet:windowIntent` | `HandleWindowIntent` |
| `pet:windowDrag` | `HandleWindowDrag` |
| 窗口拖拽稳定后的内部命令 | `RecordWindowBounds` |
| 应用启动时的内部命令 | `RestoreWindowState` |

应用服务返回领域结果，IPC 适配层再转换成 `PetConfigSnapshot`、`PetModelMemoryState`、`PetWindowFact` 等前端 DTO。这样可以继续兼容现有前端，不需要让前端知道聚合内部结构。

领域事件只表达有业务意义的事实，例如：

- `ActiveModelChanged`；
- `ModelConfigurationChanged`；
- `ModelMemoryChanged`；
- `WindowBoundsChanged`。

窗口连续拖动过程中产生的每个原生 bounds 变化更接近系统事实或运行时通知，不必全部设计成持久化领域事件。

## 七、渐进式实施顺序

### 第一步：固定现有协议

先为当前 IPC 输入输出、配置默认值、模型 key 生成规则和窗口单写者行为补充契约测试。这样重构内部结构时，渲染进程协议不会被无意改变。

### 第二步：抽取仓储

从 `configManager.js` 中抽出三个端口实现：

- `Live2dEnvironmentRepository`；
- `ModelEnvironmentRepository`；
- `ModelMemoryRepository`。

`Live2dEnvironmentRepository` 同时保存 `Live2dEnvironment` 的窗口状态字段。不要为单个主窗口再创建独立的 `WindowStateRepository`，否则会让同一个应用级环境出现两条互相竞争的写入路径。

保留 `configManager` 作为兼容门面，先让旧代码和新应用服务共存，再逐步删除直接调用。

### 第三步：实现纯领域对象

先实现路径规范化、当前模型选择、模型配置合并、记忆更新和边界校验。这些对象不调用 Electron API，也不读写磁盘，因此可以用普通单元测试验证不变式。

### 第四步：建立应用服务

把 `runtime/allEnv.js` 从“状态和业务的总门面”逐步改为查询组装器或组合服务。命令由对应应用服务处理，查询由快照查询服务处理，避免一个服务同时拥有所有写权限。

### 第五步：收敛日志入口

新增 `LogPort` 和控制台实现，默认只允许后端 `error` 输出。把 ASR、窗口和配置读写中的错误记录下沉到对应应用服务或基础设施适配器，移除正常流程的 `info`、`debug` 和高频 trace 输出。暂时不增加文件 sink；保留 `LogSink` 接口，后续再接入文件、滚动或诊断导出。

### 第六步：收薄 IPC

让 `configIpc.js`、`modelMemoryIpc.js` 和窗口 IPC 只负责：解析 DTO、调用用例、转换结果和发送通知。任何默认值合并、路径规则和模型删除规则都移到应用层或领域层。

### 第七步：整理组合根

在 `electron/compositionRoot.js` 中统一创建仓储、应用服务、窗口适配器、控制器和事件广播器。`main.js` 只负责创建窗口、启动运行时和调用组合根，不再直接拼装业务依赖。

### 第八步：接入窗口状态持久化

先扩展 `live2denv.json` 的结构，增加可选的 `windowState` 字段，并实现缺省兼容。启动时由 `Live2dEnvironmentService` 读取、校验并返回恢复位置；没有状态或状态越界时返回“使用 Electron 默认位置”。

窗口移动仍由 `windowIntentController` 和 `NativeWindowPort` 执行。只有拖拽会话结束、位置稳定后，才调用 `RecordWindowBounds` 并通过防抖写入仓储。窗口布局引起的 resize、renderer 的预测 bounds 和普通 bounds 回流只更新运行时事实，不覆盖用户上次拖动的位置。

最后补充关闭前刷新待保存状态的流程，并覆盖这些场景：首次启动、正常重启、多显示器切换、保存位置落在已移除显示器、拖拽过程中退出，以及旧版本没有 `windowState` 字段。

## 八、最终判断

你的三个方向总体可行，但需要做三处修正：

1. `live2denv` 适合作为应用级环境聚合根，负责模型路径和当前模型的一致性。
2. `modelenv` 适合作为模型范围的限界上下文；配置和记忆可以统一管理，但是否是一个严格聚合，要看它们是否需要同一事务。当前实现更适合两个模型范围聚合共用一个上下文。
3. `position`、`bounds`、`scale` 是 DTO 字段，不是聚合根。由于现在存在窗口位置持久化和启动恢复规则，`WindowState` 应该建模为 `Live2dEnvironment` 内部实体，`Bounds` 是值对象；当前没有必要把它拆成独立聚合根，且 `scale` 不应放入其中。

这样重构的重点不是增加更多层次，而是明确每个状态的所有权、每条写入路径和每条一致性规则：`Live2dEnvironment` 统一拥有模型环境选择和桌宠窗口恢复状态，主进程继续作为组合根和窗口单写者，基础设施负责 Electron 默认定位、文件持久化和显示器边界校验。
