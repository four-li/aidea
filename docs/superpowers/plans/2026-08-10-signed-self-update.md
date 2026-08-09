# aIdea 签名自更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 aIdea 能从 GitHub Releases 安全检查、下载并重启安装签名更新。

**Architecture:** `shell-native/tauri.conf.json` 是唯一人工维护的版本来源，发布工具将版本同步到 Cargo 与前端元数据。Tauri updater 在 Rust 后端完成检查、下载和签名校验；前端只通过 `ipc.ts` 显示状态。macOS 菜单用 Tauri 事件通知前端打开设置“关于”页并触发同一检查动作。

**Tech Stack:** Tauri 2、`tauri-plugin-updater`、Rust、React 18、TypeScript、Vitest、GitHub Actions、GitHub Releases。

## Global Constraints

- 仅支持 macOS Apple Silicon，不实现 Apple 代码签名或公证。
- 更新包必须由 Tauri updater 验证签名；前端不得拼下载 URL、下载 DMG 或覆盖应用目录。
- `shell-native/tauri.conf.json` 为版本唯一人工来源；Cargo、前端 manifest 与 lockfile 必须一致。
- 签名私钥只允许通过 GitHub Actions Secret 注入，绝不写进仓库、应用数据或日志。
- 不创建 PR、不 push、不自动 `git add` 或 commit。
- UI 使用既有 shadcn、Tailwind、lucide-react 和 `ipc.ts`，同时支持浅色与深色主题。

---

### Task 1: 建立版本一致性校验与发布同步

**Files:**
- Modify: `shell-native/Cargo.toml`
- Modify: `shell-frontend/package-lock.json`
- Modify: `.github/workflows/release.yml`
- Modify: `aidea-release/SKILL.md`
- Modify: `aidea-release/scripts/release.sh`
- Test: `aidea-release/scripts/release.sh` 的 `bash -n` 和临时 Git 仓库验证

**Interfaces:**
- Consumes: `shell-native/tauri.conf.json` 的语义化 `version`。
- Produces: 发布脚本在给定目标版本时同步四个版本字段；发布工作流在版本不一致时失败。

- [ ] **Step 1: 写出脚本的失败验证场景**

在临时 Git 仓库复制 `release.sh` 和最小的四个版本文件，故意设定 `Cargo.toml` 为 `0.1.0`、其余为 `0.1.4`。执行：

```bash
bash scripts/release.sh 0.1.5
```

预期：当前脚本未检测 Cargo 与 lockfile，作为新增验证前的失败基线。

- [ ] **Step 2: 先补齐当前 `0.1.4` 元数据**

将 `shell-native/Cargo.toml` 的 package version 改为 `0.1.4`，并使用 npm 的 lockfile-only 操作令 `shell-frontend/package-lock.json` 根 package 与 `shell-frontend/package.json` 同为 `0.1.4`。不得改动任何依赖版本。

```toml
[package]
version = "0.1.4"
```

- [ ] **Step 3: 最小化扩展发布脚本**

在脚本中增加 `cargo_file="shell-native/Cargo.toml"` 和 `lock_file="shell-frontend/package-lock.json"`。启动时读取四个版本并失败退出，发布构建前以目标版本同步后三个文件，构建和提交前再次检查四者相等。备份、恢复和 `git add` 的目标也增加这两个文件。

```bash
current_cargo="$(sed -nE 's/^version = "([0-9]+\.[0-9]+\.[0-9]+)"$/\1/p' "$cargo_file" | head -1)"
current_lock="$(node -p "require('./$lock_file').version")"
[[ "$current_tauri" == "$current_cargo" && "$current_tauri" == "$current_frontend" && "$current_tauri" == "$current_lock" ]] || exit 1
```

使用 Node 的 JSON 读写同步 package 和 lockfile，使用受限的 `sed` 只替换 Cargo package 段的版本行；替换后立即重新读取并校验，避免误改依赖版本。

- [ ] **Step 4: 扩展 GitHub 发布前校验**

将 `.github/workflows/release.yml` 的版本检查从单个 Tauri 配置扩展到四处，tag 与四者任意不一致即失败：

```bash
test "$tag_version" = "$tauri_version"
test "$tag_version" = "$cargo_version"
test "$tag_version" = "$frontend_version"
test "$tag_version" = "$lock_version"
```

- [ ] **Step 5: 更新 release Skill 的契约**

将 Skill 的“两个版本文件”“只暂存两个版本文件”改为四个版本文件；说明人工只维护 Tauri 配置，发布脚本负责同步其余版本元数据；将四文件一致性、updater 公钥、签名 Secret 和 updater 产物检查列入发布前验证。

- [ ] **Step 6: 验证版本工具链**

运行：

```bash
bash -n aidea-release/scripts/release.sh
npm install --package-lock-only --ignore-scripts --prefix shell-frontend
git diff --check
```

预期：脚本语法通过，lockfile 仅更新根包版本，diff 无空白错误。

### Task 2: 配置签名 updater 与 GitHub Release 产物

**Files:**
- Modify: `shell-native/Cargo.toml`
- Modify: `shell-native/tauri.conf.json`
- Modify: `shell-native/capabilities/default.json`
- Modify: `.github/workflows/release.yml`
- Create: `docs/release-updater.md`
- Test: `shell-native/tauri.conf.json` 的 JSON 解析与发布工作流文本校验

**Interfaces:**
- Consumes: `TAURI_SIGNING_PRIVATE_KEY` 与可选 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Secrets。
- Produces: Tauri updater 可从 `https://github.com/four-li/aidea/releases/latest/download/latest.json` 读取签名更新清单。

- [ ] **Step 1: 写配置失败检查**

添加一个最小 shell 验证，解析 `tauri.conf.json` 并断言：`bundle.createUpdaterArtifacts === true`、`plugins.updater.pubkey` 非空、endpoint 使用 GitHub Release 的 `latest/download/latest.json`。在配置未加入这些字段时预期失败。

- [ ] **Step 2: 加入 updater 依赖与权限**

在 Rust 依赖中增加稳定的 Tauri 2 updater 插件，并在默认 capability 中授权 updater 的检查和下载/安装操作。前端不直接调用该插件。

```toml
tauri-plugin-updater = "2"
```

- [ ] **Step 3: 配置公开更新源与公钥**

启用 updater 产物并配置 GitHub Release endpoint。生成一次 minsign 公私钥对后，将公钥写入配置；私钥只交给 GitHub Secret，不写入任何仓库文件。

```json
"bundle": { "createUpdaterArtifacts": true },
"plugins": {
  "updater": {
    "pubkey": "<发布公钥>",
    "endpoints": ["https://github.com/four-li/aidea/releases/latest/download/latest.json"]
  }
}
```

- [ ] **Step 4: 调整发布工作流**

构建命令使用 `tauri build` 的 updater 产物模式；从 GitHub Secret 注入签名环境变量；`softprops/action-gh-release` 上传 DMG、updater archive、`.sig` 和 `latest.json`。环境变量名固定为 `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

- [ ] **Step 5: 写发布维护文档**

`docs/release-updater.md` 说明：一次性生成密钥的命令、公钥位置、两个 GitHub Secret 名称、每个 Release 必须出现的四类资产、未签名 macOS 首次运行限制，以及篡改签名时 updater 必须拒绝安装。

- [ ] **Step 6: 验证 updater 配置**

运行：

```bash
node -e "const c=require('./shell-native/tauri.conf.json'); if (!c.bundle.createUpdaterArtifacts || !c.plugins?.updater?.pubkey || !c.plugins.updater.endpoints?.[0]) process.exit(1)"
git diff --check
```

预期：配置可解析且所有 updater 必填字段存在。

### Task 3: 实现 Rust 更新 IPC 与 macOS 菜单事件

**Files:**
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-native/src/commands/mod.rs`（仅当模块导出需要）
- Test: `shell-native/src/commands/shell.rs`

**Interfaces:**
- Produces: `get_aidea_version() -> String`、`check_aidea_update(AppHandle) -> AppResult<Option<AideaUpdate>>`、`install_aidea_update(AppHandle) -> AppResult<()>`。
- Produces: `aidea:check-update` Tauri event，菜单项 ID 为 `check-aidea-update`。
- Consumes: Task 2 的 updater 配置与 `tauri_plugin_updater::UpdaterExt`。

- [ ] **Step 1: 写失败单测**

在 `shell.rs` 的 tests 中验证当前版本使用包构建版本，而非前端常量：

```rust
#[test]
fn 当前版本来自构建包版本() {
    assert_eq!(current_aidea_version(), env!("CARGO_PKG_VERSION"));
}
```

运行：

```bash
cargo test --manifest-path shell-native/Cargo.toml 当前版本来自构建包版本
```

预期：实现函数前编译失败。

- [ ] **Step 2: 定义最小可序列化响应与版本函数**

在 `shell.rs` 中定义只包含 `version`、`body`、`date` 的 `AideaUpdate`，实现 `current_aidea_version()`；`get_aidea_version` 仅返回该函数结果。`check_aidea_update` 通过 `app.updater()?.check().await?` 返回 `None` 或映射后的响应。

- [ ] **Step 3: 实现单次重新检查后安装**

`install_aidea_update` 不接受 URL 或版本参数，而是重新调用 updater 检查；没有可用更新时返回可读错误。有更新时调用 updater 的下载和安装 API，完成后请求 Tauri 重启。所有插件和网络错误映射为 `AppError`，错误中不输出 URL、私钥或签名内容。

- [ ] **Step 4: 注册插件、命令和菜单**

在 `lib.rs` 注册 updater 插件与三个命令。创建包含“检查更新”项的 macOS 应用菜单；收到菜单事件后使用 `app.emit("aidea:check-update", ())` 通知前端。菜单事件处理不得直接执行下载或重启。

- [ ] **Step 5: 运行 Rust 测试**

运行：

```bash
cargo fmt --check --manifest-path shell-native/Cargo.toml
cargo test --manifest-path shell-native/Cargo.toml commands::shell::tests
```

预期：格式检查与 shell 命令测试通过。

### Task 4: 实现关于页和菜单跳转交互

**Files:**
- Modify: `shell-frontend/src/lib/ipc.ts`
- Create: `shell-frontend/src/types/update.ts`
- Modify: `shell-frontend/src/components/SettingsPanel.tsx`
- Modify: `shell-frontend/src/App.tsx`
- Test: `shell-frontend/tests/components/SettingsPanel.test.tsx`

**Interfaces:**
- Consumes: Task 3 的三个 IPC 命令与 `aidea:check-update` 事件。
- Produces: `AboutSettings` 可检查、展示和安装更新；`App` 将菜单事件转换为打开设置和关于页的 props。

- [ ] **Step 1: 写前端失败测试**

在 SettingsPanel 测试中 mock `ipc.getAideaVersion` 与 `ipc.checkAideaUpdate`，验证：渲染真实版本、点击“检查更新”后显示“已是最新版本”，以及 `openCategory="about"` 时显示关于页。再 mock 更新可用，验证显示版本、更新说明和“更新并重启”。

```tsx
expect(await screen.findByText('当前版本 0.1.4')).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: '检查更新' }));
expect(await screen.findByText('已是最新版本')).toBeInTheDocument();
```

- [ ] **Step 2: 扩展 IPC 和更新类型**

新增 `AideaUpdate` 类型：

```ts
export interface AideaUpdate {
  version: string;
  body: string | null;
  date: string | null;
}
```

在 `ipc.ts` 新增 `getAideaVersion`、`checkAideaUpdate`、`installAideaUpdate` 三个封装，所有调用继续经由 `ipc`。

- [ ] **Step 3: 以最少状态改造 SettingsPanel**

为 `SettingsPanel` 增加 `activeCategory` 受控入口；`AboutSettings` 初次读取版本，用户点击才检查更新。状态仅为 `idle`、`checking`、`up-to-date`、`available`、`installing`、`error`。安装按钮在下载和验证期间禁用；错误展示在关于区，不只使用 toast。

- [ ] **Step 4: 监听菜单事件并打开关于页**

在 `App.tsx` 监听 `aidea:check-update`，收到事件设置 settings 弹窗为打开状态，并向 SettingsPanel 传入 `activeCategory="about"` 与一次性检查请求标记。卸载监听器避免热更新或多次挂载重复检查。

- [ ] **Step 5: 运行前端验证**

运行：

```bash
npm test --prefix shell-frontend -- --run SettingsPanel
npm run lint --prefix shell-frontend
npm run build --prefix shell-frontend
```

预期：关于页更新状态、菜单跳转和类型检查全部通过。

### Task 5: 完成发布闭环验证

**Files:**
- Modify: `README.md`
- Modify: `docs/release-updater.md`（仅在 Task 2 文档需修正时）
- Test: 全仓库验证命令

**Interfaces:**
- Consumes: Tasks 1-4 的发布脚本、updater 配置、IPC 与 UI。
- Produces: README 不再宣称只能手动 DMG 更新；发布者有完整的密钥和验收说明。

- [ ] **Step 1: 更新 README 更新说明**

将“更新采用手动方式”替换为签名应用内更新流程，保留未签名 macOS 首次放行说明；链接 `docs/release-updater.md`，不在 README 放私钥命令或 Secret 值。

- [ ] **Step 2: 执行最小全量验证**

运行：

```bash
npm test --prefix shell-frontend
npm run lint --prefix shell-frontend
npm run build --prefix shell-frontend
cargo test --manifest-path shell-native/Cargo.toml
git diff --check
```

预期：所有检查通过。真实的“旧版升级到新版”需要在 GitHub Secret 配置后，以两个连续 Release 人工验收；本地开发环境不得实际覆盖正在运行的应用。

- [ ] **Step 3: 确认不自动发布**

仅报告改动和验证结果；不执行 `git add`、commit、tag、push、创建 Release 或设置 GitHub Secret。

## Self-Review

- Spec coverage: Task 1 覆盖版本唯一来源和 release Skill；Task 2 覆盖签名、产物和 Secrets；Task 3 覆盖后端检查/安装和菜单事件；Task 4 覆盖关于页与交互；Task 5 覆盖文档和验证。
- Placeholder scan: 本计划不含 TBD、TODO 或“适当处理”等未定义实现。
- Type consistency: 后端命令与前端 IPC 均使用 `AideaUpdate`；菜单事件固定为 `aidea:check-update`；唯一人工版本源固定为 `tauri.conf.json`。
