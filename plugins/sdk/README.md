# Live2D 插件 SDK

在控制面板选择的插件目录下，将 SDK 和业务插件放在两个子目录。SDK 的发布文件包括 manifest.json、index.js、package.json、types/、build-ui.mjs 和本说明，可在仓库执行 pnpm build:plugins 后从 plugins/sdk 取得，也可在该目录执行 pnpm pack 分发。目录名可自选，清单 ID live2d.sdk 用于运行时定位。

## 开发

在业务插件目录运行 `pnpm add @live2d/plugin-sdk@file:../sdk react@19` 和 `pnpm add -D @types/react@19`。在 TSX 中从 @live2d/plugin-sdk 导入 definePlugin、PluginDefinition、UiRenderContext 或组件。可用组件包括 Section、Field、Button、Switch 和 Modal，以及 Search、Eye、EyeOff、Info 图标。其他图标可由插件安装 lucide-react 按需导入。

从入口默认导出 definePlugin({ manifest, activate(context) { … } })。运行 `pnpm exec live2d-build-ui page.tsx` 生成 index.js。插件目录的 manifest.json 需声明相同 id、name、version、apiVersion 和 entry.ui（index.js）；在插件定义中声明所需宿主权限。控制面板页面在 activate 中通过 context.ui.register 登记。

SDK 的 UI 导入会指向 plugin://runtime/live2d.sdk/index.js。一个窗口中的多个插件共用这份模块以及客户端的 React、JSX 和 React DOM。Electron 主进程执行的服务使用自己的 Node 依赖。运行已构建的界面时，SDK 目录只需 manifest.json 和 index.js。

## 验收

在仓库根目录运行 `pnpm test:plugin-sdk`。测试在临时目录创建独立项目，安装 SDK，检查类型并编译，然后启动生产静态页面，点击插件按钮并检查图标和弹窗。
