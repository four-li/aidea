# 统一日志与诊断实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 aIdea 持久记录壳、内置应用和官方应用的故障证据，并在生产级日志工作台中按来源查看和复制。

**Architecture:** 新建单一 Rust `diagnostics` 模块，负责目录定位、带时间戳写入、按日期/容量滚动、保留清理和最近日志读取；不新增日志依赖。官方应用的 stdout/stderr 和 staging 输出由现有进程管理器捕获，壳与前端的未处理错误写入对应平台日志；React 只消费类型化 IPC 并实现已确认的日志工作台和全局设置。

**Tech Stack:** Rust、Tokio、Tauri 2、Serde、Chrono、React 18、TypeScript、Vitest、Testing Library、现有 shadcn/ui。

**Spec:** `docs/superpowers/specs/2026-08-15-unified-log-diagnostics-design.md`

## Global Constraints

- 日志始终开启，不提供日志等级、调试开关、每应用覆盖、搜索、筛选、导出或 ZIP 诊断包。
- 日志时间统一显示为本地时间 `YYYY-MM-DD HH:mm:ss`；时区只在日志文件元数据中保存一次。
- 全局默认保留 `30` 天、总容量 `500 MB`；旧 `shell.config.json` 缺字段时采用默认值。
- 日志只在 `~/Library/Application Support/aIdea/logs/` 内创建、读取和清理，绝不触及 `app-data/`、`apps/installed/`、`runtime/` 或 `backups/`。
- 壳不得记录令牌、密码、授权码、OAuth 值、邮件正文、通知正文、数据库内容或本地文件正文；官方应用仍必须保证 stdout/stderr 不输出这些内容。
- 官方应用、内置应用和壳日志必须隔离在 `official/<id>/`、`builtin/<id>/`、`aidea/system/`；兼容读取旧 `logs/<id>/app.log` 与 `logs/<id>/install.log`。
- 不添加依赖、不新增每应用配置、不自动 `git add`、commit、push 或创建 PR。所有代码注释使用中文。
- 本功能改变用户可见 UI 和日志数据格式；完成实现时同步递增 aIdea 版本及发布变更记录。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `shell-native/src/diagnostics.rs` | 日志目录、写入、滚动、清理、旧文件兼容读取和 IPC 数据模型。 |
| `shell-native/src/config.rs` | `ShellConfig` 顶层日志策略字段的默认值与校验。 |
| `shell-native/src/process.rs` | 官方应用正常运行和 staging 健康检查的 stdout/stderr 捕获、退出状态和平台事件。 |
| `shell-native/src/official_app_installer.rs` | 安装/更新阶段改用统一安装日志写入。 |
| `shell-native/src/commands/shell.rs` | 日志设置、读取、aIdea 事件和内置前端错误的 Tauri 命令。 |
| `shell-native/src/lib.rs` | 注册模块和新增 Tauri 命令，记录壳启动/关闭。 |
| `shell-frontend/src/types/diagnostics.ts` | 日志作用域、日志响应和日志设置的前端类型。 |
| `shell-frontend/src/lib/ipc.ts` | 日志设置、日志读取和内置错误上报的统一 IPC。 |
| `shell-frontend/src/components/LogWorkspace.tsx` | 已确认的独立日志工作台。 |
| `shell-frontend/src/components/SettingsPanel.tsx` | 高级页日志策略和“查看 aIdea 日志”。 |
| `shell-frontend/src/App.tsx` | 记录未处理前端错误和 Promise 拒绝。 |
| `shell-frontend/src/components/AppManagementPage.tsx` | 使用日志工作台入口替换旧 `LogPanel` 调用。 |

### Task 1: 全局策略与 Rust 日志存储

**Files:**
- Create: `shell-native/src/diagnostics.rs`
- Modify: `shell-native/src/config.rs`
- Modify: `shell-native/src/lib.rs`
- Test: `shell-native/src/diagnostics.rs`
- Test: `shell-native/src/config.rs`

**Interfaces:**
- Produces `LogSettings { retention_days: u16, max_total_mb: u16 }`；`ShellConfig` 使用顶层 `log_retention_days` 与 `log_max_total_mb` 字段保存它，默认 `{ 30, 500 }`。
- Produces `LogOwner::{Aidea, Builtin(String), Official(String)}` 和 `LogChannel::{Runtime, Install, Platform}`。
- Produces `append(owner, channel, source, message) -> AppResult<()>`、`read_recent(owner, channel, limit) -> AppResult<String>`、`cleanup(settings) -> AppResult<()>`。

- [ ] **Step 1: 写入默认设置和目录安全的失败测试**

在 `config.rs` 现有测试模块中增加以下断言：

```rust
let config: ShellConfig = serde_json::from_str(r#"{"app_settings":{}}"#).unwrap();
assert_eq!(config.log_retention_days, 30);
assert_eq!(config.log_max_total_mb, 500);
assert!(LogSettings { retention_days: 0, max_total_mb: 500 }.validate().is_err());
assert!(LogSettings { retention_days: 30, max_total_mb: 0 }.validate().is_err());
```

在新模块的测试中使用临时 `AIDEA_DATA_DIR`，验证 `Official("demo")` 只能生成 `logs/official/demo/{runtime,install,platform}`，`Builtin("../escape")` 被拒绝，`Aidea` 只生成 `logs/aidea/system`。

- [ ] **Step 2: 运行聚焦测试，确认新契约尚不存在**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test config::tests
```

Expected: FAIL，因为 `ShellConfig` 没有 `log_settings`，且不存在 `diagnostics` 模块。

- [ ] **Step 3: 实现最小持久化模型和目录映射**

在 `config.rs` 增加：

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LogSettings {
    #[serde(default = "default_log_retention_days")]
    pub retention_days: u16,
    #[serde(default = "default_log_max_total_mb")]
    pub max_total_mb: u16,
}
```

并为 `ShellConfig` 增加 `#[serde(default = "default_log_retention_days")] pub log_retention_days: u16` 和 `#[serde(default = "default_log_max_total_mb")] pub log_max_total_mb: u16`。`ShellConfig::log_settings()` 只在 IPC 与清理边界组装 `LogSettings`；保存时把已校验的值回写两个顶层字段。校验仅接受 `1..=365` 天和 `1..=10_240` MB，防止 0、负语义和不合理磁盘上限。

新建 `diagnostics.rs`，只使用标准库、Chrono 和现有 `config::data_root()`：

```rust
pub const DEFAULT_LOG_LINES: usize = 200;
const LOG_SEGMENT_BYTES: u64 = 10 * 1024 * 1024;

pub enum LogOwner { Aidea, Builtin(String), Official(String) }
pub enum LogChannel { Runtime, Install, Platform }

pub fn append(owner: &LogOwner, channel: LogChannel, source: &str, message: &str) -> AppResult<()>;
pub fn read_recent(owner: &LogOwner, channel: LogChannel, lines: usize) -> AppResult<String>;
pub fn cleanup(settings: &LogSettings) -> AppResult<()>;
```

`append` 必须验证 app ID、使用本地 `YYYY-MM-DD HH:mm:ss`、按日和 `10 MiB` 滚动，并把时区写到每个新文件第一行元数据。文件名采用 `YYYY-MM-DD-0001.log`。`read_recent` 按文件名从新到旧读出最多 200 行；官方应用运行/安装通道在新目录没有文件时才回退旧 `app.log`/`install.log`。`cleanup` 只删非当前文件：先按修改时间删过期文件，再按最旧修改时间删到总量上限；对当前日期的文件先滚动才允许删旧片段。

在 `lib.rs` 增加 `mod diagnostics;`，不要将任何日志状态放进 Tauri `State`。

- [ ] **Step 4: 写入滚动、旧日志和清理的失败测试**

在 `diagnostics.rs` 测试模块增加：

```rust
append(&LogOwner::Official("demo".into()), LogChannel::Runtime, "stderr", "boom").unwrap();
assert!(read_recent(&LogOwner::Official("demo".into()), LogChannel::Runtime, 200)
    .unwrap()
    .contains("stderr  boom"));
```

再构造两个已过期片段、一个当天片段和总量超限的旧片段，断言过期和最旧片段被删除、当天片段仍存在。创建旧 `logs/demo/app.log`，断言没有新运行日志时 `read_recent(Official("demo"), Runtime, 200)` 返回该旧文本。

- [ ] **Step 5: 运行 Rust 单元测试，确认基础日志层通过**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test diagnostics && cargo test config::tests
```

Expected: PASS；旧配置默认值、目录隔离、时间格式、滚动、保留天数、容量清理和旧文件回退均被验证。

### Task 2: 官方应用运行、安装与 staging 证据采集

**Files:**
- Modify: `shell-native/src/process.rs`
- Modify: `shell-native/src/official_app_installer.rs`
- Test: `shell-native/src/process.rs`
- Test: `shell-native/src/official_app_installer.rs`

**Interfaces:**
- Consumes `diagnostics::append`、`LogOwner::Official` 与 `LogChannel`。
- Produces官方应用 `runtime`、`install`、`platform` 三种可读日志，不再直接创建旧的平面 `app.log`/`install.log`。

- [ ] **Step 1: 为 stdout/stderr、异常退出和 staging 失败写失败测试**

在 `process.rs` 新增的临时可执行脚本测试中，让子进程依次输出：

```text
normal output
fatal output
```

其中标准错误使用 `eprintln!` 或 shell 的 `>&2`，随后以非零状态退出。断言 `official/demo/runtime/` 的最近日志同时含有 `stdout  normal output`、`stderr  fatal output`；`platform/` 包含退出状态。

让 `check_official_source` 启动一个向 stderr 输出 `health failed` 且不监听端口的脚本，断言其返回错误后 `official/demo/install/` 仍包含 `stderr  health failed` 和“staging 版本未就绪”。

- [ ] **Step 2: 运行进程测试，确认当前实现会丢弃 staging 输出**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test process::tests -- --nocapture
```

Expected: FAIL；当前 `Stdio::null()` 丢弃 staging 输出，正式启动的子进程输出没有统一目录和退出状态记录。

- [ ] **Step 3: 将官方应用子进程输出改为管道采集**

在 `start_official_after_transition` 和 `check_official_source` 中将：

```rust
.stdout(Stdio::from(log_file.try_clone()?))
.stderr(Stdio::from(log_file))
```

及 staging 的 `Stdio::null()` 改为：

```rust
.stdout(Stdio::piped())
.stderr(Stdio::piped())
```

启动后立即从 `child.stdout.take()`、`child.stderr.take()` 创建两个 `tokio::io::BufReader::lines()` 任务；每个非空行调用 `diagnostics::append(&owner, channel, "stdout" | "stderr", &line)`。写日志失败只 `eprintln!`，不能阻塞或终止应用进程。

`child.wait()` 必须保留 `ExitStatus`：正常停止由 `kill_rx` 路径不记录异常，自然退出写 `platform`，内容包含 `status.code()` 或 Unix 信号。启动前、PID 创建后、健康检查成功、端口占用、超时、停止和重启路径均先写 `platform`，再继续原有返回值和 `AppIssue` 行为。

`check_official_source` 接收安装日志 owner，写入 staging 启动、健康检查结果和输出；无论失败与否仍清理临时 `data` 与解压目录，但绝不清理 `official/<id>/install/`。

- [ ] **Step 4: 用统一安装通道替换 `File::create(install.log)`**

在 `official_app_installer.rs` 删除 `install_log_path`、`read_log_tail` 和 `File::create` 的安装日志专用路径。将以下阶段改为调用：

```rust
diagnostics::append(
    &LogOwner::Official(def.id.clone()),
    LogChannel::Install,
    "aidea",
    "开始下载预编译包",
)?;
```

阶段包括下载开始/失败、SHA-256 校验、解压、arm64 校验、staging 健康检查、替换 source、回滚和完成。`read_install_log` 改为 `diagnostics::read_recent(&LogOwner::Official(id.into()), LogChannel::Install, DEFAULT_LOG_LINES)`，仍先验证安装记录存在。

- [ ] **Step 5: 运行官方应用相关测试**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test process && cargo test official_app_installer
```

Expected: PASS；stdout/stderr、非零退出、staging 失败和旧安装日志兼容均可读取，安装/更新既有回滚测试不回归。

### Task 3: 壳与内置应用错误记录

**Files:**
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-frontend/src/App.tsx`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Test: `shell-native/src/commands/shell.rs`
- Test: `shell-frontend/tests/App.test.tsx`

**Interfaces:**
- Produces `record_builtin_diagnostic(id: String, source: String, message: String) -> AppResult<()>`。
- Produces `aidea/system` 事件和 `builtin/<id>/platform` 事件；未知来源的浏览器异常写入 `aidea/system`。

- [ ] **Step 1: 写失败测试，覆盖壳事件和内置前端错误**

在 `shell.rs` 测试中设置临时 `AIDEA_DATA_DIR`，调用：

```rust
record_builtin_diagnostic("dev-tools".into(), "frontend".into(), "Unhandled promise rejection".into()).await.unwrap();
```

断言 `builtin/dev-tools/platform/` 最新日志含有这条消息，`record_builtin_diagnostic("../escape", ...)` 返回配置错误。

在 `App.test.tsx` mock `ipc.recordBuiltinDiagnostic`；渲染应用后派发：

```ts
window.dispatchEvent(new ErrorEvent('error', { message: 'render failed' }));
window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: 'async failed' }));
```

断言错误上报调用出现，且错误处理本身不改变页面正常渲染。

- [ ] **Step 2: 运行聚焦测试，确认错误上报命令不存在**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test commands::shell::tests
cd /Users/fourli/Desktop/app/aIdea/shell-frontend && npm test -- --run tests/App.test.tsx
```

Expected: FAIL；尚无 `record_builtin_diagnostic` IPC 与浏览器全局错误监听。

- [ ] **Step 3: 实现壳、内置应用与更新错误记录**

在 `lib.rs` setup 中写入壳启动事件，并在退出请求处理前写入壳关闭事件。`check_aidea_update` 和 `install_aidea_update` 在失败分支调用 `diagnostics::append(&LogOwner::Aidea, LogChannel::Platform, "updater", ...)` 后返回原有 `AppError`。

在 `shell.rs` 新增 Tauri 命令：

```rust
#[tauri::command]
pub async fn record_builtin_diagnostic(id: String, source: String, message: String) -> AppResult<()> {
    diagnostics::append(&LogOwner::Builtin(id), LogChannel::Platform, &source, &message)
}
```

限制 `source` 为 `frontend` 或 `ipc`，拒绝空白消息；注册命令。`App.tsx` 使用一个 `useEffect` 注册 `error` 与 `unhandledrejection`，根据当前选中的内置应用 ID 记录到该应用；没有当前内置应用时记录 `aidea/system`。上报使用 `void`，不能让诊断失败形成新的未处理拒绝。

- [ ] **Step 4: 运行壳与前端错误记录测试**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test commands::shell::tests
cd /Users/fourli/Desktop/app/aIdea/shell-frontend && npm test -- --run tests/App.test.tsx
```

Expected: PASS；壳更新失败、内置前端异常和 Promise 拒绝均留有日志，正常界面不受影响。

### Task 4: 日志 IPC 与前端类型

**Files:**
- Create: `shell-frontend/src/types/diagnostics.ts`
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Modify: `shell-frontend/src/types/manifest.ts`
- Test: `shell-native/src/commands/shell.rs`

**Interfaces:**
- Produces `DiagnosticScope = 'aidea' | 'builtin' | 'official'`、`DiagnosticChannel = 'runtime' | 'install' | 'platform'`。
- Produces `getLogSettings`、`saveLogSettings`、`readDiagnosticLog` 三个 IPC 方法。

- [ ] **Step 1: 写读取、保存和非法作用域的失败测试**

在 Rust 命令测试中验证：读取 `aidea/system` 不接收 app ID；读取 `official/demo/install` 返回最近 200 行；`builtin` 请求 `install` 返回配置错误；保存 `{ retention_days: 7, max_total_mb: 100 }` 后重新读取完全一致。

在前端类型测试或组件 mock 中使用：

```ts
const settings: LogSettings = { retention_days: 30, max_total_mb: 500 };
await ipc.readDiagnosticLog({ scope: 'official', app_id: 'worktrace', channel: 'runtime' });
```

- [ ] **Step 2: 运行 Rust 命令测试，确认接口不存在**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test commands::shell::tests
```

Expected: FAIL；读取和保存统一日志策略的命令尚未注册。

- [ ] **Step 3: 实现严格的请求验证与 IPC 封装**

在 `shell.rs` 定义 serde 请求：

```rust
pub struct DiagnosticLogRequest {
    pub scope: String,
    pub app_id: Option<String>,
    pub channel: String,
}
```

只接受：`aidea/system`、`builtin/{id}/runtime|platform`、`official/{id}/runtime|install|platform`。命令在读取前调用 `diagnostics::cleanup(&load_config()?.log_settings())`，但清理失败只记录壳事件，读取仍继续。`save_log_settings` 先校验，再更新 `ShellConfig` 的两个顶层日志字段并 `save_config`，保存成功后同步执行一次 `cleanup`。

新增 `shell-frontend/src/types/diagnostics.ts`：

```ts
export interface LogSettings { retention_days: number; max_total_mb: number; }
export interface DiagnosticLogRequest { scope: 'aidea' | 'builtin' | 'official'; app_id?: string; channel: 'runtime' | 'install' | 'platform'; }
```

在 `ipc.ts` 添加强类型调用，不直接在组件内调用 `invoke`。删除旧 `readAppLog`；保留 `readOfficialAppInstallLog` 仅作为兼容别名并在所有调用迁移后删除。

- [ ] **Step 4: 运行类型与命令验证**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test commands::shell::tests
cd /Users/fourli/Desktop/app/aIdea/shell-frontend && npm run lint && npm test -- --run tests/components/LogPanel.test.tsx
```

Expected: PASS；非法组合被 Rust 拒绝，前端没有 `any` 或直接 `invoke`，旧日志面板测试已改为新的请求契约或被 Task 5 删除替换。

### Task 5: 日志工作台与高级设置

**Files:**
- Create: `shell-frontend/src/components/LogWorkspace.tsx`
- Delete: `shell-frontend/src/components/LogPanel.tsx`
- Modify: `shell-frontend/src/App.tsx`
- Modify: `shell-frontend/src/components/AppManagementPage.tsx`
- Modify: `shell-frontend/src/components/AppContextMenu.tsx`
- Modify: `shell-frontend/src/components/SettingsPanel.tsx`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Test: `shell-frontend/tests/components/LogWorkspace.test.tsx`
- Test: `shell-frontend/tests/components/AppManagementPage.test.tsx`
- Test: `shell-frontend/tests/components/SettingsPanel.test.tsx`

**Interfaces:**
- Consumes `ipc.readDiagnosticLog(request)`、`ipc.getLogSettings()`、`ipc.saveLogSettings(settings)`。
- Produces `LogWorkspaceTarget { scope: 'aidea' | 'builtin' | 'official'; id?: string; name: string; version?: string; address?: string; status?: AppState }`。

- [ ] **Step 1: 写日志工作台的失败测试**

新增 `LogWorkspace.test.tsx`，覆盖：

```ts
render(<LogWorkspace target={{ scope: 'official', id: 'worktrace', name: '项目追踪' }} onClose={vi.fn()} />);
expect(await screen.findByRole('tab', { name: '应用运行' })).toBeInTheDocument();
expect(screen.getByRole('tab', { name: '安装与更新' })).toBeInTheDocument();
expect(screen.getByRole('tab', { name: 'aIdea 事件' })).toBeInTheDocument();
```

再覆盖内置应用没有“安装与更新”、aIdea 只有系统日志、切换 Tab 使用正确 `DiagnosticLogRequest`、暂停时不再建立 interval、点击“复制当前内容”调用 `navigator.clipboard.writeText`。断言时间文本按 `2026-08-15 11:28:47` 原样渲染，不重新格式化或追加时区。

在 `SettingsPanel.test.tsx` 增加：进入“高级”后可加载 30 天/500 MB，保存 7 天/100 MB 时调用 `ipc.saveLogSettings`，点击“查看 aIdea 日志”打开工作台。

- [ ] **Step 2: 运行前端测试，确认当前底部日志面板不符合已确认 UI**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-frontend && npm test -- --run tests/components/LogWorkspace.test.tsx tests/components/SettingsPanel.test.tsx tests/components/AppManagementPage.test.tsx
```

Expected: FAIL；当前只有无 Tab 的 `LogPanel`，高级页日志设置不存在。

- [ ] **Step 3: 实现独立日志工作台**

使用现有 shadcn `Dialog`、`Tabs`、`Button` 和 `Tooltip`，创建 `LogWorkspace`。Dialog 使用接近主窗口的稳定宽高约束，不嵌套卡片：顶部为应用图标、名称、版本、地址、运行状态；右侧为带 tooltip 的暂停 icon button 与“复制当前内容”命令按钮。下方横向 Tab：

```ts
const channels = target.scope === 'official'
  ? ['runtime', 'install', 'platform'] as const
  : target.scope === 'builtin'
    ? ['runtime', 'platform'] as const
    : ['platform'] as const;
```

标签映射为“应用运行”“安装与更新”“aIdea 事件”；aIdea 的唯一标签为“aIdea 系统”。日志工具栏显示“最近 200 行”和自动刷新状态。日志正文仅用等宽 `pre`、自动换行和滚动；`stderr` 行使用 destructive 文本、警告行使用 warning 样式、普通行保持主题前景色。每两秒请求当前 Tab，暂停时清除 interval；请求失败只在正文显示错误，不关闭工作台。

复制使用 `navigator.clipboard.writeText(content)` 并通过 `toast` 显示成功或失败。不得添加搜索、筛选、下载、导出、手写基础组件或额外 UI 库。

- [ ] **Step 4: 接入应用管理、上下文菜单与高级设置**

在 `App.tsx` 以 `LogWorkspaceTarget | null` 保存打开目标，替代旧 `LogPanel` state。`AppManagementPage` 和 `AppContextMenu` 继续通过现有 `onShowLog(app)` 入口打开对应 target，按 `app` 是否为官方应用决定 scope。高级页日志区加载并保存全局 `LogSettings`，仅使用 `Select` 提供固定有效值：保留天数 `7/14/30/90/180`，容量 `100/250/500/1024/2048` MB；不提供自由文本输入或单应用控件。高级页“查看 aIdea 日志”通过新回调打开 `scope: 'aidea'` target。

删除 `LogPanel.tsx` 和其测试，移除无用的 `readAppLog` mock/import。保留应用管理现有安装失败 toast，但日志入口现在可以显示安装和平台错误。

- [ ] **Step 5: 运行工作台与设置测试**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-frontend && npm test -- --run tests/components/LogWorkspace.test.tsx tests/components/SettingsPanel.test.tsx tests/components/AppManagementPage.test.tsx tests/components/AppContextMenu.test.tsx tests/App.test.tsx
```

Expected: PASS；三类 target 的 Tab、暂停、复制、设置保存和所有日志入口均符合 mockup 方案 A。

### Task 6: 契约、版本与完整验证

**Files:**
- Modify: `docs/guide/aidea-platform.md`
- Modify: `docs/guide/aidea-official-app.md`
- Modify: `docs/guide/aidea-storage.md`
- Modify: `shell-native/Cargo.toml`
- Modify: `shell-native/tauri.conf.json`
- Modify: `shell-frontend/package.json`
- Modify: `shell-frontend/package-lock.json`
- Modify: `shell-frontend/src/data/changelog.json`
- Test: 全部现有 Rust 与前端测试

**Interfaces:**
- Produces当前的日志目录、保留、官方应用输出和可查看日志的唯一权威契约。

- [ ] **Step 1: 更新三份权威文档**

在平台规范明确 aIdea、内置应用与官方应用日志分层、失败必须留下可查看证据、应用管理日志工作台和高级全局保留策略。在官方应用规范明确 stdout/stderr 会被壳记录、`AIDEA_APP_LOG_DIR` 不得写敏感值、staging 输出在安装日志可见。在存储规范替换旧平面 `logs/<app-id>/` 树，写入三层目录、30 天/500 MB 默认值、滚动和“只清理 logs/”边界。

- [ ] **Step 2: 递增版本和更新记录**

按仓库现有版本约定将 `0.2.2` 递增一个 patch 版本，并保持 `Cargo.toml`、`tauri.conf.json`、`shell-frontend/package.json`、`package-lock.json` 和 `changelog.json` 一致。更新记录只写本次日志诊断工作台功能，不包含未实现的导出、搜索或分级。

- [ ] **Step 3: 运行前端完整验证**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-frontend && npm run lint && npm test && npm run build
```

Expected: 全部命令退出码为 0；TypeScript strict、未用变量和生产构建均通过。

- [ ] **Step 4: 运行 Rust 完整验证**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test
```

Expected: 全部 Rust 测试通过。该命令会监听本机回环端口，执行时必须按仓库规则申请提升权限。

- [ ] **Step 5: 执行文档和改动范围检查**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea && git diff --check
```

Expected: 无输出且退出码为 0。随后检查 `git status --short`、`git diff --stat` 和日志相关文件 diff，确认没有覆盖用户已有改动，也没有暂存、提交、推送或创建 PR。
