# 官方插件市场与运行器实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (recommended). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现官方插件定义加载、固定版本安装/更新/卸载、进程运行和市场状态展示。

**Architecture:** 新增官方市场定义模型和 `apps/installed/<id>/` 安装记录，安装器在 staging 中完成 Git checkout、系统运行时安装和健康检查后再切换 source。保留旧本地 manifest 和内置应用路径；官方运行器使用参数数组，不经过 shell。

**Tech Stack:** Rust、serde_yaml、tokio::process、git CLI、reqwest、React、Vitest。

## Global Constraints

- 只读取 aIdea 仓库内 `plugin-markets/official/*.yaml`，不实现第三方仓库输入或远程市场。
- 首期使用用户系统已有 `git`、`node`、`python`，缺失时返回清晰错误。
- 只允许固定 tag 或完整 commit；安装和更新失败不得覆盖当前可运行版本。
- 工作目录必须在安装目录内，启动命令为参数数组，禁止 `sh -c`。
- WebView 只允许 `http://127.0.0.1:<port>`，健康检查成功后才展示。
- 更新和默认卸载保留 `app-data/<id>`、`logs/<id>`；不自动清理业务数据。
- 不执行 Git 提交、推送或远程 PR。

---

### Task 1: 官方市场定义与安装记录

**Files:**
- Create: `plugin-markets/official/.gitkeep`
- Create: `shell-native/src/plugin_market.rs`
- Modify: `shell-native/src/manifest.rs`
- Modify: `shell-native/src/config.rs`
- Test: `shell-native/tests/plugin_market_test.rs`

- [ ] 定义官方 YAML 结构：展示字段、仓库、revision、运行时、安装命令、启动命令、工作目录、健康 URL 和兼容版本。
- [ ] 从编译时目录读取定义，校验 kebab-case ID、固定 revision、参数数组、命令和本机 URL。
- [x] 将已安装记录写入 `apps/installed/<id>/install-state.yaml`，区分 market definition 和 user installation state。
- [ ] 测试合法/非法 YAML、路径逃逸、远程 WebView URL 和固定 revision 校验。

### Task 2: Git 安装、staging 更新与卸载

**Files:**
- Create: `shell-native/src/plugin_installer.rs`
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-native/src/commands/mod.rs`
- Modify: `shell-native/src/lib.rs`
- Test: `shell-native/tests/plugin_installer_test.rs`

- [ ] 用参数数组调用系统 `git clone` / `git fetch` / `git checkout`，不经过 shell。
- [ ] 在临时目录初始化本地测试仓库，验证固定 commit checkout、安装命令失败保留旧 source、成功后切换 source。
- [ ] 将安装/更新阶段写入运行状态和日志；删除安装记录、source、staging，但保留业务数据与日志目录。
- [ ] 新增 Tauri 命令：列市场、安装、更新、卸载，并返回阶段、版本和错误信息。

### Task 3: 官方插件运行器

**Files:**
- Modify: `shell-native/src/process.rs`
- Modify: `shell-native/src/manifest.rs`
- Test: `shell-native/tests/plugin_process_test.rs`

- [ ] 将官方参数数组转换为 `tokio::process::Command`，注入四个 `AIDEA_*` 环境变量。
- [ ] 将 `workingDirectory` 限制在 source 内；将 `python`/`node` 解析为系统 PATH 中的可执行文件。
- [ ] 健康检查只接受 `127.0.0.1` HTTP URL，并在超时后停止子进程。
- [ ] 保留现有内置/本地应用启停行为，测试官方和旧 manifest 不互相回归。

### Task 4: 市场 UI

**Files:**
- Create: `shell-frontend/src/builtin-apps/plugin-market/index.tsx`
- Modify: `shell-frontend/src/builtin-apps/BuiltinPage.tsx`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Create: `shell-frontend/tests/plugin-market/PluginMarket.test.tsx`

- [ ] 展示官方插件图标、简介、版本和安装状态。
- [ ] 提供安装、启动、停止、更新、卸载操作；安装和更新显示阶段与错误。
- [ ] 卸载只删除运行环境并明确提示业务数据保留。
- [ ] 遵守 `docs/app/ui.md`，不新增第二套组件或图标体系。

### Task 5: 回归验证

- [ ] 运行 `cargo test --manifest-path shell-native/Cargo.toml`。
- [ ] 运行 `npm test`、`npm run lint`、`npm run build`（前端命令在 `shell-frontend/`）。
- [ ] 运行 `git diff --check`，搜索命令执行路径确认没有 `sh -c` 和远程 WebView。
