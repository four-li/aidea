# aIdea 应用设置与运行模式实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 当前项目约束不默认使用子代理；本计划在当前会话内按任务执行。

**Goal:** 为内置应用和官方应用增加统一的“应用自带设置页、配置保留、指纹重置”契约，并让 DevTools 支持隐藏内部工具。

**Architecture:** aIdea 只管理应用级入口、生命周期、Touch ID 和平台目录；应用自己管理业务配置、默认值、迁移和重置实现。内置应用使用注册的 React 设置页，官方应用使用本地服务的 `/settings` 页面；两者共享能力模型，但不共享业务配置结构。

**Tech Stack:** Rust/Tauri、serde YAML/JSON、React/TypeScript、shadcn/ui、Vitest、Cargo test。

## Global Constraints

- 应用业务配置不得写入 `shell.config.json`、`shell.db` 或插件源码目录。
- 官方应用默认卸载只删除源码、依赖和运行环境，保留 `app-data/<app-id>/`。
- 官方应用与 aIdea 的稳定边界是环境变量和已定义的平台命令，不依赖 Tauri IPC 或壳前端 IPC 封装。
- 内置应用前端的 Tauri 调用统一通过 `shell-frontend/src/lib/ipc.ts`。
- reset command 必须使用参数数组，不使用 shell 字符串、`sh -c` 或 `bash -c`。
- Touch ID 只由 aIdea 发起；重置失败不得静默删除或覆盖原配置。
- 不新增通用配置 schema、自动表单生成器、共享业务数据库或新的第三方依赖。
- 每次代码修改后运行对应的前端或 Rust 最小测试，完成后执行仓库根目录约定的 lint、build 和 test 闭环。

---

## Task 1: 增加应用设置能力模型

**Files:**
- Modify: `shell-native/src/manifest.rs`
- Modify: `shell-native/src/plugin_market.rs`
- Modify: `shell-native/src/plugin_installer.rs`
- Modify: `shell-frontend/src/types/manifest.ts`
- Modify: `shell-frontend/src/types/plugin-market.ts`
- Modify: `shell-native/tests/manifest_test.rs`
- Modify: `shell-native/src/plugin_market.rs` tests
- Test: `shell-frontend/tests/manifest-loader.test.ts`

**Interfaces:**
- Add Rust `SettingsConfig { enabled: bool, reset_command: Option<Vec<String>> }`.
- Reuse the Rust `SettingsConfig` from `manifest.rs` in `plugin_market.rs`; do not define a second equivalent struct.
- Add optional `settings: Option<SettingsConfig>` to `AppManifest`.
- Add the same settings capability to `OfficialPluginDefinition` and `OfficialPlugin`, and copy it through `CachedOfficialPlugin::into_plugin` and `installed_app_manifest`.
- Add TypeScript `SettingsConfig` and `settings?: SettingsConfig` to the matching manifest and official-plugin types.
- The settings page path is fixed as `/settings`; do not add a configurable path field.

- [ ] **Step 1: Write failing Rust tests for settings parsing and command validation**

Add cases to the existing manifest/market tests:

```rust
let yaml = "settings:\n  enabled: true\n  reset_command: [node, scripts/reset-config.mjs]\n";
let settings: SettingsConfig = serde_yaml::from_str(yaml).unwrap();
assert!(settings.enabled);
assert_eq!(settings.reset_command.unwrap()[0], "node");
```

Add a definition validation case where `reset_command: [sh, -c, echo bad]` is rejected by the same command-array validation used for install/process commands.

- [ ] **Step 2: Run the focused Rust tests and verify they fail**

Run:

```bash
cargo test --manifest-path shell-native/Cargo.toml manifest_test --quiet
cargo test --manifest-path shell-native/Cargo.toml plugin_market --quiet
```

Expected: compilation or assertion failure because `SettingsConfig` and the manifest fields do not exist yet.

- [ ] **Step 3: Add the settings structs and propagate them through official definitions**

Use serde defaults so old installed definitions without a `settings` block continue to load:

```rust
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct SettingsConfig {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub reset_command: Option<Vec<String>>,
}
```

Validate `reset_command` only when present. Reject an empty command and any command containing shell wrapper arguments, using the existing `validate_command` helper. Do not require every application to expose settings.

- [ ] **Step 4: Update TypeScript types and compatibility tests**

Add the same optional shape to frontend types. Keep old mocked `ShellConfig` values valid. Add a manifest-loader test proving an app with no `settings` field remains visible and an app with `settings.enabled = false` does not get a settings action.

- [ ] **Step 5: Run the focused tests and lint**

Run:

```bash
cargo test --manifest-path shell-native/Cargo.toml manifest_test --quiet
cargo test --manifest-path shell-native/Cargo.toml plugin_market --quiet
cd shell-frontend && npm test -- manifest-loader.test.ts && npm run lint
```

Expected: all focused tests pass.

## Task 2: 持久化 DevTools 的内部工具偏好

**Files:**
- Create: `shell-native/src/commands/dev_tools.rs`
- Modify: `shell-native/src/commands/mod.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-native/src/config.rs` to add `app_data_dir(app_id: &str) -> AppResult<PathBuf>`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Create: `shell-frontend/src/types/dev-tools.ts`
- Test: `shell-native/src/commands/dev_tools.rs` module tests

**Interfaces:**
- Rust `DevToolsSettings { hidden_tabs: BTreeSet<String> }`.
- Tauri commands `get_dev_tools_settings() -> AppResult<DevToolsSettings>` and `save_dev_tools_settings(settings: DevToolsSettings) -> AppResult<()>`.
- Frontend IPC methods `getDevToolsSettings()` and `saveDevToolsSettings(settings)`.
- Storage path: `data_root()/app-data/dev-tools/settings.json`; create only this directory as needed.

- [ ] **Step 1: Write failing persistence tests**

Cover these cases in the Rust command module:

```rust
let settings = load_settings_from(temp_dir.path()).unwrap();
assert!(settings.hidden_tabs.is_empty());

save_settings_to(temp_dir.path(), DevToolsSettings {
    hidden_tabs: ["unicode".to_string()].into_iter().collect(),
}).unwrap();

assert!(load_settings_from(temp_dir.path())
    .unwrap()
    .hidden_tabs
    .contains("unicode"));
```

Also verify malformed JSON returns an error and does not silently reset the file.

- [ ] **Step 2: Run the focused Rust test and verify it fails**

Run:

```bash
cargo test --manifest-path shell-native/Cargo.toml commands::dev_tools --quiet
```

Expected: failure because the command module and persistence functions do not exist.

- [ ] **Step 3: Implement the smallest typed JSON store for DevTools**

Use `serde_json`, write serialized content to `settings.json.tmp`, then rename it to `settings.json`. Do not delete the settings file when the set is empty; serialize the default shape so reset and first-run behavior are observable and recoverable. Export `reset_dev_tools_settings() -> AppResult<()>` for the shell reset command; it removes only `settings.json` and ignores a missing file. `app_data_dir(app_id)` must reject empty IDs, path separators, `..`, and control characters before joining the data root.

Keep the known tab list in the frontend. The Rust side only validates that IDs are non-empty and contains no control characters; it must not duplicate the DevTools tab registry.

- [ ] **Step 4: Register the commands and IPC wrappers**

Register both commands in `shell-native/src/lib.rs` and add typed wrappers in `shell-frontend/src/lib/ipc.ts`. No DevTools component may import `invoke` directly.

- [ ] **Step 5: Run the focused Rust and frontend checks**

Run:

```bash
cargo test --manifest-path shell-native/Cargo.toml commands::dev_tools --quiet
cd shell-frontend && npm run lint
```

## Task 3: 为 DevTools 增加自己的设置页面和 tab 筛选

**Files:**
- Create: `shell-frontend/src/builtin-apps/dev-tools/DevToolsSettingsPage.tsx`
- Create: `shell-frontend/src/builtin-apps/dev-tools/tabs.ts`
- Modify: `shell-frontend/src/builtin-apps/dev-tools/index.tsx`
- Modify: `shell-frontend/src/components/BuiltinPage.tsx`
- Modify: `shell-frontend/src/types/dev-tools.ts`
- Test: `shell-frontend/tests/dev-tools/DevToolsSettingsPage.test.tsx`
- Test: `shell-frontend/tests/dev-tools/DevToolsPage.test.tsx`

**Interfaces:**
- Export a stable tab registry from `tabs.ts` with IDs `data`, `timestamp`, `ip`, and `ai` plus labels and render functions kept in the existing components.
- `DevToolsPage` accepts `settingsOpen: boolean` and `onOpenSettings: () => void`; when settings are open it renders `DevToolsSettingsPage` and does not mount hidden tabs.
- `DevToolsSettingsPage` accepts `onClose: () => void` and loads/saves `DevToolsSettings` through `ipc`.

- [ ] **Step 1: Write failing component tests**

Test that:

```tsx
mockGetDevToolsSettings.mockResolvedValue({ hidden_tabs: ['ip'] });
render(<DevToolsSettingsPage onClose={vi.fn()} />);
expect(await screen.findByLabelText('IP 查询')).not.toBeChecked();
```

Test that hidden tabs are not rendered in `DevToolsPage`, new tabs are visible by default, and hiding all tabs is rejected with an error message while leaving one tab visible.

- [ ] **Step 2: Run the focused frontend tests and verify they fail**

Run:

```bash
cd shell-frontend && npm test -- DevToolsSettingsPage.test.tsx DevToolsPage.test.tsx
```

Expected: failure because the settings page and tab registry do not exist.

- [ ] **Step 3: Add the tab registry and settings page**

Keep the current tab state preservation for data/timestamp inputs. Filter only the tab list and active content; do not duplicate tab components. When the current tab becomes hidden, select the first visible tab. Require at least one visible tab.

- [ ] **Step 4: Wire the settings button into DevTools**

Use the existing lucide icon/button and tooltip conventions. The DevTools settings page is an app-owned page; it must not write shell-level `app_settings` or `shell.config.json`.

- [ ] **Step 5: Run focused tests and lint**

Run:

```bash
cd shell-frontend && npm test -- DevToolsSettingsPage.test.tsx DevToolsPage.test.tsx && npm run lint
```

## Task 4: 增加应用管理中的设置入口与重置入口

**Files:**
- Modify: `shell-frontend/src/components/AppManagementPage.tsx`
- Modify: `shell-frontend/src/components/SettingsPanel.tsx`
- Modify: `shell-frontend/src/App.tsx`
- Modify: `shell-frontend/src/components/ContentArea.tsx`
- Modify: `shell-frontend/src/components/WebviewFrame.tsx`
- Modify: `shell-frontend/src/components/BuiltinPage.tsx`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Test: `shell-frontend/tests/components/AppManagementPage.test.tsx`
- Test: `shell-frontend/tests/components/AppSettingsNavigation.test.tsx`

**Interfaces:**
- `AppManagementPage` receives `onOpenAppSettings(app: AppManifest)`.
- `SettingsPanel` forwards `onOpenAppSettings` from `App` and closes after navigation.
- `ContentArea` accepts `settingsTarget: AppManifest | null` and `onCloseSettings`.
- `WebviewFrame` accepts `path?: string`; when set, it appends `/settings` to the validated local base URL.
- `BuiltinPage` accepts `settingsOpen` and `onOpenSettings` and routes the registered built-in settings page.

- [ ] **Step 1: Write failing frontend tests**

Add tests that:

- an app with `settings.enabled` shows a settings icon in application management;
- an app without settings capability does not show it;
- clicking settings closes the modal, selects that app, and opens either the built-in settings component or the official app `/settings` URL;
- the reset action calls `ipc.resetAppSettings` and refreshes the app list after success.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
cd shell-frontend && npm test -- AppManagementPage.test.tsx AppSettingsNavigation.test.tsx
```

Expected: failure because the callback, IPC method, and settings target state do not exist.

- [ ] **Step 3: Add the settings navigation state**

Keep the existing settings modal as the entry point. On “设置”:

```text
setActiveApp(app.id)
setSettingsTarget(app)
closeSettingsDialog()
```

For a builtin app, render its registered settings page. For a webview app, keep the app in the main content area and set the iframe path to `/settings`. Add a compact “返回应用” action so users can leave the settings page without restarting the app.

- [ ] **Step 4: Add reset UI and IPC wrapper**

Show “重置设置” only when the manifest exposes reset capability. The UI must state that this action requires macOS identity verification. The component does not implement its own confirmation or invoke Touch ID directly; it calls `ipc.resetAppSettings(app.id)`.

- [ ] **Step 5: Run focused tests, lint and build**

Run:

```bash
cd shell-frontend && npm test -- AppManagementPage.test.tsx AppSettingsNavigation.test.tsx && npm run lint && npm run build
```

## Task 5: 实现 Touch ID 授权后的应用配置重置

**Files:**
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Test: `shell-native/src/commands/shell.rs` unit tests
- Test: `shell-native/src/process.rs` tests for restart-state behavior
- Test: `shell-frontend/tests/components/AppManagementPage.test.tsx`

**Interfaces:**
- Add Tauri command `reset_app_settings(id: String, manager: State<'_, ProcessManager>) -> AppResult<()>`.
- Add frontend wrapper `resetAppSettings(id: string): Promise<void>`.
- Add a private Rust helper that validates the target manifest and returns `AppError::Config` when settings reset is unsupported.

- [ ] **Step 1: Write failing pure Rust tests**

Cover these branches without invoking macOS authentication:

- an app without reset capability is rejected;
- a reset command with an empty program is rejected;
- a stopped app does not request a restart;
- a running app is marked for restart after reset;
- a reset command failure is returned to the caller.

Keep the Touch ID call at the command boundary so the pure tests do not depend on a GUI authentication prompt.

- [ ] **Step 2: Run the focused Rust tests and verify they fail**

Run:

```bash
cargo test --manifest-path shell-native/Cargo.toml commands::shell process::tests --quiet
```

Expected: failure because the command and reset helpers do not exist.

- [ ] **Step 3: Authenticate and execute the reset command**

The command must:

1. Load the target manifest/official definition.
2. Call `crate::mac_auth::authenticate_local_user("重置应用设置")?`.
3. Record whether the official process is running.
4. Stop it before reset.
5. Execute the manifest reset command with `tokio::process::Command::new(...).args(...)`.
6. Set `AIDEA_APP_ID`, `AIDEA_APP_DATA_DIR`, and `AIDEA_APP_LOG_DIR` in the child environment.
7. Restart the app only when it was running before the reset, even when the reset process fails.
8. Return the reset process error after the restart attempt, without deleting any data directory.

For builtin apps, route the reset through a small explicit match for registered builtin handlers. The first handler is `dev-tools`, which removes only its settings file and leaves all other app data untouched. Do not add a generic dynamic plugin loader.

- [ ] **Step 4: Register the command and verify frontend behavior**

Register `reset_app_settings` in `shell-native/src/lib.rs`. The frontend test must verify that a successful reset reloads app state and that a rejected reset displays the existing toast error path.

- [ ] **Step 5: Run Rust tests and the frontend reset test**

Run:

```bash
cargo test --manifest-path shell-native/Cargo.toml commands::shell process::tests --quiet
cd shell-frontend && npm test -- AppManagementPage.test.tsx
```

## Task 6: 将契约写入现行平台文档和内置 Manifest

**Files:**
- Modify: `docs/app/platform.md`
- Modify: `docs/app/package-spec.md`
- Modify: `docs/app/data-layout.md`
- Modify: `docs/app/storage.md`
- Modify: `AGENTS.md`
- Modify: `apps/builtin/dev-tools.yaml`
- Modify: `apps/builtin/mail-manager.yaml`

**Interfaces:**
- Document `settings.enabled`, fixed `/settings`, and `reset_command` only after Task 1 and Task 5 are implemented.
- Document DevTools `hidden_tabs` as app-owned state, not shell `app_settings`.
- Document that standalone operation means core application startup and data access, not an independent desktop shell.

- [ ] **Step 1: Update the docs after code support exists**

Do not document an unsupported command as available. The package example must show:

```yaml
settings:
  enabled: true
  reset_command: [node, scripts/reset-config.mjs]
```

Explain that `/settings` is fixed and no field-level schema is exchanged with aIdea.

- [ ] **Step 2: Update builtin manifests**

Mark only applications that actually expose a settings page and reset handler. Do not add a settings block to an app just to make the UI show an unusable button.

- [ ] **Step 3: Run documentation consistency checks**

Run:

```bash
rg -n "settings:|reset_command|/settings|hidden_tabs|shell.config.json|app-data" AGENTS.md docs/app docs/superpowers/specs/2026-08-09-app-settings-and-runtime-design.md
git diff --check
```

## Task 7: 全量验证和交付检查

**Files:**
- Test: all changed Rust and frontend tests

- [ ] **Step 1: Run focused tests one last time**

Run:

```bash
cargo test --manifest-path shell-native/Cargo.toml --quiet
cd shell-frontend && npm test -- --run
```

- [ ] **Step 2: Run the repository-required checks**

Run:

```bash
cd shell-frontend && npm run lint && npm run build
cd .. && npm test
```

Expected: Rust tests pass, frontend tests pass, lint passes, and build passes. Existing non-blocking React `act(...)` or jsdom layout warnings must be reported rather than hidden.

- [ ] **Step 3: Inspect the final diff**

Verify that every changed line belongs to the settings contract, DevTools preference, reset flow, or required documentation. Do not stage, commit, push, or create a PR.

## 外部官方应用的后续接入

官方应用仓库不在当前工作区内，因此本计划只实现 aIdea 壳侧契约和运行入口。每个官方应用接入时必须单独完成：

- `/health` 和 `/settings` 页面；
- `reset_command`，且只重置配置不删除业务数据；
- `AIDEA_APP_DATA_DIR` 存储适配；
- 有 aIdea 环境和无 aIdea 环境的启动测试；
- 应用自己的配置版本迁移测试。

这部分不通过在 aIdea 仓库增加通用 SDK 来解决。
