## 模型切换与视觉偏移动态化方案

1. **模型目录扫描（Electron 主进程）** 仅遍历 `public/model/*` 的第二级目录，发现内部的 `*.model3.json`，构建结构 `{ slug, displayName, modelPath }`，其中 `slug` 即目录名（例：`model/mika` → `mika`）。
2. **配置文件布局** 在 `electron/config/models/` 下为每个 `slug` 按需生成独立 JSON（`{ modelPath, visualOffsetRatio, updatedAt }`），并维护 `electron/config/active-model.json` 记录当前启用的 `slug`。
3. **主进程初始化与 IPC** 启动时加载上述配置，缺失则用 `.env` 中的初始值填充；开放 `getModelCatalog`、`setActiveModel`、`updateModelOffset` IPC 接口供渲染层使用。
4. **Preload 桥接** 通过 `contextBridge` 暴露 `window.petAPI.listModels()`、`window.petAPI.selectModel(slug)`、`window.petAPI.updateVisualOffset(slug, ratio)`，确保渲染层无法绕过安全通道直接访问文件系统。
5. **渲染端状态（usePetStore）** 扩展 store 字段：`availableModels`、`activeModelSlug`、`visualOffsetRatio`，并提供 `initModels`、`chooseModel`、`setVisualOffset` 等方法；原本从 `.env` 读取 `VITE_MODEL_PATH` 和 `VITE_VISUAL_FRAME_OFFSET_RATIO` 的组件改为订阅 store。
6. **控制面板 UI** 新增模型选择下拉框（显示名/目录名）以及范围 `[-0.5, 0.5]`、步长 `0.01` 的滑条；用户操作时调用 store 方法并经过 IPC 同步至主进程配置。
7. **持久化流转** 切换模型时调用 `setActiveModel` 写入 `active-model.json` 并触发 Live2D 重载；调节偏移时通过节流/防抖调用 `updateModelOffset` 写回对应模型 JSON；默认值缺失时回退到 `0`。
8. **首次迁移** 首次运行时读取现有 `.env` 的 `VITE_MODEL_PATH`、`VITE_VISUAL_FRAME_OFFSET_RATIO` 生成对应模型配置，之后运行时不再依赖 `.env` 改动即可实现动态切换。
