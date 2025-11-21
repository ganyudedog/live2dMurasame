# Live2D 桌宠实现方案（初稿，待你审核）

## 1. 项目目标
构建一个跨平台（Windows 主优先）Live2D 桌面宠物应用：
- 使用 Electron 创建透明、置顶、可拖拽、可选择是否穿透点击的桌面窗口。
- 基于 Pixi.js 与官方 Live2D Cubism SDK（通过 `pixi-live2d-display` 或手动集成）进行模型渲染。
- 使用 React + TailwindCSS 构建配置与控制界面（轻量，尽量不干扰桌宠主窗口性能）。
- 支持动作（motion）、表情（expression）、物理（physics）、音频同步播放、闲置随机动画、交互触发（点击、拖拽、右键菜单）。
- 提供最小可用设置：开机自启、缩放、位置锁定、是否允许鼠标事件、动作选择、音量开关。

后续增量可扩展：多模型切换、热加载、脚本化行为（例如基于时间段或系统事件触发）、插件机制、通知整合。

## 2. 技术栈与核心依赖
| 功能 | 选型 | 说明 |
|------|------|------|
| 渲染 | `pixi.js` | WebGL 渲染基础 |
| Live2D 支持 | `pixi-live2d-display` | 封装 Cubism SDK，简化与 Pixi 集成 |
| 框架 | `react`, `react-dom` | UI 层 |
| 样式 | `tailwindcss`, `postcss`, `autoprefixer` | 原子化样式，加速迭代 |
| 状态管理 | `zustand`（或 `jotai`） | 轻量，全局配置、模型状态；优先 `zustand` |
| Electron | `electron` | 主进程 + 渲染进程 |
| 配置持久化 | `electron-store` | 保存用户设置（JSON）|
| 构建 | `vite` | 已存在，继续使用；分出 `main` 与 `renderer` 构建 |
| 类型 | `typescript` | 保持现有 ts 环境 |
| 打包 | `electron-builder` | 生成安装包（后期阶段）|
| 音频 | 原生 HTMLAudio / WebAudio | 与 motion 触发同步 |

可选增强：
- `pixi-viewport`（若后续有复杂镜头/缩放拖动需求）。
- `eventemitter3`（若状态事件较多，可单独抽象）。
- `electron-updater`（自动更新，后期再加）。

移除/清理：删除当前 `src/App.tsx` 示例逻辑，替换为桌宠专用入口与组件结构。

## 3. 整体架构概览
```
electron/
  main.ts            # 主进程：创建窗口、IPC 通道、托盘菜单、开机自启
src/
  renderer/
	 index.tsx        # React 入口，挂载控制/设置 UI
	 components/
		PetCanvas.tsx  # 包含 <canvas>，初始化 Pixi Application 与 Live2D 模型
		ControlPanel.tsx # 简易控制面板（动作、表情、缩放、开关）
		SettingsPortal.tsx # 高级设置/弹窗
	 state/
		usePetStore.ts # zustand 管理：当前动作、队列、音量、可交互等
	 live2d/
		loader.ts      # 模型加载与缓存（读取 public/model 内 *.model3.json）
		motionManager.ts # 动作/表情调度，空闲循环策略
		interaction.ts  # 点击、拖拽、命中区域判定
	 ipc/
		bridge.ts      # 封装与主进程 IPC 的调用（开机自启、窗口模式等）
public/model/        # 已存在 Live2D 资产目录
```

Electron 主窗口：
- `BrowserWindow` 参数：`transparent: true`, `frame: false`, `alwaysOnTop: true`, `skipTaskbar: true`, `backgroundColor: '#00000000'`。
- 支持“点击穿透”模式：调用 `win.setIgnoreMouseEvents(true, { forward: true })`（通过设置切换）。
- 托盘菜单：显示/隐藏控制面板、锁定位置、退出。

渲染层两个窗口策略（可选）：
1. 单窗口：透明层 + 浮动 UI（UI 绝对定位在右下角/可隐藏）。
2. 双窗口：桌宠透明窗口 + 普通设置窗口（更干净，推荐后期）。初版先做单窗口降低复杂度。

## 4. 模块与职责拆分
1. Live2DLoader (`live2d/loader.ts`)
	- 解析 `model3.json`，加载 `moc3`、`textures`、`motions`、`expressions`、`physics3.json`。
	- 返回模型实例（`Live2DModel`）。
2. MotionManager (`live2d/motionManager.ts`)
	- 提供 `playMotion(name)`、`queueMotion(name)`、`playRandomIdle()`。
	- 动作结束事件监听，自动触发下一队列或闲置动画。
3. Interaction (`live2d/interaction.ts`)
	- 拖拽桌宠：监听 pointer down / move / up，更新窗口位置（通过 IPC 调主进程 `win.setPosition`).
	- 点击热点区域：可定义模型坐标映射（例如头部触发表情；身体触发动作）。
4. 状态管理 (`usePetStore.ts`)
	- `currentMotion`, `pendingQueue`, `scale`, `allowMouse`, `volume`, `panelVisible` 等。
	- 动作触发与 UI 联动。
5. 音频系统
	- 与特定 motion 绑定音频文件（在 `model/motion/*.motion3.json` 中有时包含音频路径，若无则自定义映射表）。
6. Electron IPC (`bridge.ts` + 主进程 handlers)
	- `toggleIgnoreMouseEvents`, `setScale`, `setAutoLaunch`, `getAppVersion` 等。
7. 设置存储 `electron-store`
	- 初始化默认配置；首次启动写入；修改后立即持久化。

## 5. 动作与表情策略
Idle 策略：
- 每 N 秒（例如 20–40 区间随机）若无队列播放 `playRandomIdle()`。
- 队列优先：当用户点击或触发事件加入队列，空闲循环暂停。

动作与表情：
- 基于文件名或自建映射（例如 `motion01.motion3.json => wave`）。
- 提供一个 JSON 映射：`motionMap.ts`：`{ wave: 'motion01', happy: 'motion03', ... }`。
- 表情切换：通过 `model.expression()`（取决于 SDK）（若使用 `pixi-live2d-display` 提供的 API）。

## 6. Tailwind 集成与样式
步骤：
1. 安装：`tailwindcss postcss autoprefixer`。
2. 生成 `tailwind.config.js`：指定 `content: ["./index.html", "./src/**/*.{ts,tsx}"]`。
3. 在 `src/renderer/index.css` 引入 `@tailwind base; @tailwind components; @tailwind utilities;`。
4. 控制面板组件使用简单卡片风格（半透明黑底 + 毛玻璃，可选 `backdrop-filter`）。

## 7. 分阶段里程碑
| 阶段 | 目标 | 交付物 |
|------|------|--------|
| Phase 0 | 清理与依赖 | 移除旧示例、安装依赖、调整目录、Electron 主窗口跑起来 |
| Phase 1 | 模型加载渲染 | 显示 Live2D 模型，支持缩放、拖拽基础 |
| Phase 2 | 动作/表情 API | 播放指定动作，空闲随机循环，队列机制 |
| Phase 3 | UI 控制面板 | React 面板控制动作、缩放、是否穿透、显示/隐藏 |
| Phase 4 | 设置与持久化 | electron-store 保存配置，开机自启（可选）|
| Phase 5 | 音频与扩展 | 动作音频同步；托盘菜单；小优化 |
| Phase 6 | 打包与发布 | electron-builder 输出安装包，图标与版本信息 |

## 8. 预期新增/修改依赖命令（参考）
```
pnpm add pixi.js pixi-live2d-display zustand electron-store classnames
pnpm add -D tailwindcss postcss autoprefixer electron-builder @types/node
```
（Electron 若已安装则跳过；若无：`pnpm add electron`）

## 9. 性能与注意事项
- 尽量避免在 React state 中存放巨大对象（模型实例单独持有）。
- Pixi Application 只创建一次，组件卸载时销毁（桌宠主窗口一般不会销毁）。
- 开启穿透鼠标后要留一个唤出控制面板的方式（托盘菜单或快捷键）。
- 窗口移动使用 `win.setPosition`（频率不宜过高，可在拖拽时节流 16ms）。
- 资源加载失败时给出回退提示（例如模型路径错误）。

## 10. 安全与分发
- 禁止加载远程任意脚本；模型和配置固定在 `public/model`。
- 打包时排除无关开发文件（node_modules prune）。
- 后期自动更新需签名与版本 API；初版不做。

## 11. 下一步建议执行顺序（实现层面）
1. Phase 0：清理 `src` 现有示例，建立 `src/renderer` 结构与入口文件。调整 Electron 主进程脚本（`electron/main.js` → `electron/main.ts` 若迁移到 TS）。
2. Phase 1：编写 `PetCanvas.tsx`，集成 Pixi 与模型加载（硬编码加载第一只模型）。
3. Phase 2：实现 `motionManager.ts` + 空闲策略；连接 zustand。
4. Phase 3：开发控制面板组件，提供动作按钮与缩放滑条。
5. Phase 4：加入 `electron-store`，设置持久化，增加穿透与置顶切换。
6. Phase 5：音频映射与托盘菜单。
7. Phase 6：打包脚本（`electron-builder` 配置）与发布测试。

## 12. 审核要点（请你确认）
请确认：
- 是否接受单窗口策略作为初版？
- 是否需要在第一版就加入开机自启与自动更新？
- 是否需要多模型切换（若有则 Phase 1 要做模型选择工具）？
- 状态管理选 `zustand` 是否 OK？

确认后我将：
1. 执行 Phase 0 清理与依赖安装脚本建议。
2. 输出初始代码骨架与关键空文件。 
3. 开始逐步实现。

---
（等待你的审核与反馈）

