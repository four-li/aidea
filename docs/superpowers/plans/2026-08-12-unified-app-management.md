# 应用管理边界实施计划

> **历史实施记录，已完成。** 本计划保留实施过程和测试意图，不应再次执行。当前行为以 `docs/guide/aidea-platform.md`、`docs/guide/aidea-official-app.md` 和 `docs/superpowers/specs/2026-08-12-app-management-boundary-design.md` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将“应用管理”限定为 aIdea 的应用入口、显示偏好和生命周期管理；官方应用的业务设置完全回到应用自身主页面，内置应用继续使用壳内设置页。

**Architecture:** 保留已经完成的“应用管理 + 可安装应用”单页结构和卸载确认。前端只为内置应用保留设置详情与重置入口；官方应用不显示齿轮，生命周期操作和“随开搞启动”在更多菜单中。Rust 官方市场定义不再接受 `settings`，`reset_app_settings` 只处理内置应用。邮件中心用现有 React 状态在邮件页和账户设置页之间切换，不新增路由库或共享 SDK。

**Tech Stack:** React 18、TypeScript、Vitest、Testing Library、Rust、Tauri、serde、现有 Radix DropdownMenu、邮件中心现有 React/Vite/Rust 二进制包。

## Global Constraints

- 不新增页面路由、后端 IPC、npm/crates 依赖、SDK、共享业务设置协议或数据库。
- 官方应用只支持 macOS Apple Silicon（arm64）单个 `runtime: binary` 包；不引入 Intel 或多架构分发。
- `GET /health` 是官方应用唯一的强制 HTTP 入口；`process.ready_url` 必须继续是本地 `127.0.0.1` 的 `/health`。
- 主页面继续使用 `aidea_theme` 首屏参数和 App Bridge 的 `ready`、运行期 `theme`、通知与应用内跳转；搜索继续由应用自身完成。
- 官方应用的“显示在主页”只写 `shell.config.json` 的 `visible`，不影响进程；“随开搞启动”只写 `startup_mode`。
- 卸载只移除安装文件，保留 `app-data/<app-id>/app.db` 和日志；必须先显示确认弹窗。
- 不自动执行 `git add`、commit、push 或创建 PR。
- 已存在的未提交发布文件属于用户工作区，不能回滚、覆盖或借此计划清理。

---

## 文件地图

| 文件 | 职责 |
| --- | --- |
| `shell-frontend/src/components/AppManagementPage.tsx` | 已安装/可安装应用页面，区分内置和官方应用可用操作。 |
| `shell-frontend/tests/components/AppManagementPage.test.tsx` | 官方无设置入口、内置仍可设置、官方菜单偏好操作。 |
| `shell-native/src/official_market.rs` | 解析并验证官方应用 `aidea.yaml`；拒绝官方 `settings`。 |
| `shell-native/src/official_app_installer.rs` | 从官方定义生成壳内 manifest；不再携带官方设置配置。 |
| `shell-native/src/commands/shell.rs` | 只允许内置应用配置重置。 |
| `AGENTS.md`、`docs/guide/*.md`、`samples/official-app-reference/*` | 平台契约和范本的单一事实来源。 |
| `/Users/fourli/atlas/user-agents/skills/aidea-app/SKILL.md` | 官方应用 agent 的硬约束。 |
| `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/web/src/App.tsx` | 邮件中心内部页面状态。 |
| `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/web/src/pages/MailPage.tsx` | 邮件主页面的账户设置入口。 |
| `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/web/src/pages/SettingsPage.tsx` | 账户表单和应用内返回。 |

---

### Task 1: 收紧应用管理页的官方应用操作

**Files:**
- Modify: `shell-frontend/src/components/AppManagementPage.tsx`
- Modify: `shell-frontend/tests/components/AppManagementPage.test.tsx`

**Interfaces:**
- Consumes: `AppManifest.ui.mode`、`AppUserSettings`、`ipc.saveAppUserSettings(id, settings)`、现有 `DropdownMenuCheckboxItem`。
- Produces: 官方应用只有“显示在主页”开关和更多菜单；内置应用仍可打开 `AppSettingsDetail`。

- [ ] **Step 1: 将旧测试改成新边界**

删除官方应用打开 `/settings`、停止后自动启动、官方 `reset_command` 的测试。添加断言：

```tsx
expect(screen.getByRole('button', { name: 'DevTools 设置' })).toBeInTheDocument();
expect(screen.queryByRole('button', { name: '邮件管理 设置' })).not.toBeInTheDocument();
expect(screen.queryByText('邮件管理设置')).not.toBeInTheDocument();
```

新增官方菜单测试：触发“随开搞启动”后应调用：

```tsx
expect(mockSaveAppUserSettings).toHaveBeenCalledWith('official-mail', {
  visible: true,
  startup_mode: 'with-aidea',
});
```

将列表开关断言改成 `邮件管理 显示在主页`；关闭后应只保存 `visible: false`，保留原有 `startup_mode`。

- [ ] **Step 2: 运行失败测试**

Run: `cd shell-frontend && npm test -- AppManagementPage.test.tsx`

Expected: FAIL；旧实现仍显示官方应用齿轮和 `/settings`，且菜单没有“随开搞启动”。

- [ ] **Step 3: 删除官方设置入口**

在卡片中只对 `builtin` 渲染齿轮，点击直接 `setDetailId(app.id)`。删除 `openSettings`，它唯一用途是为官方应用启动进程并打开 `/settings`。

限制详情目标：

```tsx
const detailApp = apps.find((app) => app.id === detailId && app.ui.mode === 'builtin') ?? null;
```

从 `AppSettingsDetail` 移除 `state`、`theme`、`WebviewFrame` 分支和启动偏好区。只保留内置应用注册设置组件、空状态和内置 `reset_command` 的确认重置。删除无用 imports。

- [ ] **Step 4: 让显示和启动偏好处在正确位置**

将卡片开关的无障碍名称改为：

```tsx
aria-label={`${app.name} 显示在主页`}
```

在官方应用且存在 `app.process` 时，更多菜单的进程操作之后添加已有组件：

```tsx
<DropdownMenuCheckboxItem
  checked={appSettings.startup_mode === 'with-aidea'}
  disabled={pending}
  onCheckedChange={(checked) =>
    void saveSettings(app, {
      ...appSettings,
      startup_mode: checked ? 'with-aidea' : 'manual',
    })
  }
>
  随开搞启动
</DropdownMenuCheckboxItem>
```

保留启动、停止、重启、更新、日志、卸载及卸载确认。不增加“打开应用”按钮或官方详情页。

- [ ] **Step 5: 验证**

Run: `cd shell-frontend && npm test -- AppManagementPage.test.tsx`

Expected: PASS；内置设置和重置可用，官方应用没有齿轮或 iframe，显示和启动偏好分别写入正确字段。

### Task 2: 从官方定义和重置命令移除业务设置能力

**Files:**
- Modify: `shell-native/src/official_market.rs`
- Modify: `shell-native/src/official_app_installer.rs`
- Modify: `shell-native/src/commands/shell.rs`

**Interfaces:**
- Consumes: 官方应用 `aidea.yaml` 与旧 `install-state.yaml` 快照。
- Produces: 新定义出现 `settings` 时失败；旧快照可读取但不能被壳重置；内置 DevTools 重置不受影响。

- [ ] **Step 1: 添加失败测试**

在 `official_market.rs` tests 中对完整 YAML 追加：

```yaml
settings:
  reset_command: [builtin, dev-tools]
```

并断言：

```rust
assert!(serde_yaml::from_str::<OfficialAppDefinition>(&yaml).is_err());
```

在 `commands/shell.rs` tests 中，为带 `SettingsConfig` 的 `UiMode::Webview` manifest 断言：

```rust
assert!(builtin_reset_command_for(&official_manifest).is_err());
assert!(builtin_reset_command_for(&builtin_manifest).is_ok());
```

- [ ] **Step 2: 运行失败测试**

Run: `cd shell-native && cargo test official_market::tests --lib && cargo test commands::shell::tests --lib`

Expected: FAIL；旧定义仍接受 `settings`，且重置路径仍可能执行官方应用外部命令。

- [ ] **Step 3: 删除官方 `settings` 模型**

在 `official_market.rs` 中删除 `SettingsConfig` import 及 `OfficialAppDefinition`、`OfficialApp`、`CachedOfficialApp::into_app` 的 `settings` 字段，也删除 `validate_definition` 中的 reset command 校验。

`OfficialAppDefinition` 已有 `#[serde(deny_unknown_fields)]`，删字段后新的市场定义会明确失败。不要给 `OfficialApp` 加这个属性，旧 `install-state.yaml` 的未知字段应继续被 serde 忽略。

在 `official_app_installer.rs` 的 `installed_app_manifest` 中固定：

```rust
settings: None,
```

并移除复制 `definition.settings` 的代码。

- [ ] **Step 4: 重置 IPC 只执行内置处理器**

删除 `run_reset_command`、`should_restart_after_reset` 和仅供它们使用的 `Command`、`app_data_dir` import。新增：

```rust
fn builtin_reset_command_for(manifest: &AppManifest) -> AppResult<&[String]> {
    if manifest.ui.mode != crate::manifest::UiMode::Builtin {
        return Err(AppError::Config(format!(
            "{} 不是内置应用，不能通过 aIdea 重置",
            manifest.name
        )));
    }
    reset_command_for(manifest)
}
```

将 `reset_app_settings` 改为：

```rust
let manifest = find_manifest(&id)?;
builtin_reset_command_for(&manifest)?;
match id.as_str() {
    "dev-tools" => crate::commands::dev_tools::reset_dev_tools_settings(),
    _ => Err(AppError::Config(format!("{} 未注册重置处理器", manifest.name))),
}
```

这保证旧官方安装记录中的 `settings.reset_command` 无法停止进程、运行程序或重启应用。

- [ ] **Step 5: 验证**

Run: `cd shell-native && cargo test official_market::tests --lib && cargo test commands::shell::tests --lib && cargo test`

Expected: PASS；新官方定义拒绝 `settings`，内置重置仍通过，官方应用没有可调用的重置路径。

### Task 3: 收口文档、Skill 和官方应用范本

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/guide/aidea-platform.md`
- Modify: `docs/guide/aidea-official-app.md`
- Modify: `docs/guide/aidea-app-bridge.md`
- Modify: `docs/guide/aidea-ui.md`
- Modify: `docs/guide/aidea-builtin-app.md`
- Modify: `samples/official-app-reference/README.md`
- Modify: `samples/official-app-reference/src/main.ts`
- Modify: `/Users/fourli/atlas/user-agents/skills/aidea-app/SKILL.md`

**Interfaces:**
- Consumes: Task 1/2 的真实行为。
- Produces: agent 阅读任意入口文档都不会再被引导实现 `/settings`、官方应用重置或壳内业务表单。

- [ ] **Step 1: 更新全部契约来源**

统一规则如下：

- `AGENTS.md`：官方应用只由 aIdea 管理生命周期、显示/启动偏好、安装环境与日志；设置入口限定内置应用。
- `aidea-platform.md`：内置应用有设置详情；官方应用卡片只提供显示在主页和更多菜单生命周期操作，业务配置不在应用管理。
- `aidea-official-app.md`：删示例的 `settings`、所有 `/settings` 和 `settings.reset_command` 要求；主题和 Bridge 只描述主页面；账户、同步周期等业务入口在应用主页面。
- `aidea-app-bridge.md`：删 `/settings` 的端点、例外握手和生命周期段落；只保留 `/health` 和根主页面约定。
- `aidea-ui.md`：首屏主题参数只描述官方应用主页面，运行期主题只在主页面 `ready` 后下发。
- `aidea-builtin-app.md`：明确 `settings.reset_command` 只属于内置 manifest，删“所有应用共用设置按钮”和官方 `/settings` 描述。
- `$aidea-app` Skill：删除“壳负责打开 `/settings`”和“必须提供 `/settings`”；写明账户等业务设置由应用主页面自己进入。

不要修改健康检查、`document.referrer` 来源校验、搜索独立、数据目录或 arm64 二进制包规则。

- [ ] **Step 2: 简化范本**

在范本 `main.ts` 删除：

```ts
const settings = window.location.pathname === '/settings';
const isSettingsPage = window.location.pathname === '/settings';
```

以及所有条件渲染和 `ready` 豁免。范本始终渲染主页面；父源合法时总是建立 Bridge 并发送 `ready`。

范本 README 改为：业务设置由应用自己的主页面内导航完成，不属于 App Bridge 或壳契约。

- [ ] **Step 3: 扫描验证**

Run:

```bash
rg -n "/settings|settings\.reset_command|官方应用.*重置|官方应用.*设置入口" \
  AGENTS.md docs/guide samples/official-app-reference \
  /Users/fourli/atlas/user-agents/skills/aidea-app/SKILL.md
git diff --check
```

Expected: 结果不得再把 `/settings` 或 `settings.reset_command` 表述为官方应用能力；仅允许内置应用专用说明或历史兼容说明。差异检查无输出。

### Task 4: 将邮件账户设置接回邮件中心主页面

**Files:**
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/web/src/App.tsx`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/web/src/pages/MailPage.tsx`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/web/src/pages/SettingsPage.tsx`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/web/src/pages/MailPage.test.tsx`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/web/src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Consumes: 现有 `MailPage`、`SettingsPage`、账户 API 和 lucide `Settings` 图标。
- Produces: 邮件主页面可打开账户设置；返回邮件中心是 React 状态切换，不依赖 aIdea 或 `/settings` iframe。

- [ ] **Step 1: 写失败测试**

在 `MailPage.test.tsx`：

```tsx
const onOpenSettings = vi.fn();
render(<MailPage onOpenSettings={onOpenSettings} />);
fireEvent.click(await screen.findByRole('button', { name: '账户设置' }));
expect(onOpenSettings).toHaveBeenCalledTimes(1);
```

保留无账户时同步按钮的 toast，但文案改为“请先在账户设置中添加邮箱账户”，不再写“应用设置”。

在 `SettingsPage.test.tsx` 传 `onClose`，点击“返回邮件中心”后断言 callback 被调用，而不是修改 `window.location.pathname`。

- [ ] **Step 2: 运行失败测试**

Run: `cd /Users/fourli/Desktop/app/aidea-plugins/mail-manager && npm test -- MailPage.test.tsx SettingsPage.test.tsx`

Expected: FAIL；旧 `MailPage` 没有 `onOpenSettings` 和账户设置按钮，旧 `SettingsPage` 直接修改地址。

- [ ] **Step 3: 最小内部导航实现**

在 `App.tsx` 用 `useState<'mail' | 'settings'>('mail')`，不增加 react-router：

```tsx
export function App() {
  const [page, setPage] = useState<'mail' | 'settings'>('mail');
  return page === 'settings' ? (
    <SettingsPage onClose={() => setPage('mail')} />
  ) : (
    <MailPage onOpenSettings={() => setPage('settings')} />
  );
}
```

`MailPage` props 新增 `onOpenSettings`，标题栏使用现有 `icon-button has-tooltip`，新增 `Settings` 图标的“账户设置”按钮。无账户同步提示改成：

```ts
toast.info('请先添加邮箱账户', { description: '请先在账户设置中添加邮箱账户。' });
```

`SettingsPage` props 新增 `onClose`，返回按钮使用 `onClick={onClose}`。不改现有添加、编辑、测试、保存、删除账户和凭据不回显逻辑，不改 API、数据库或账号数据。

不要保留 `window.location.pathname === '/settings'` 分支；新版 aIdea 不会访问它。

- [ ] **Step 4: 校验版本和发布输入**

确认 `package.json` 与 `Cargo.toml` 都是待发布 patch（当前预期 `0.1.7`）。这是用户可见交互变化，必须形成源码提交 C1；不能让 C1 中的 `aidea.yaml.revision` 指向自身。

用 C1 构建 arm64 包并算 SHA-256 后，创建 C2 更新 `aidea.yaml` 的版本、revision、artifact URL、SHA-256。C2 只更新市场定义，不重新构建包。发布前提是含 Task 1-3 的 aIdea 已发布。

- [ ] **Step 5: 验证**

Run:

```bash
cd /Users/fourli/Desktop/app/aidea-plugins/mail-manager
npm test
npm run build
cargo test
cargo fmt --check
cargo clippy -- -D warnings
git diff --check
```

Expected: PASS；账户入口、返回、添加/编辑/测试/保存/删除的测试通过，包能构建。手工检查浅色/深色下主页面、账户设置页和邮件正文可读。

### Task 5: aIdea 交付验证和真实回归

**Files:**
- 仅在前置测试暴露必要问题时修改；本任务不顺手重构。

**Interfaces:**
- Consumes: Task 1-4 完成代码和官方市场已发布的邮件中心版本。
- Produces: 可交付的 aIdea 壳版本与邮件中心正式包验证记录。

- [ ] **Step 1: 自动验证**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-frontend
npm run lint
npm test
npm run build
cd ../shell-native
cargo test
git -C /Users/fourli/Desktop/app/aIdea diff --check
```

Expected: 前端 lint、测试、构建成功；Rust 全测成功；差异无空白错误。

- [ ] **Step 2: 手工验收壳侧**

1. 设置侧栏只有“应用管理”，页面默认同时显示已安装与可安装应用。
2. 官方邮件中心卡片没有齿轮或“打开应用”，有“显示在主页”开关和更多菜单。
3. 关闭“显示在主页”后，邮件中心仍能更新、看日志、启动、停止、重启和卸载。
4. “随开搞启动”在重启 aIdea 后保持，且只影响启动偏好。
5. 内置 DevTools 仍有齿轮、内置设置页和重置确认。
6. 卸载邮件中心先弹确认；确认后安装文件移除，`app-data/mail-center/app.db` 与日志仍在。

- [ ] **Step 3: 手工验收邮件中心**

1. 邮件主页面“账户设置”直接进入账户表单，不经过 aIdea 应用管理。
2. 添加、测试、保存账户后，返回邮件中心可使用该账户。
3. 编辑账户时凭据不回显；删除账户仍走确认。
4. 浅色、深色主题下，邮件主页面、账户设置页和邮件正文可读。
5. 首次安装、启动、更新和卸载不请求 `/settings`；`/health`、主题和 App Bridge `ready/theme` 正常。

- [ ] **Step 4: 报告未验证项**

交付时明确真实邮箱服务商、网络中断、IDLE 到信、正式市场更新与回滚中哪些已实测，哪些未实测及原因。不能把静态测试通过表述为真实发布安装已验证。

## 计划自检

- **规格覆盖：** 官方无壳内设置页、内置设置保留、显示/启动偏好、市场拒绝旧字段、后端重置限制、文档/Skill/范本、邮件主页面入口、版本发布顺序、自动和手工验证均有任务。
- **范围控制：** 不新增 SDK、全局设置协议、路由库、第三方市场、数据迁移、Touch ID 或跨平台包。
- **兼容策略：** 旧官方安装记录中的未知 `settings` 可被解析但不再使用；新市场定义明确拒绝该字段。
- **命名一致性：** UI 使用“显示在主页”“随开搞启动”“账户设置”；协议字段保持 `visible`、`startup_mode`、`ready_url`。
