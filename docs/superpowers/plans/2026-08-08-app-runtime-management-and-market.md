# aIdea 应用运行时、管理与官方市场实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 aIdea 可靠管理官方应用的运行生命周期，并将官方应用市场改为“aIdea 内置收录目录 + 应用仓库自描述”的模式。

**Architecture:** aIdea 继续随发布包携带 `plugin-markets/official/`，每一项只声明官方应用仓库地址。市场刷新时通过用户现有 Git/SSH 凭据短暂拉取该仓库的默认分支，读取并校验根目录 `aidea.yaml`，将最近一次成功定义缓存到用户数据目录；安装和更新始终 checkout 定义里的完整 commit SHA。运行时以 `runtime/processes/<app-id>.json` 记录受管进程，启动时验证并接管遗留进程，避免端口冲突和重复启动。

**Tech Stack:** Tauri 2、Rust、Tokio、serde/serde_yaml、React 18、TypeScript、Tailwind CSS、shadcn/ui、lucide-react、Vitest、GitHub Releases、Tauri Updater。

## 全局约束

- 目标平台为 macOS，不发布 App Store；aIdea 自更新源为 GitHub Releases。
- 当前只支持内置应用和官方应用；不实现第三方应用、用户自定义仓库或后台守护进程。
- 不新增独立 `aidea-market` 仓库；新增官方应用时才修改 aIdea 的 `plugin-markets/official/` 并发 aIdea 版本。
- 所有官方应用定义均来自其仓库根目录的 `aidea.yaml`；`revision` 必须是完整 Git commit SHA，版本必须是有效语义版本。
- 应用定义中的命令必须是参数数组，禁止 shell 字符串、`sh -c`、`bash -c`；健康检查只允许 `http://127.0.0.1:<port>/...`。
- 官方应用默认手动启动；用户可单独设置随 aIdea 启动。内置应用只能隐藏，不能卸载或配置进程。
- 用户设置、运行记录、缓存、日志和业务数据均位于 `~/Library/Application Support/aIdea/`；卸载默认不删除 `app-data/<app-id>/` 与 `logs/<app-id>/`。
- UI 必须遵守 `docs/app/ui.md`：shadcn/ui、lucide-react、可访问名称、明确的加载/错误/空状态；不新增第二套 UI 或图标体系。
- 本计划不主动执行 `git add`、`git commit`、push 或 PR；每个任务中的提交步骤仅供人工版本管理时参考。

---

## 文件职责图

| 文件 | 改动职责 |
| --- | --- |
| `docs/app/package-spec.md` | 官方应用仓库 `aidea.yaml` 的正式字段、校验与安装契约。 |
| `docs/app/marketplace.md` | aIdea 内置收录目录、远程刷新和缓存规则。 |
| `docs/app/platform.md` | 内置/官方应用职责、市场和运行时术语。 |
| `docs/app/data-layout.md` | 市场定义缓存和运行记录目录。 |
| `plugin-markets/official/*.yaml` | 只保留 `schema_version`、`repository`、`enabled` 的官方仓库收录项。 |
| `shell-native/src/plugin_market.rs` | 加载收录项、用 Git 刷新定义、缓存、校验和版本比较。 |
| `shell-native/src/plugin_installer.rs` | 基于已刷新定义安装、更新、卸载与已安装定义快照。 |
| `shell-native/src/process.rs` | 受管进程记录、验证接管、端口归属、启停、退出信息。 |
| `shell-native/src/config.rs` | 应用可见性和启动方式等用户偏好。 |
| `shell-native/src/commands/shell.rs` | 市场刷新、应用设置、运行详情与进程控制 IPC。 |
| `shell-native/src/lib.rs` | 初始化进程接管、自启动和新增 IPC 注册。 |
| `shell-native/tauri.conf.json`、`Cargo.toml`、前端依赖 | Tauri updater 配置、签名公钥和插件依赖。 |
| `shell-frontend/src/types/*.ts`、`lib/ipc.ts` | 与 Rust 完全对应的应用市场、运行状态、更新接口。 |
| `shell-frontend/src/components/SettingsPanel.tsx` | 应用管理、应用市场、隐私和关于页重构。 |
| `shell-frontend/src/components/AppRuntimePanel.tsx` | 官方应用的运行与日志详情面板。 |
| `shell-frontend/src/builtin-apps/plugin-market/index.tsx` | 市场刷新、版本状态、安装/更新/卸载和安装日志。 |
| `shell-frontend/src/components/{TopBar,AppContextMenu,BuiltinPage}.tsx` | 隐藏状态、市场入口与现有顶层入口清理。 |

## Task 1：固化官方市场与应用定义契约

**Files:**
- Modify: `docs/app/package-spec.md`
- Modify: `docs/app/marketplace.md`
- Modify: `docs/app/platform.md`
- Modify: `docs/app/data-layout.md`
- Modify: `plugin-markets/official/stock-assistant.yaml`
- Modify: `shell-native/src/plugin_market.rs`
- Test: `shell-native/src/plugin_market.rs`

**Consumes:** 现有 `plugin-markets/official/*.yaml` 完整应用定义和 `OfficialPlugin`。

**Produces:** `OfficialCatalogEntry`、`OfficialPluginDefinition`、`refresh_official_plugins() -> AppResult<MarketSnapshot>` 与只读 `load_cached_official_plugins() -> AppResult<MarketSnapshot>`。

- [ ] **Step 1：先写并运行失败测试，锁定目录和定义边界**

  在 `plugin_market.rs` 的测试模块中用临时目录创建收录项和缓存，覆盖：

  ```rust
  #[test]
  fn 收录项只允许仓库地址和启用状态() {
      let entry: OfficialCatalogEntry = serde_yaml::from_str(
          "schema_version: 1\nrepository: https://example.com/demo.git\nenabled: true\n",
      ).unwrap();
      assert!(validate_catalog_entry(&entry).is_ok());
  }

  #[test]
  fn 应用定义必须使用完整_sha与本地健康检查() {
      let definition = definition_with_revision("d351c25ac9a970abb1e13016dcf26128fa8e200b");
      assert!(validate_definition(&definition).is_ok());
      assert!(validate_definition(&definition_with_revision("main")).is_err());
  }
  ```

  Run: `cargo test --manifest-path shell-native/Cargo.toml plugin_market::tests`

  Expected: FAIL，因为 `OfficialCatalogEntry`、`validate_catalog_entry` 和 `validate_definition` 尚未定义。

- [ ] **Step 2：实现最小的两层定义模型与格式校验**

  将当前 `OfficialPlugin` 拆为：随包的 `OfficialCatalogEntry`（只含 `schema_version`、`repository`、`enabled`）和来自仓库根目录的 `OfficialPluginDefinition`（含 id、名称、简介、图标、版本、revision、install、process、`min_aidea_version`、更新说明）。保留现有命令、工作目录和 localhost 健康检查校验；新增：完整 40 位十六进制 SHA、非空语义版本、`min_aidea_version` 和唯一 ID 校验。

  将 `stock-assistant.yaml` 改为：

  ```yaml
  schema_version: 1
  repository: https://github.com/four-li/stock-assistant.git
  enabled: true
  ```

- [ ] **Step 3：实现 Git 刷新与定义缓存**

  新增用户级缓存目录：

  ```text
  runtime/market-cache/<catalog-file-stem>/aidea.yaml
  runtime/market-cache/<catalog-file-stem>/metadata.json
  ```

  `refresh_official_plugins` 对每个启用收录项执行临时浅 clone（`git clone --depth 1`，不修改用户全局 Git 配置），从仓库默认分支读取 `aidea.yaml`，校验后原子覆盖该项缓存。Git 请求自然复用用户已有 HTTPS 凭据、SSH 配置和公司网络；不要收集或保存 Git 密码。单项刷新失败时保留其原缓存并携带可读错误，其他项继续刷新。

  `load_cached_official_plugins` 只读取缓存，不触网；没有成功缓存的项在市场中返回“尚未刷新”的可读状态。

- [ ] **Step 4：更新契约文档**

  文档必须明确以下内容：

  ```yaml
  # 应用仓库根目录 aidea.yaml 的最小示例
  schema_version: 1
  id: stock-assistant
  name: 股票助手
  description: 本地股票自选列表
  category: 金融
  version: 0.1.0
  icon: TrendingUp
  revision: d351c25ac9a970abb1e13016dcf26128fa8e200b
  min_aidea_version: 0.1.4
  install:
    - [npm, ci]
  process:
    command: [node, node_modules/vite/bin/vite.js, --host, 127.0.0.1, --port, '43120']
    working_directory: .
    ready_url: http://127.0.0.1:43120/health
  update_notes: 首期使用本地 mock 行情。
  ```

  同时删除“完整应用定义在 aIdea 仓库、插件仓库不需要 `aidea.yaml`”的旧描述。市场文档明确：已有收录应用更新自身定义即可被刷新发现；只有新增收录应用才需要发布新版 aIdea。

- [ ] **Step 5：运行验证**

  Run: `cargo test --manifest-path shell-native/Cargo.toml plugin_market::tests`

  Expected: PASS，且覆盖非法 SHA、远程健康检查、shell 命令、重复 ID、单项刷新失败使用缓存。

  Run: `git diff --check`

  Expected: PASS。

## Task 2：安装状态与市场版本比较

**Files:**
- Modify: `shell-native/src/plugin_installer.rs`
- Modify: `shell-native/src/plugin_market.rs`
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-frontend/src/types/plugin-market.ts`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Test: `shell-native/src/plugin_installer.rs`

**Consumes:** Task 1 的 `OfficialPluginDefinition` 与 `MarketSnapshot`。

**Produces:** `MarketPlugin`（市场定义、已安装版本、更新状态、刷新错误）和 `refresh_official_plugin_market` IPC。

- [ ] **Step 1：写失败测试，定义安装快照与版本规则**

  ```rust
  #[test]
  fn 只有市场版本更高才允许更新() {
      assert_eq!(update_status("0.1.0", "0.1.0"), PluginUpdateStatus::Installed);
      assert_eq!(update_status("0.1.0", "0.1.1"), PluginUpdateStatus::UpdateAvailable);
      assert_eq!(update_status("0.1.1", "0.1.0"), PluginUpdateStatus::Installed);
  }
  ```

  Run: `cargo test --manifest-path shell-native/Cargo.toml plugin_installer::tests`

  Expected: FAIL，因为版本状态函数和新版安装快照尚未实现。

- [ ] **Step 2：让安装器使用缓存定义并保存安装快照**

  将安装器的 `plugin(id)` 改为从已校验的市场缓存读取定义。`install-state.yaml` 除 id、version、revision、status 外，保存运行所必需的定义快照（名称、图标、process、来源仓库），让市场暂时不可访问时，已安装应用仍能启动、展示和卸载。安装前验证 market version 大于已安装版本才允许更新；版本相同或更低返回稳定结果，绝不覆盖当前源码。

  保持当前安全安装顺序：clone -> checkout 完整 SHA -> 安装依赖 -> 原子替换 source；继续保留仅对 HTTP/2 framing 错误的 HTTP/1.1 单次重试。

- [ ] **Step 3：暴露市场刷新与结构化市场状态 IPC**

  新增：

  ```rust
  #[tauri::command]
  pub async fn refresh_official_plugin_market() -> AppResult<MarketSnapshot>;

  #[tauri::command]
  pub async fn list_official_plugin_market() -> AppResult<MarketSnapshot>;
  ```

  前端类型使用：

  ```ts
  type PluginMarketStatus = 'not-installed' | 'installed' | 'update-available' | 'unavailable';
  interface MarketPlugin { definition?: OfficialPluginDefinition; installed?: InstalledPlugin; status: PluginMarketStatus; error?: string; }
  interface MarketSnapshot { plugins: MarketPlugin[]; refreshedAt?: number; }
  ```

  删除旧的“目录直接返回完整 `OfficialPlugin`”IPC，不保留双重数据源。

- [ ] **Step 4：写前端 IPC 单测并运行后端测试**

  在现有 `shell-frontend/tests` 目录为 market 状态映射写 Vitest 测试，验证“同版本没有更新按钮、较高版本可更新、刷新失败但已安装仍可卸载”。

  Run: `cargo test --manifest-path shell-native/Cargo.toml plugin_installer::tests`

  Expected: PASS。

  Run: `npm test -- --run`

  Expected: PASS。

## Task 3：持久化受管进程、端口归属与异常接管

**Files:**
- Modify: `shell-native/src/process.rs`
- Modify: `shell-native/src/config.rs`
- Modify: `shell-native/src/plugin_installer.rs`
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-native/src/lib.rs`
- Test: `shell-native/src/process.rs`

**Consumes:** Task 2 的已安装应用定义快照。

**Produces:** `AppRuntimeState`、`AppRuntimeDetail`、`ProcessManager::recover_managed_processes()`、`ProcessManager::restart()` 和 `ProcessManager::stop_all()`。

- [ ] **Step 1：写失败测试，锁定运行记录读写和归属校验**

  使用临时 `AIDEA_DATA_DIR`，覆盖记录序列化、失效记录清理和状态转换：

  ```rust
  #[test]
  fn 已失效运行记录不会被接管() {
      write_runtime_record(&record_with_pid(u32::MAX));
      let states = ProcessManager::default().recover_managed_processes().unwrap();
      assert_eq!(states[0].status, AppRuntimeStatus::Stopped);
      assert!(!runtime_record_path("demo").unwrap().exists());
  }
  ```

  Run: `cargo test --manifest-path shell-native/Cargo.toml process::tests`

  Expected: FAIL，因为 `RuntimeRecord` 和恢复入口尚未实现。

- [ ] **Step 2：实现运行记录和详细状态模型**

  用以下模型替换当前只含 PID 的内存表：

  ```rust
  pub enum AppRuntimeStatus { Starting, Running, Stopped, Failed, ExternalPortInUse }
  pub enum RuntimeInstanceSource { StartedThisSession, Recovered }
  pub struct RuntimeRecord {
      pub app_id: String,
      pub pid: u32,
      pub started_at: i64,
      pub process_started_at: String,
      pub command: Vec<String>,
      pub working_directory: String,
      pub ready_url: String,
      pub log_path: String,
      pub version: String,
      pub instance_id: String,
  }
  ```

  子进程创建成功后立即原子写入 `runtime/processes/<app-id>.json`，健康检查成功后更新状态。自然退出、启动失败、用户停止和正常 aIdea 退出时删除运行记录，并将退出码/信号、时间和最后错误摘要保存在 `runtime/state/<app-id>.json`。

- [ ] **Step 3：实现启动时接管和外部端口判定**

  启动时逐项执行：`kill(pid, 0)` 检查存活 -> macOS `ps -p <pid> -o lstart= -o command=` 验证启动时间和命令 -> `lsof -a -p <pid> -d cwd -Fn` 验证工作目录 -> 本地 HTTP 健康检查。所有条件成功才把它放回进程表并标记 `Recovered`；任一失败都删除记录，不接管。

  手动启动前先检查内存受管表和运行记录；若健康检查端口被占用但无法完成上述受管身份验证，返回 `ExternalPortInUse`，包含具体端口，且不创建第二个进程。

- [ ] **Step 4：统一停止、重启和退出清理**

  `stop` 和 `stop_all` 对受管进程先发 `SIGTERM`、轮询最多 5 秒，仍存活才发 `SIGKILL`；只操作表中或经恢复验证的受管 PID。`restart(id)` 必须停止成功后再按安装快照启动。Tauri `RunEvent::ExitRequested` 调用 `stop_all`；用户终端自行运行的开发服务绝不能进入表或被停止。

- [ ] **Step 5：恢复后按用户偏好自启动**

  `lib.rs` 启动阶段先 `recover_managed_processes`，随后只启动 `startup_mode == WithAidea` 且当前没有成功接管实例的官方应用。内置应用不参与本任务的进程启动。

- [ ] **Step 6：运行验证**

  Run: `cargo test --manifest-path shell-native/Cargo.toml process::tests`

  Expected: PASS。涉及真实监听端口的测试在 macOS 真机以 `sandbox_permissions: require_escalated` 运行；受限沙箱出现 `Operation not permitted` 不作为业务失败。

  手工验收：终端先启动占用 `43120` 的服务，再从 aIdea 启动股票助手，应显示“外部进程占用 43120”；强制退出 aIdea 后重开，应显示“运行中（已接管）”；正常退出 aIdea 后端口应释放。

## Task 4：用户应用设置、应用管理与运行日志界面

**Files:**
- Modify: `shell-native/src/config.rs`
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-frontend/src/types/manifest.ts`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Modify: `shell-frontend/src/components/SettingsPanel.tsx`
- Create: `shell-frontend/src/components/AppRuntimePanel.tsx`
- Modify: `shell-frontend/src/components/LogPanel.tsx`
- Modify: `shell-frontend/src/components/TopBar.tsx`
- Modify: `shell-frontend/src/components/AppContextMenu.tsx`
- Test: `shell-native/src/config.rs`
- Test: `shell-frontend/tests/components/SettingsPanel.test.tsx`

**Consumes:** Task 3 的运行详情和已安装官方应用列表。

**Produces:** `AppUserSettings`、`list_managed_apps`、`save_app_user_settings`、`get_app_runtime_detail`、启动/停止/重启 IPC。

- [ ] **Step 1：写失败测试，锁定用户偏好默认值与隔离边界**

  ```rust
  #[test]
  fn 官方应用默认可见且手动启动() {
      let settings = AppUserSettings::default();
      assert!(settings.visible);
      assert_eq!(settings.startup_mode, StartupMode::Manual);
  }
  ```

  Run: `cargo test --manifest-path shell-native/Cargo.toml config::tests`

  Expected: FAIL，因为 `AppUserSettings`、`StartupMode` 尚未定义。

- [ ] **Step 2：将运行偏好从 manifest override 中分离**

  在 `ShellConfig` 新增 `app_settings: BTreeMap<String, AppUserSettings>`；不把 `visible`、`startup_mode` 放进 `AppOverride`。`AppUserSettings` 有 `visible: bool`（默认 true）和 `startup_mode: Manual | WithAidea`（默认 Manual）。保存时校验：内置应用只能更改 `visible`；官方应用两个字段均可更改；未知 app ID 返回错误。

- [ ] **Step 3：定义统一的应用管理 IPC**

  添加 `ManagedApp`，避免前端拼接内置 manifest、安装记录、用户设置和进程状态：

  ```rust
  pub struct ManagedApp {
      pub id: String,
      pub name: String,
      pub icon: Option<String>,
      pub version: String,
      pub kind: AppKind, // Builtin | Official
      pub user_settings: AppUserSettings,
      pub runtime: Option<AppRuntimeState>,
  }
  ```

  `list_managed_apps` 返回全部内置和已安装官方应用；`get_app_runtime_detail` 返回 PID、启动时间、实例来源、最近退出原因和日志路径。`read_app_log` 改为先处理官方应用安装快照，内置旧 process 配置保持兼容。

- [ ] **Step 4：重构设置中的应用管理**

  用紧凑列表替换当前“新增本地 manifest/编辑 manifest”表单。每项显示图标、名称、类型、版本、运行状态、启动方式、隐藏状态；列表操作使用 lucide 图标按钮及 Tooltip。

  内置应用只提供隐藏/恢复显示。官方应用提供启动、停止、重启、切换“随 aIdea 启动”、隐藏/恢复、卸载和“运行与日志”。“运行与日志”使用 `AppRuntimePanel`，显示状态、PID、启动时间、实例来源、最近退出原因，以及每 2 秒刷新一次、可暂停的日志尾部；复用并收敛现有 `LogPanel`，不要并行维护两份轮询逻辑。

  “添加应用”改为跳转设置内“应用市场”；移除手动新增本地应用、保存 manifest、编辑 start/url 的入口及相关 IPC 调用。

- [ ] **Step 5：将隐藏状态用于顶部栏和右键菜单**

  顶部应用栏只渲染 `visible == true` 的应用；隐藏不会停止进程或改变安装状态。右键菜单对官方应用保留启动/停止/日志快捷操作，但应用管理是完整管理入口；内置应用不出现进程操作。

- [ ] **Step 6：运行验证**

  Run: `cargo test --manifest-path shell-native/Cargo.toml config::tests`

  Expected: PASS。

  Run: `npm test -- --run shell-frontend/tests/components/SettingsPanel.test.tsx`

  Expected: PASS，覆盖内置应用无卸载按钮、官方应用可进入运行日志、隐藏后顶部栏不显示、添加应用跳转市场。

  Run: `npm run lint && npm run build`

  Expected: PASS。

## Task 5：应用市场页面、安装更新体验与隐私页

**Files:**
- Modify: `shell-frontend/src/builtin-apps/plugin-market/index.tsx`
- Modify: `shell-frontend/src/components/SettingsPanel.tsx`
- Modify: `shell-frontend/src/components/BuiltinPage.tsx`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Modify: `shell-frontend/src/types/plugin-market.ts`
- Test: `shell-frontend/tests/builtin-apps/plugin-market/index.test.tsx`

**Consumes:** Task 2 市场快照与 Task 4 应用管理回调。

**Produces:** 刷新式官方应用市场、版本差异展示、安装/更新/卸载反馈和最小隐私页面。

- [ ] **Step 1：写失败测试，定义市场可见状态**

  ```tsx
  it('同版本已安装时不显示更新按钮', async () => {
    render(<PluginMarketPage />);
    expect(await screen.findByText('已安装')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更新' })).not.toBeInTheDocument();
  });
  ```

  Run: `npm test -- --run shell-frontend/tests/builtin-apps/plugin-market/index.test.tsx`

  Expected: FAIL，因为页面仍假定市场定义来自本地且不区分版本状态。

- [ ] **Step 2：实现刷新优先、缓存兜底的市场页**

  初次打开市场调用 `listOfficialPluginMarket` 显示缓存；用户点刷新调用 `refreshOfficialPluginMarket`。页面显示上次检查时间，刷新期间保持原列表可操作。每项明确显示：未安装、已安装、可更新或“定义暂不可用”；刷新失败显示具体仓库错误并继续展示可用缓存。

  未安装只显示安装；同版本或更低版本显示已安装；仅市场版本更高时显示更新和 `update_notes`。已安装应用可卸载，卸载后通知应用管理和顶部栏刷新。

- [ ] **Step 3：保留并收敛安装进度与日志**

  保留已有 `official-plugin-install-progress` 事件和 HTTP/1.1 fallback 日志。安装、更新、卸载必须禁用对应项的重复点击；失败后在同一应用条目内提供“查看安装日志”，不把错误只留在 toast。进度文案至少包含：拉取源码、兼容重试、切换固定版本、安装依赖、完成或失败。

- [ ] **Step 4：调整导航与隐私说明**

  设置菜单将“官方插件”改名为“应用市场”。从顶层 `BuiltinPage` 和应用列表移除“网页邮箱”及不应常驻的市场入口，应用市场仅在设置中访问。隐私与安全页面删除静态占位条目，只保留：

  > aIdea 本地应用不收集任何用户数据。

- [ ] **Step 5：运行验证**

  Run: `npm test -- --run shell-frontend/tests/builtin-apps/plugin-market/index.test.tsx`

  Expected: PASS，覆盖刷新失败缓存、同版本、更新、安装失败日志和卸载。

  Run: `npm run lint && npm run build && git diff --check`

  Expected: PASS。

## Task 6：真实版本信息与 GitHub Releases 签名自更新

**Files:**
- Modify: `shell-native/Cargo.toml`
- Modify: `shell-native/tauri.conf.json`
- Modify: `shell-native/capabilities/default.json`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Modify: `shell-frontend/src/components/SettingsPanel.tsx`
- Modify: `.github/workflows/release.yml`（若当前仓库已有发布工作流）
- Create: `docs/release-updater.md`
- Test: `shell-native/src/commands/shell.rs`

**Consumes:** 当前 `tauri.conf.json` 的真实版本号和 GitHub Releases 发布流程。

**Produces:** `get_aidea_version`、`check_aidea_update`、`download_and_install_aidea_update` IPC，以及带签名更新清单的 Release 流程。

- [ ] **Step 1：先确认现有 Tauri 2 版本与 GitHub Release 工作流**

  Run: `rg -n 'tauri|bundle|updater|release' shell-native/Cargo.toml shell-native/tauri.conf.json .github package.json`

  Expected: 记录 Tauri 主版本、当前发布资产和是否已有 workflow；不能在未确认 Tauri 版本前添加 updater crate。

- [ ] **Step 2：写失败测试，真实版本绝不由前端写死**

  ```rust
  #[test]
  fn 返回_tauri_配置中的当前版本() {
      assert_eq!(current_aidea_version(), env!("CARGO_PKG_VERSION"));
  }
  ```

  Run: `cargo test --manifest-path shell-native/Cargo.toml commands::shell::tests::返回_tauri_配置中的当前版本`

  Expected: FAIL，因为版本仍由设置页静态字符串提供。

- [ ] **Step 3：配置 Tauri updater 与签名验证**

  按实际 Tauri 主版本加入对应 updater Rust/前端插件和 capability 权限；在 `tauri.conf.json` 配置 GitHub Releases 提供的签名更新清单 endpoint 和仅用于验证的 updater 公钥。密钥私钥不进入仓库、不进入 aIdea 数据目录；发布环境通过受保护的 CI secret 注入。

  后端只暴露三个稳定动作：读取当前版本、检查更新（版本、发布日期、说明）、下载并安装已签名更新。前端不拼接下载 URL、不自行覆盖 DMG。

- [ ] **Step 4：实现关于页和更新交互**

  关于页显示真实当前版本、上次检查时间、检查更新按钮；发现更高版本时显示版本和更新说明，用户确认后下载，下载/签名验证完成后显示“重启并更新”。网络、签名或发布清单错误以可读信息展示，并保留当前可用版本。

- [ ] **Step 5：补齐 GitHub Release 产物与文档**

  发布工作流除 DMG 外生成与当前 Tauri updater 兼容的 macOS 更新包、签名和更新清单，并将它们附到 GitHub Release。`docs/release-updater.md` 明确：生成密钥的命令、私钥存入 GitHub Actions secret 的名称、发布需校验的资产、回滚策略，以及本地开发环境不应触发自更新。

- [ ] **Step 6：运行验证与发布前人工验收**

  Run: `cargo test --manifest-path shell-native/Cargo.toml commands::shell::tests`

  Expected: PASS。

  Run: `npm test -- --run && npm run lint && npm run build && git diff --check`

  Expected: PASS。

  人工验收：安装旧版 DMG 后发布一个带签名的更高版本 Release，关于页能发现、下载、提示重启并替换应用；篡改更新包或签名时必须拒绝安装。

## 全量验收清单

- [ ] 官方应用默认手动启动；开启“随 aIdea 启动”后，重启 aIdea 会自动启动。
- [ ] 正常退出 aIdea 后，全部受管官方应用停止且端口释放。
- [ ] 异常退出 aIdea 后，下一次启动只接管 PID、启动时间、命令、工作目录和健康检查都匹配的进程。
- [ ] 外部程序占用官方应用端口时，显示“外部进程占用”，不重复启动、不误停止。
- [ ] 应用管理能区分内置和官方应用；内置只能隐藏，官方可启动/停止/重启/设置自启/查看运行日志/卸载。
- [ ] 市场刷新既可访问 GitHub，也可通过当前 Git 凭据访问受限的私有 GitLab；失败时展示最近成功缓存和明确错误。
- [ ] 已收录应用只更新仓库 `aidea.yaml` 即能被发现；新增应用才需要修改 aIdea 的官方目录并发布 aIdea。
- [ ] 安装和更新始终 checkout 完整 SHA；仅市场版本更高时出现更新。
- [ ] 隐私页只显示“aIdea 本地应用不收集任何用户数据。”
- [ ] 关于页读取真实版本；GitHub Releases 有合法签名的新版本时，可完成下载和重启更新。
