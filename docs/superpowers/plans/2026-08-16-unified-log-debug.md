# 统一调试日志 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有日志弹窗改造成统一的全屏「调试」页面，并让 aIdea、内置应用和官方应用遵守统一的级别、格式、采集、清理与脱敏契约。

**Architecture:** 使用混合模式：Rust 壳负责平台、市场和官方应用生命周期日志；内置应用和官方应用负责业务日志；统一 diagnostics 模块负责级别过滤、滚动、清理、读取和 WARN+ 统计。前端通过单一全屏页面按来源查看，不做跨应用聚合。

**Tech Stack:** Rust、Tauri IPC、React 18、TypeScript、Tailwind CSS、shadcn/ui、Vitest、Rust unit/integration tests。

**Spec:** `docs/superpowers/specs/2026-08-15-unified-log-diagnostics-design.md`

## Global Constraints

- 日志始终开启，级别全局统一，默认 `standard`（标准）。
- UI 级别名称固定为「精简 / 标准 / 调试」，内部级别为 `minimal / standard / debug`。
- 统一事件级别为 `DEBUG / INFO / WARN / ERROR`；关键错误三档都必须保留。
- 日志文本时间格式为 `YYYY-mm-dd HH:ii:ss`，实际输出示例为 `2026-08-16 02:47:56`。
- 左侧来源计数只统计当前保留日志中的 `WARN+`，不做未读状态和跨应用聚合。
- 「调试」页面是全屏二级页面，不使用 Dialog 或 Sheet；复制只复制当前来源和频道文本。
- 「清理日志」只删除 `logs/`，不删除应用数据、安装包、市场缓存、运行状态或备份。
- 不记录凭据、Token、Cookie、密码、邮件/通知正文、数据库内容或敏感 URL 查询参数。
- 不自动 `git add`、commit、push 或创建 PR；每个任务完成后只运行验证命令并报告结果。

---

### Task 1: 日志核心、级别配置与统计接口

**Files:**
- Modify: `shell-native/src/config.rs`
- Modify: `shell-native/src/diagnostics.rs`
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-frontend/src/types/diagnostics.ts`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Test: Rust tests in `shell-native/src/config.rs` and `shell-native/src/diagnostics.rs`
- Test: `shell-frontend/tests/components/LogWorkspace.test.tsx` (迁移前先保留现有读取契约测试)

**Interfaces:**
- `LogLevel`: Rust/TypeScript 的 `DEBUG | INFO | WARN | ERROR` 事件级别。
- `LogVerbosity`: 配置值 `minimal | standard | debug`，默认 `standard`。
- `LogSettings`: `{ level: LogVerbosity, retention_days: number, max_total_mb: number }`。
- `append(owner, channel, level, source, message) -> AppResult<()>`：统一写入入口，按全局策略过滤低级别事件。
- `read_recent(owner, channel, lines) -> AppResult<String>`：保留现有读取行为，兼容无级别旧行。
- `list_diagnostic_summaries() -> AppResult<Vec<DiagnosticSummary>>`：返回 `{ scope, app_id?, warn_count }`，计数只统计 WARN/ERROR。
- `clear_diagnostic_logs() -> AppResult<()>`：递归清空 `logs/`，保留根目录创建能力。

- [ ] **Step 1: 为级别、默认值、过滤和计数写失败测试**

在 Rust 测试中覆盖：缺少 `log_level` 使用 `standard`；三档阈值分别为 WARN、INFO、DEBUG；无级别旧行按 INFO；WARN+ 计数不包含 INFO/DEBUG；清理接口只触及临时数据根下的 `logs/`。

- [ ] **Step 2: 运行 Rust 定向测试确认失败**

Run: `cd shell-native && cargo test config::tests::日志策略缺省值与校验 -- --nocapture && cargo test diagnostics::tests -- --nocapture`

Expected: 新增的级别、统计和清理断言失败，现有旧签名调用可能出现编译错误。

- [ ] **Step 3: 扩展 `LogSettings` 和配置序列化**

在 `config.rs` 增加 `LogVerbosity`、默认值和校验；保存/读取 `log_level`，保持旧配置反序列化兼容。将 `ShellConfig::log_settings()` 返回新结构。

- [ ] **Step 4: 改造 diagnostics 写入和读取**

在 `diagnostics.rs` 增加级别前缀解析、统一文本行格式和按配置阈值过滤；所有新行写成 `timestamp level source message`，旧行读取时视为 INFO。增加递归 WARN+ 统计与手动清理，自动清理继续保护当前文件。

- [ ] **Step 5: 暴露 Tauri 命令和前端类型**

在 `commands/shell.rs` 增加 `list_diagnostic_summaries`、`clear_diagnostic_logs`，更新 `get_log_settings/save_log_settings` 和所有 `append` 调用；在 `lib.rs` 注册命令。同步 `diagnostics.ts` 类型和 `ipc.ts` 封装。

- [ ] **Step 6: 运行定向测试确认通过**

Run: `cd shell-native && cargo test config::tests -- --nocapture && cargo test diagnostics::tests -- --nocapture`

Expected: 级别默认值、过滤、兼容读取、WARN+ 统计和清理测试全部通过。

---

### Task 2: 生命周期、市场和子进程日志采集

**Files:**
- Modify: `shell-native/src/process.rs`
- Modify: `shell-native/src/official_market.rs`
- Modify: `shell-native/src/official_app_installer.rs`
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-native/src/lib.rs`
- Test: process and market Rust tests in existing module test blocks

**Interfaces:**
- 官方应用子进程环境新增 `AIDEA_LOG_LEVEL=warn|info|debug`。
- `process.rs` 的端口、spawn、健康检查和退出路径在返回错误前调用对应应用 `platform` 日志。
- `refresh_official_apps` 在市场刷新失败时写入 aIdea `platform` 日志后再返回 IPC 错误。

- [ ] **Step 1: 为端口占用、市场 403 和环境变量写失败测试**

扩展现有 `process.rs` 端口测试，断言端口错误被写入对应 `official/<id>/platform`；为市场刷新错误增加测试替身，断言 403 的状态码、主机/路径和耗时被记录且不含响应正文；断言 staging 和正式启动都传递 `AIDEA_LOG_LEVEL`。

- [ ] **Step 2: 运行定向测试确认失败**

Run: `cd shell-native && cargo test process::tests::已占用的健康检查端口会在启动前报错 -- --nocapture && cargo test official_market::tests -- --nocapture`

Expected: 新增日志和环境变量断言失败。

- [ ] **Step 3: 补齐进程生命周期记录**

在 `start_official_after_transition`、`check_official_source`、停止/重启和退出监控路径中记录启动前端口错误、spawn 错误、健康检查超时、终止结果和异常退出；所有可选日志传入正确级别，错误使用 ERROR。

- [ ] **Step 4: 补齐市场和安装错误记录**

在市场请求/解析/缓存替换边界记录状态码、耗时、错误类型和脱敏后的 URL；在安装下载、校验、解压、staging 和回滚失败路径记录对应应用安装日志。不要写响应正文、令牌或查询参数。

- [ ] **Step 5: 注入官方应用日志级别**

在正式启动和 staging 健康检查的 `Command` 构造处设置 `AIDEA_LOG_LEVEL`，并让 stdout/stderr 采集器解析应用自带级别；无级别行按 INFO。

- [ ] **Step 6: 运行定向测试确认通过**

Run: `cd shell-native && cargo test process::tests -- --nocapture && cargo test official_market::tests -- --nocapture && cargo test official_app_installer::tests -- --nocapture`

Expected: 端口、403、启动/健康检查、安装/staging、退出和环境变量测试通过。

---

### Task 3: 全屏调试页面与导航入口

**Files:**
- Create: `shell-frontend/src/components/DebugPage.tsx`
- Create: `shell-frontend/tests/components/DebugPage.test.tsx`
- Delete: `shell-frontend/src/components/LogWorkspace.tsx`
- Delete: `shell-frontend/tests/components/LogWorkspace.test.tsx`
- Modify: `shell-frontend/src/App.tsx`
- Modify: `shell-frontend/src/components/AccountMenu.tsx`
- Modify: `shell-frontend/src/components/AppManagementPage.tsx`
- Modify: `shell-frontend/src/components/TopBar.tsx` only when callback wiring requires it

**Interfaces:**
- `DebugPageProps`: `{ initialScope?: DiagnosticScope; initialAppId?: string; onBack: () => void }`。
- 页面使用 `ipc.listApps/listDiagnosticSummaries/readDiagnosticLog`，不直接调用 Tauri。
- `AccountMenu` 新增 `onOpenDebug`；入口文案固定为「调试」，图标为 `Bug`。

- [ ] **Step 1: 写失败的页面和入口测试**

测试页面默认选中 aIdea；官方应用有三个频道、内置应用有两个、aIdea 只有平台事件；左侧 WARN+ 计数显示；关键词和级别筛选作用于已读日志；暂停停止定时刷新；复制只复制当前来源/频道。测试账户菜单有「调试」和 `Bug` 图标可访问名称，应用管理入口传递预选应用。

- [ ] **Step 2: 运行前端定向测试确认失败**

Run: `cd shell-frontend && npm test -- --run tests/components/DebugPage.test.tsx tests/components/AccountMenu.test.tsx`

Expected: 新页面和新入口尚不存在，测试失败。

- [ ] **Step 3: 实现 `DebugPage`**

实现左侧分组来源菜单、WARN+ 计数、右侧频道 Tab、结构化日志行、时间格式、级别/关键词筛选、暂停/继续刷新、复制当前日志和返回按钮。保持 shadcn/ui 原语和浅色/深色主题，不做聚合时间线或未读状态。

- [ ] **Step 4: 接入 App 和入口**

在 `App.tsx` 中用页面状态替代 `LogWorkspace` 弹窗；账户菜单「调试」默认打开 aIdea；应用管理的「调试」预选当前应用；进入调试页时保存返回前的主应用，返回后恢复。

- [ ] **Step 5: 删除旧弹窗并运行前端测试**

删除 `LogWorkspace` 及旧测试，更新受影响的 `App.test.tsx` 和应用管理测试。

Run: `cd shell-frontend && npm test -- --run tests/components/DebugPage.test.tsx tests/App.test.tsx`

Expected: 页面来源、频道、筛选、刷新、复制、返回和入口测试通过。

---

### Task 4: 高级设置、清理日志和设置测试

**Files:**
- Modify: `shell-frontend/src/components/SettingsPanel.tsx`
- Modify: `shell-frontend/src/lib/ipc.ts` if Task 1 did not already add the command
- Test: `shell-frontend/tests/components/SettingsPanel.test.tsx`

**Interfaces:**
- 高级设置读取/保存 `{ level, retention_days, max_total_mb }`。
- `ipc.clearDiagnosticLogs()` 删除全部日志。

- [ ] **Step 1: 写失败的设置测试**

断言高级页显示「精简 / 标准 / 调试」、默认标准、保存级别/天数/容量；不再显示「开发者选项」或「查看 aIdea 日志」；「清理日志」打开确认对话框，确认后调用 `clearDiagnosticLogs`，取消不调用。

- [ ] **Step 2: 运行设置测试确认失败**

Run: `cd shell-frontend && npm test -- --run tests/components/SettingsPanel.test.tsx`

Expected: 旧的静态开发者选项和禁用清除按钮导致断言失败。

- [ ] **Step 3: 更新高级设置 UI**

在日志区增加级别选择，移除静态开发者选项和 aIdea 日志按钮；将“清除缓存”改为“清理日志”，使用现有 shadcn Dialog 做确认，明确只删除已保存调试日志。

- [ ] **Step 4: 接入清理和反馈**

确认后调用 IPC，成功 toast，失败 toast 并保留设置页面；保存日志设置后触发自动清理。清理期间禁用重复操作，避免重复请求。

- [ ] **Step 5: 运行设置和 lint**

Run: `cd shell-frontend && npm test -- --run tests/components/SettingsPanel.test.tsx && npm run lint`

Expected: 设置行为测试通过，ESLint 无错误。

---

### Task 5: 开发手册、官方应用契约、版本和闭环验证

**Files:**
- Modify: `docs/guide/aidea-platform.md`
- Modify: `docs/guide/aidea-official-app.md`
- Modify: `docs/guide/aidea-storage.md`
- Modify: `shell-frontend/src/data/changelog.json`
- Modify: `shell-frontend/package.json`
- Modify: `shell-frontend/package-lock.json`
- Modify: `shell-native/Cargo.toml`
- Modify: `shell-native/tauri.conf.json`
- Modify: `/Users/fourli/atlas/user-agents/skills/aidea-app/SKILL.md` only to add a pointer to the project log contract and `AIDEA_LOG_LEVEL`

**Interfaces:**
- 开发手册是长期契约唯一来源；官方应用 Skill 只提供入口和必要环境变量指引，不复制整篇规范。
- 版本递增到下一个符合仓库规则的版本，并同步 Cargo、package、lock、Tauri 配置和变更日志。

- [ ] **Step 1: 更新三份项目规范**

把统一调试入口、来源/频道、三档级别、文本格式、`AIDEA_LOG_LEVEL`、日志目录、WARN+ 计数和清理边界分别写入平台、官方应用和存储规范，移除与新设计冲突的“弹窗/高级查看 aIdea 日志”描述。

- [ ] **Step 2: 更新官方应用 Skill 指针**

在 Skill 的固定边界中补充“官方应用必须遵守 aIdea 官方应用规范中的统一日志契约”，并列出 `AIDEA_LOG_LEVEL`；不复制格式和矩阵全文。

- [ ] **Step 3: 同步版本和 changelog**

按现有发布规则递增 aIdea 版本，保持 `package.json`、`package-lock.json`、`Cargo.toml`、`tauri.conf.json` 和变更日志一致；用户可见的调试入口、设置和日志格式变化必须升版本。

- [ ] **Step 4: 运行文档检查**

Run: `git diff --check`；检查新增文档链接均指向现有文件，且 `rg` 不再找到旧的弹窗日志入口、开发者调试开关或“查看 aIdea 日志”契约。

- [ ] **Step 5: 运行前端闭环**

Run: `cd shell-frontend && npm run lint && npm test && npm run build`

Expected: ESLint、全部 Vitest 和生产构建通过；若出现既有 bundle 体积警告，只记录警告，不在本任务扩展范围内处理。

- [ ] **Step 6: 运行 Rust 闭环**

Run: `cd shell-native && cargo test`

Expected: Rust 单元和集成测试全部通过；按仓库要求为本机回环端口监听申请提升权限。

- [ ] **Step 7: 手工验收日志证据**

验证端口占用、市场 403、staging 健康检查超时、官方应用异常退出、内置 IPC 失败；在「调试」页面分别切换来源和频道，复制完整错误；切换三档级别确认输出差异；清理日志后确认应用数据、安装包和市场缓存仍存在。
