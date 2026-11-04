# Electron TypeScript 迁移任务书

## 执行与审查

Cursor 负责实现，Codex 负责验收。用户指定 Grok 4.7 High，禁止 Fast；不可自行替换模型。当前分支 feat/cli-service-and-electron-transform-ts，迁移前快照 1347c8b，原始 main 基点 02f290b。不要切换分支、重置用户代码、推送或合并。

## 范围

1. 建立独立 Electron TypeScript 编译入口，strict 检查，迁移 electron 下源码与测试。开发运行编译后的 JS，保留前端独立构建。正确处理 preload、worker、资源路径和 shared 导入；原生依赖保留运行时加载。不要通过大面积 any、ts-ignore、关闭 strict 绕过错误。
2. CLI 命令定义、schema、注册映射归 infrastructure；module 仅装配。对外暴露明确 CliService 接口，IPC/HTTP 不直接访问 store 或内部任务服务。命令业务仍归所属服务，不制造庞大的通用框架。区分调用者身份、命令调用、工具流程、Agent 任务；说明各 ID 的来源和职责。保留外部输入运行时校验、鉴权、幂等、取消和任务事件语义。
3. 将 live2denv 中 ASR 实现收敛到现有 ASR 模块；Hold 作为内部状态成员纳入现有 ASR 所有权，统一配置和生命周期，不新增聚合层级。Windows 按键读取保留基础设施适配。main 不再单独管理 Hold。
4. 保留本地/远程 Channel 边界、插件扩展接口以及现有 AI/TTS 行为。Docker 化不在本次范围，勿新增容器、隧道或远程服务。
5. 保留 CLI EXE 打包目标并适配必要路径，但禁止执行 EXE 打包、安装器构建或发布。

## 实施顺序与验收

2026-10-29 当前快照基线：pnpm test 为 58 个文件通过、12 个文件加载失败，377 项测试通过。失败集中在 shared 移动目录后 Electron 仍引用旧路径，以及 ASR 文件移动后的引用；迁移需修复这些路径，不能只沿用此前 memory 失败记录。

先记录基线测试与类型检查结果，再建立编译链，迁移 CLI 并整理职责，再迁移 ASR 和剩余后端。每阶段记录验证结果与实际阻塞，不声称未经验证的运行能力。

执行后端及前端类型检查、相关测试、完整测试与前端构建，核实编译输出中 preload/worker/共享模块的引用可解析。能够安全运行时验证 Electron 启动/关闭及 worker 生命周期；不要操作真实用户配置或提交真实付费 Agent 工作来测试。历史 memory 测试曾失败，但必须重新确认当前基线，不能把所有失败归为既有问题。

输出简短迁移报告：文件职责、CLI 调用链、构建启动命令、验证结果、未解决问题。交付由 Codex 审查后再向用户报告，未经授权不要提交后续改动。
