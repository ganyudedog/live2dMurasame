# Windows CLI 打包

本次仅添加目标，尚未执行打包或验证实际 EXE。

在 Windows 上使用 Node.js 22 LTS，安装依赖后执行 `pnpm build:cli:exe`。产物为 `release/cli/win-<架构>/live2d.exe`，架构与构建用 Node 一致，同时附带 NODE-LICENSE.txt。构建机器的 Node 安装目录需要保留 LICENSE 文件。

目标使用 esbuild 和 Node SEA/postject，内置 Node 运行时，不需要 electron-builder。独立于普通 `pnpm build`，不会随前端构建自动执行。临时目录自动清理，不修改本机 Node。

用户无需安装 Node、pnpm 或源码。将产物目录加入 PATH 后执行：

```powershell
live2d --connection "实际的Electron用户数据目录\cli\connection.json" agent list
```

也可用 LIVE2D_CLI_CONNECTION 环境变量指定连接文件。桌宠客户端必须已启动；连接凭据从客户端生成的文件读取，不嵌入 EXE。

此目标仅生成 CLI，不打包 Electron 桌面程序，不自动修改 PATH。安装器集成、代码签名及实际产物冒烟验证留待发布准备阶段，当前产物按未签名程序处理。

参考：[Node.js 22 SEA 文档](https://nodejs.org/download/release/latest-jod/docs/api/single-executable-applications.html)。
