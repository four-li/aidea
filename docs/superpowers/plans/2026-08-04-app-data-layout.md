# aIdea 用户数据目录迁移 Implementation Plan

> **For agentic workers:** 本计划在当前会话内按步骤执行，不自动提交 Git。

**Goal:** 将内置应用与用户数据分离，并把配置、第三方 manifest 和运行状态迁移到 macOS 用户目录。

**Architecture:** 内置 manifest 通过 `include_str!` 编译进 Rust，发布后不依赖源码目录。用户配置使用 `dirs::data_dir()/aIdea`，首次启动从旧项目目录迁移一次；第三方源码路径只保存到 manifest，不复制或管理其内部文件。

**Tech Stack:** Rust、Tauri 2、serde、serde_yaml、dirs、Vitest。

## Global Constraints

- 仅支持 macOS Apple Silicon。
- 完整 AI API Key 只允许进入 macOS Keychain。
- 用户配置不写入 `.app`，升级不覆盖用户数据目录。
- 不自动提交、推送或创建 PR。

### Task 1: 内置 manifest 与用户 manifest 分层

**Files:**
- Create: `apps/builtin/dashboard.yaml`
- Create: `apps/builtin/dev-tools.yaml`
- Delete: `apps/dashboard.yaml`
- Delete: `apps/dev-tools.yaml`
- Modify: `apps/atlas.yaml`
- Modify: `shell-native/src/manifest.rs`
- Modify: `shell-native/tests/manifest_test.rs`

- [ ] 把两个内置 manifest 放入 `apps/builtin/`，用 `include_str!` 注册。
- [ ] 让加载器读取编译内置 manifest 与用户目录 `apps/local`、`apps/installed`。
- [ ] 将 `save_manifest` 固定写入用户 `apps/local`。
- [ ] 更新 manifest 测试，验证内置应用和本地应用来源。

### Task 2: 用户配置目录与一次性迁移

**Files:**
- Modify: `shell-native/src/config.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-native/src/manifest.rs`
- Modify: `shell-native/tests/manifest_test.rs`

- [ ] 将配置根目录固定为 `~/Library/Application Support/aIdea`。
- [ ] 启动时创建 `apps/local`、`apps/installed`、`runtime`、`backups`。
- [ ] 首次启动从旧项目根目录迁移配置和非内置 manifest，并写入迁移标记。
- [ ] 迁移前创建配置备份；迁移只复制 manifest，不移动子应用源码。

### Task 3: 文档与发布验证

**Files:**
- Modify: `README.md`
- Modify: `docs/app-package-spec.md`
- Modify: `shell-native/tauri.conf.json`

- [ ] 更新开发、发布和数据目录说明。
- [ ] 运行 `npm run build`、`cargo test`、Tauri `.app` 构建。
- [ ] 扫描个人路径、密钥文件和常见 token 模式。
