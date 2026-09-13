# Live2D 渲染链路与同步方案

## 目标

Live2D 模块采用 DI 容器管理 service，UI 只负责输入、挂载 Pixi 和展示结果。布局计算只使用数值和三矩形算法，不读取 DOM，也不让窗口观测独立修改模型。

目标是让一次 scale 变化对应一个不可变展示版本，并尽量让 Electron 窗口调整与 Pixi 重绘使用同一份快照，避免模型中心、红线和窗口边界在异步阶段分别变化。

## Service 边界

```text
DI Container
├─ Live2dService
│  ├─ Live2dLayout       数值布局、版本和 Pixi 提交
│  ├─ ModelService        模型生命周期与参数
│  └─ 子模块              眼球、动作、气泡等纯逻辑
├─ ElectronService
│  ├─ BridgeService       IPC 桥接
│  └─ DragService         窗口拖动开始/结束
└─ LogService             renderer / Electron 镜像日志
```

SharedWorker 只承担状态总线和合帧；它不是布局计算源。Electron 保存窗口配置并执行原生窗口操作。Live2dLayout 是 renderer 内唯一可以推进模型展示版本的 service。

## 预期渲染链路

```text
控制面板 scale action
        ↓
StateBus 发布 appearance.scale
        ↓
Live2dLayout 创建 revision 快照
        ↓
按 scale + 模型基准尺寸 + 两侧区域计算三矩形
        ↓
ElectronService / BridgeService 发送同一 revision 的 setContentBounds
        ↓
Electron 应用窗口几何并返回 appliedGeometry
        ↓
Live2dLayout 校验 revision 和 intentId
        ↓
Pixi renderer.resize + 模型 scale/pivot/position
        ↓
同一快照更新红线、气泡和交互区域
        ↓
Pixi postrender 标记版本完成
        ↓
若期间有新 scale，只提交最后一个待处理值
```

Electron 返回的 `appliedGeometry` 是窗口尺寸的权威来源。Chromium 的 `innerWidth/innerHeight` 只用于诊断日志，不能反向覆盖模型，也不能阻塞已经匹配的 revision。

## 版本规则

- 每次 scale 变化只创建一个 revision；活动 revision 的 `target`、模型缩放和窗口几何不可变。
- 活动 revision 未完成时，新的 scale 不创建并行事务，只替换 `pendingScale`。
- 旧 IPC 响应、旧拖动响应和旧 generation 响应全部丢弃。
- 只有 Live2dLayout 可以提交 Pixi 和模型位置；窗口观测不能单独触发模型变换。
- 拖动开始会使正在等待的 resize 事务失效；拖动结束后再处理最新 scale。

## 抖动来源与防护

主要抖动来自多个时序同时写展示状态：窗口坐标、浏览器 viewport、Pixi renderer 尺寸和模型局部位置分别到达，旧几何又被补偿逻辑重新写回。防护措施是：

1. 计算层只生成纯数字三矩形结果。
2. 窗口位置使用固定锚点计算，真实窗口回执不重新计算模型桌面坐标。
3. Pixi 只消费当前 revision 的不可变目标。
4. 先完成对应 Electron 窗口调整，再提交 Pixi 变换。
5. canvas backing buffer 和 CSS 宽高在同一次 Pixi 提交中更新，避免放大后裁剪。

这不能把 Chromium/桌面合成器变成真正的原子事务，但可以消除应用层的双数据源、旧版本回写和补偿反馈闭环。

## 日志与验证

统一使用 `ns: live2d.layout`，重点事件包括：`version.waiting`、`version.superseded`、`pixi.resize.before`、`pixi.resize.after`、`version.committed`、`version.rendered` 和 `version.failed`。连续 scale 测试应按 revision 对齐 Electron 的 `setContentBounds`、`appliedGeometry`、Pixi 尺寸、模型中心和红线中心，确认不存在旧 revision 回写。

