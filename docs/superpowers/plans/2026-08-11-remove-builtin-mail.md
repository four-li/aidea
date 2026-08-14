# Remove Built-in Mail Implementation Implementation Plan

> 历史记录，禁止作为当前实现或发布步骤执行。

> **历史实施记录**：本文件只记录删除旧内置邮件的实施过程，不是当前平台或官方应用契约。当前规则以仓库根目录 `AGENTS.md` 和 `docs/guide/` 为准；新邮件功能应按 `mail-center` 官方应用规范实现。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not use subagents unless the user explicitly requests them.

**Goal:** 从 aIdea 壳中彻底删除旧的 `mail-manager` 内置邮件管理实现，不保留迁移、兼容或运行时旧数据清理代码。

**Architecture:** 删除旧邮件的前端页面、Rust 业务模块、Tauri IPC、manifest、迁移和测试；只保留独立官方应用 `mail-center` 的文档边界与桥接示例。新版 aIdea 不读取、不写入、不自动删除本机历史邮件数据。

**Tech Stack:** React、TypeScript、Vite、Vitest、Tauri 2、Rust 2021、Cargo、SQLite 相关现有依赖。

## Global Constraints

- 不新增启动清理、数据迁移、双写、兼容读取或旧数据备份。
- 不操作当前机器用户目录中的历史邮件数据。
- 只删除旧内置邮件相关代码和由本次删除造成的残留，不做相邻模块重构。
- `chrono` 仍被进程和市场模块使用，必须保留。
- 可见功能变化将版本从 `0.1.9` 同步提升到 `0.1.10`。
- 不自动执行 `git add`、commit、push 或创建 PR。
- 完成后按仓库约定运行前端 lint、测试、构建和 Rust 测试。

---

## 文件结构

### 删除

- `apps/builtin/mail-manager.yaml`
- `shell-frontend/src/builtin-apps/mail-manager/`
- `shell-frontend/src/types/mail.ts`
- `shell-frontend/tests/mail-manager/`
- `shell-native/src/commands/mail.rs`
- `shell-native/src/mail_store.rs`
- `shell-native/src/mail_sync.rs`
- `shell-native/src/mail_runtime.rs`
- `shell-native/migrations/mail-manager/`
- `shell-native/tests/mail_command_test.rs`
- `shell-native/tests/mail_store_test.rs`
- `shell-native/tests/mail_sync_test.rs`

### 修改

- `shell-frontend/src/lib/ipc.ts`
- `shell-frontend/src/components/BuiltinPage.tsx`
- `shell-native/src/lib.rs`
- `shell-native/src/commands/mod.rs`
- `shell-native/src/manifest.rs`
- `shell-native/src/error.rs`
- `shell-native/Cargo.toml`
- `shell-native/Cargo.lock`
- `shell-native/tests/manifest_test.rs`
- `AGENTS.md`
- `docs/guide/aidea-builtin-app.md`
- `docs/guide/aidea-platform.md`
- `docs/guide/aidea-storage.md`
- `docs/guide/aidea-official-app.md`
- `shell-frontend/package.json`
- `shell-frontend/package-lock.json`
- `shell-native/tauri.conf.json`
- `shell-frontend/src/data/changelog.json`

## 实施任务

### Task 1: 删除前端内置邮件页面和 IPC

**Files:**
- Delete: `shell-frontend/src/builtin-apps/mail-manager/`
- Delete: `shell-frontend/src/types/mail.ts`
- Delete: `shell-frontend/tests/mail-manager/`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Modify: `shell-frontend/src/components/BuiltinPage.tsx`

**Interfaces:**
- `ipc` 保留其他壳、DevTools、AI、网络和官方应用管理方法。
- `BuiltinPage` 只保留现有非邮件内置页面分支和未知应用占位逻辑。

- [ ] **Step 1: 删除邮件前端源码、类型和测试目录**

删除 `mail-manager` 页面目录、`types/mail.ts` 以及两个邮件前端测试文件。不要修改官方应用 `mail-center` 的 App Bridge 示例。

- [ ] **Step 2: 从 IPC 封装移除邮件类型和方法**

在 `shell-frontend/src/lib/ipc.ts` 中删除 `../types/mail` 的类型导入，以及从 `listMailAccounts` 到 `openMailWebmail` 的全部邮件方法；保留对象前后的其他 IPC 成员和现有格式。

- [ ] **Step 3: 从内置页面分发器移除邮件分支**

在 `shell-frontend/src/components/BuiltinPage.tsx` 中删除 `MailManagerPage` 导入和 `app.id === 'mail-manager'` 分支；保留 `dev-tools` 分支和未知应用占位逻辑。

- [ ] **Step 4: 运行前端验证**

Run: `cd shell-frontend && npm run lint && npm test && npm run build`

Expected: lint、Vitest 和 TypeScript/Vite 构建全部通过，且不再有邮件页面或类型的导入错误。

### Task 2: 删除 Rust 邮件业务、IPC 和专用依赖

**Files:**
- Delete: `shell-native/src/commands/mail.rs`
- Delete: `shell-native/src/mail_store.rs`
- Delete: `shell-native/src/mail_sync.rs`
- Delete: `shell-native/src/mail_runtime.rs`
- Delete: `shell-native/tests/mail_command_test.rs`
- Delete: `shell-native/tests/mail_store_test.rs`
- Delete: `shell-native/tests/mail_sync_test.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-native/src/commands/mod.rs`
- Modify: `shell-native/src/error.rs`
- Modify: `shell-native/Cargo.toml`
- Modify: `shell-native/Cargo.lock`

**Interfaces:**
- `shell-native/src/lib.rs` 的 Tauri command handler 不再暴露任何 `commands::mail::*` 命令。
- `commands` 模块只保留其他现有业务模块。
- `AppError` 不再包含只由邮件模块使用的 `Mail` 变体。

- [ ] **Step 1: 删除 Rust 邮件实现和测试**

删除邮件命令、数据库存储、IMAP 同步、后台监听及其三个 Rust 测试文件。不要删除仍由其他模块使用的 `chrono` 代码或依赖。

- [ ] **Step 2: 移除模块声明、命令注册和启动监听**

在 `shell-native/src/lib.rs` 中删除三个邮件模块声明、所有 `commands::mail::*` 注册项和 `mail_runtime::start_all(_app.handle().clone())` 调用。

在 `shell-native/src/commands/mod.rs` 中删除 `pub mod mail;`。

- [ ] **Step 3: 删除邮件错误变体**

确认仓库中不再有 `AppError::Mail` 引用后，从 `shell-native/src/error.rs` 删除 `Mail(String)` 变体；保留其他错误类型和序列化实现不变。

- [ ] **Step 4: 移除仅旧邮件使用的 Cargo 依赖**

从 `shell-native/Cargo.toml` 删除：

```toml
mailparse = "0.15"
ammonia = "4"
imap = "2.4"
native-tls = "0.2"
```

保留 `chrono = "0.4"`，因为 `process.rs`、`official_app_installer.rs` 和 `official_market.rs` 仍然使用它。

- [ ] **Step 5: 重新生成 Cargo 锁文件**

Run: `cd shell-native && cargo check`

Expected: Cargo 重新解析依赖并从 `Cargo.lock` 移除旧邮件专用依赖，同时保留其他模块所需依赖。

- [ ] **Step 6: 运行 Rust 验证**

Run: `cd shell-native && cargo test`

Expected: Rust 单元测试和集成测试全部通过，且没有邮件模块、类型或依赖缺失错误。

### Task 3: 删除内置 manifest 并更新 manifest 测试

**Files:**
- Delete: `apps/builtin/mail-manager.yaml`
- Modify: `shell-native/src/manifest.rs`
- Modify: `shell-native/tests/manifest_test.rs`

**Interfaces:**
- `BUILTIN_MANIFESTS` 只编译当前保留的内置 manifest。
- `load_all_manifests()` 仍加载 DevTools、本地 manifest 和已安装官方应用，不改变加载流程。

- [ ] **Step 1: 删除旧邮件 manifest**

删除 `apps/builtin/mail-manager.yaml`，不创建替代的 disabled 或 deprecated manifest。

- [ ] **Step 2: 删除 Rust manifest 编译期注册**

从 `shell-native/src/manifest.rs` 的 `BUILTIN_MANIFESTS` 数组移除旧邮件 `include_str!`，保留 DevTools manifest。

- [ ] **Step 3: 更新 manifest 测试**

在 `shell-native/tests/manifest_test.rs` 中：

- 将“至少有两个内置子应用”的断言改为确认 `dev-tools` 存在，避免内置应用数量成为删除邮件后的硬编码条件。
- 增加 `mail-manager` 不应出现在加载结果中的断言。
- 删除原本要求邮件 manifest 为 builtin 且无 process 的测试。
- 保留本地 manifest、已安装 manifest 和旧配置迁移测试。

- [ ] **Step 4: 运行 manifest 测试**

Run: `cd shell-native && cargo test --test manifest_test`

Expected: manifest 测试通过，内置列表包含 DevTools 且不包含 `mail-manager`。

### Task 4: 对齐文档、版本和发布日志

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/guide/aidea-builtin-app.md`
- Modify: `docs/guide/aidea-platform.md`
- Modify: `docs/guide/aidea-storage.md`
- Modify: `shell-frontend/package.json`
- Modify: `shell-frontend/package-lock.json`
- Modify: `shell-native/Cargo.toml`
- Modify: `shell-native/tauri.conf.json`
- Modify: `shell-frontend/src/data/changelog.json`

**Interfaces:**
- 文档描述与实际代码一致：旧内置邮件已经不存在，`mail-center` 是独立官方应用。
- 版本号在前端、Rust crate、Tauri 配置和 npm lockfile 中保持 `0.1.10`。
- changelog 顶部新增 `0.1.10` 记录，不改历史版本记录。

- [ ] **Step 1: 更新项目开发约定**

修改 `AGENTS.md`、`docs/guide/aidea-builtin-app.md`、`docs/guide/aidea-platform.md`、`docs/guide/aidea-storage.md` 和 `docs/guide/aidea-official-app.md`：

- 删除“旧邮件待删除实现”的当前状态描述。
- 删除“升级首次启动必须清理旧邮件数据”的要求。
- 明确历史邮件路径不属于兼容目标，新版不读取、不写入、不自动删除。
- 保留 `mail-center` 独立仓库、独立数据库和不依赖旧 IPC/Rust/前端实现的边界。

- [ ] **Step 2: 同步版本号**

将以下文件中的 `0.1.9` 改为 `0.1.10`：

- `shell-frontend/package.json`
- `shell-frontend/package-lock.json` 顶层 `version` 和空包 `packages[""].version`
- `shell-native/Cargo.toml`
- `shell-native/tauri.conf.json`

不要修改根目录 `package.json`，它没有版本字段。

- [ ] **Step 3: 更新当前版本 changelog**

在 `shell-frontend/src/data/changelog.json` 顶部新增：

```json
{
  "version": "0.1.10",
  "notes": "移除已废弃的内置邮件管理。邮件管理由独立官方应用 mail-center 承担。"
}
```

保留 `0.1.9` 及更早版本的原有内容和顺序。

- [ ] **Step 4: 验证文档和 JSON**

Run: `git diff --check`

Run: `node -e "JSON.parse(require('fs').readFileSync('shell-frontend/src/data/changelog.json', 'utf8')); JSON.parse(require('fs').readFileSync('shell-frontend/package-lock.json', 'utf8'))"`

Run: `rg -n "升级首次启动|启动时清理|后续版本.*删除|删除旧邮件数据" AGENTS.md docs/guide`

Expected: 文档没有空白错误，两个 JSON 文件可解析；文档扫描无输出，不再要求启动清理、迁移或兼容旧邮件数据。

### Task 5: 全仓库残留扫描和闭环验证

**Files:**
- Verify: `apps/`
- Verify: `shell-frontend/`
- Verify: `shell-native/`
- Verify: `AGENTS.md`
- Verify: `docs/guide/`

**Interfaces:**
- 旧内置邮件相关关键字在当前代码目录中无残留。
- 官方应用 `mail-center` 的桥接示例和官方应用规范仍然存在。

- [ ] **Step 1: 扫描代码残留**

Run:

```bash
rg -n "mail-manager|mail_manager|list_mail_|sync_mail_|open_mail_webmail|AppError::Mail|mailparse|ammonia|imap::|native_tls|commands::mail|mail_runtime|mail_store|mail_sync" \
  apps shell-frontend shell-native --glob '!shell-native/tests/manifest_test.rs'
```

Expected: 无输出；manifest 测试中的旧 ID 负向断言不计入残留检查，历史设计文档也不纳入这项代码残留检查。

- [ ] **Step 2: 检查官方 mail-center 边界未被误删**

Run:

```bash
rg -n "mail-center" shell-frontend/src/lib/app-bridge-sdk.ts docs/guide/aidea-official-app.md docs/guide/aidea-platform.md
```

Expected: 仍能找到官方应用 ID 和独立应用边界说明。

- [ ] **Step 3: 执行完整仓库测试**

Run:

```bash
cd shell-frontend && npm run lint && npm test && npm run build
cd ../shell-native && cargo test
```

Expected: 前端 lint、测试、构建和 Rust 测试全部通过。

- [ ] **Step 4: 检查最终变更边界**

Run: `git diff --stat && git status --short`

Expected: 变更只包含本计划列出的旧邮件删除、文档对齐、版本和发布日志；没有用户数据目录、自动清理逻辑、git staging 或远程操作。
