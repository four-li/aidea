# 邮件中心 V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 aIdea 内置邮件中心上增加多账户图标与隔离视图、收件箱/垃圾箱/已删除三类文件夹、未读筛选、远程移动删除和可见同步进度。

**Architecture:** 继续使用 `mail-manager.db` 和现有 IMAP 同步路径。Rust 负责文件夹映射、账户/文件夹过滤、远程 MOVE、已读状态和同步状态事件；React 保持经典三栏布局，将账户选择和文件夹筛选集中在左栏，将同步状态放进紧凑面板。

**Tech Stack:** Rust、rusqlite、imap、native-tls、Tauri 2 IPC、React 18、TypeScript、shadcn/ui、lucide-react、Vitest。

## Global Constraints

- 不增加写信、回复、转发、草稿箱或永久删除功能。
- 密码、授权码和令牌只存 macOS Keychain；SQLite 不存敏感信息。
- 数据库继续按内置应用隔离，迁移必须事务执行并遵守 `docs/app-storage-spec.md`。
- IMAP 文件夹类型只使用 `inbox`、`spam`、`deleted`；旧 `trash_folder` 数据不得丢失。
- 删除成功前不能先把邮件从本地列表移除；不调用 `EXPUNGE`。
- 前端默认每页 30 封，列表查询必须使用账户、文件夹和已读筛选参数。
- 不自动执行 `git add`、`git commit`、push 或 PR。

---

### Task 1: SQLite 文件夹与同步任务迁移

**Files:**
- Create: `shell-native/migrations/mail-manager/003_mail_center_v2.sql`
- Modify: `shell-native/src/mail_store.rs`
- Modify: `shell-native/src/commands/mail.rs`
- Modify: `shell-native/src/types` equivalent Rust structs in `mail_store.rs`
- Test: `shell-native/tests/mail_store_test.rs`

**Interfaces:**
- `MessageQuery` 增加 `read_state: Option<String>`。
- `MailAccountRecord` 增加 `spam_folder: Option<String>`、`deleted_folder: Option<String>`。
- `MailMessagePage` 查询支持 `folder_kind = inbox|spam|deleted` 和 `read_state = all|read|unread`。
- 增加同步状态记录读写函数，至少提供 `begin_sync_task`、`update_sync_task`、`finish_sync_task` 和 `list_sync_tasks`。

- [ ] **Step 1: 写失败的迁移和查询测试**

在 `mail_store_test.rs` 增加测试：迁移后账户保留旧 `trash_folder` 内容并映射到 `deleted_folder`；同一账户的 `spam` 与 `deleted` 邮件可分开查询；`read_state = unread` 只返回 `is_read = 0`；同步任务能记录阶段和进度。

- [ ] **Step 2: 运行邮件存储测试确认失败**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_store_test`

Expected: FAIL，因为新字段、迁移和 `read_state` 查询尚不存在。

- [ ] **Step 3: 写 003 迁移和最小存储实现**

迁移内容：为 `mail_accounts` 增加 `spam_folder`、`deleted_folder`；把旧 `trash_folder` 复制到 `deleted_folder`，保留旧列用于兼容；增加 `mail_sync_tasks` 表，字段包括 `id`、`account_id`、`kind`、`phase`、`processed`、`total`、`started_at`、`finished_at`、`error`，外键删除策略为 `CASCADE`。

`list_messages` 使用参数化条件追加 `m.is_read` 过滤，不把过滤逻辑放到前端；账户读取和保存同时映射新字段。同步任务只保存元数据，不保存邮件正文或凭据。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_store_test`

Expected: PASS，原有邮件存储测试也必须继续通过。

### Task 2: IMAP 文件夹探测、实时同步和远程删除

**Files:**
- Modify: `shell-native/src/mail_sync.rs`
- Modify: `shell-native/src/mail_runtime.rs`
- Modify: `shell-native/src/commands/mail.rs`
- Modify: `shell-native/src/lib.rs`
- Test: `shell-native/tests/mail_sync_test.rs`
- Test: `shell-native/tests/mail_command_test.rs`

**Interfaces:**
- `list_mail_folders(account_id)` 返回远程名称、特殊用途标记和已映射 `folder_kind`。
- `move_mail_to_deleted(id)` 先执行远程 MOVE，成功后更新本地文件夹。
- `mark_mail_unread(id)` 与现有 `mark_mail_read(id)` 对称，并向远程发送 UID STORE。
- 同步过程中发出 `mail-sync-progress` 事件，payload 包含账户 ID、阶段、已处理数、总数、错误。

- [ ] **Step 1: 写失败的 IMAP 行为测试**

增加不依赖真实邮箱的测试替身，验证文件夹特殊用途映射为 `spam`/`deleted`、已读筛选使用远程状态、删除不调用 `EXPUNGE`、同步进度事件阶段顺序为 `connect`、`list`、`fetch`、`store`。

- [ ] **Step 2: 实现文件夹映射和同步事件**

复用现有 IMAP 登录和批量 UID 拉取函数。优先使用 `SPECIAL-USE` 标记和名称匹配探测垃圾箱/已删除；账户配置存在明确目录时优先使用配置。IDLE 事件只触发受影响文件夹的增量同步，并通过现有事件总线通知前端。

- [ ] **Step 3: 实现 MOVE 与已读切换**

优先调用 IMAP UID MOVE；服务器不支持时执行 UID COPY 到 `deleted_folder` 后标记源邮件 `\\Deleted`，不发送 EXPUNGE。远程操作成功后才更新本地 `folder_id`。已读/未读更新同样先操作远程，失败不改变本地状态。

- [ ] **Step 4: 运行 Rust 全量测试**

Run: `cargo test --manifest-path shell-native/Cargo.toml`

Expected: PASS。

### Task 3: 前端类型、IPC 和账户表单

**Files:**
- Modify: `shell-frontend/src/types/mail.ts`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Modify: `shell-frontend/src/builtin-apps/mail-manager/AccountDialog.tsx`
- Modify: `shell-frontend/tests/mail-manager/AccountDialog.test.tsx`

**Interfaces:**
- `MailMessageQuery` 增加 `read_state?: 'all' | 'read' | 'unread'`。
- `MailMessageSummary.folder_kind` 改为 `'inbox' | 'spam' | 'deleted'`。
- `MailAccount` 和 `SaveMailAccountRequest` 增加 `spam_folder`、`deleted_folder`。
- IPC 增加 `listMailFolders`、`moveMailToDeleted`、`markMailUnread`、`listMailSyncTasks`。

- [ ] **Step 1: 写前端失败测试**

验证账户编辑保存两个远程目录；查询参数携带 `read_state`；删除和标记未读调用正确 IPC；已有眼睛按钮和 Touch ID 行为必须保持。

- [ ] **Step 2: 更新类型和 IPC 封装**

只添加明确的 `invoke` 包装和类型，不在组件中拼接 IPC 命令字符串。保留旧字段兼容已存在账户，新增账户默认目录为空并由后端探测。

- [ ] **Step 3: 更新账户表单**

将“垃圾箱文件夹”改为“垃圾箱远程文件夹”和“已删除远程文件夹”两个输入；密码仍默认掩码，眼睛按钮仍是唯一的明文读取入口。

- [ ] **Step 4: 运行前端定向测试和 lint**

Run: `npm test -- --run tests/mail-manager/AccountDialog.test.tsx && npm run lint`

Expected: PASS。

### Task 4: A 方案三栏界面与账户隔离

**Files:**
- Modify: `shell-frontend/src/builtin-apps/mail-manager/MailManagerPage.tsx`
- Modify: `shell-frontend/tests/mail-manager/MailManagerPage.test.tsx`
- Modify: `shell-frontend/src/builtin-apps/mail-manager` only when a small existing component extraction is required

**Interfaces:**
- 左栏状态：`scope = all | account(id)`、`folder = inbox | spam | deleted`。
- 收件箱额外状态：`readState = all | read | unread`。
- 列表查询始终把 `account_id`、`folder_kind`、`read_state` 传给 IPC。

- [ ] **Step 1: 写页面失败测试**

覆盖：账户图标和未读数；点击账户后只显示该账户；收件箱切换全部/已读/未读；垃圾箱与已删除分开；列表删除调用 `moveMailToDeleted`；详情可标记未读。

- [ ] **Step 2: 实现左栏和列表筛选**

左栏固定显示三个菜单，账户条目显示 provider 图标、名称、地址和未读数；账户点击只改变查询状态，不复制或过滤已加载数组。中栏顶部显示当前菜单、筛选 tab 和 `已显示 / 总数`。

- [ ] **Step 3: 实现未读和删除交互**

未读行使用加粗，点击详情自动标记已读；详情和列表操作提供“标记未读”和“移入已删除”。删除调用失败时保留邮件并显示 toast，成功后重新加载当前查询。

- [ ] **Step 4: 运行页面测试**

Run: `npm test -- --run tests/mail-manager/MailManagerPage.test.tsx`

Expected: PASS。

### Task 5: 同步状态面板与历史拉取

**Files:**
- Modify: `shell-frontend/src/builtin-apps/mail-manager/MailManagerPage.tsx`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Modify: `shell-frontend/tests/mail-manager/MailManagerPage.test.tsx`

**Interfaces:**
- 监听 `mail-sync-progress` 事件并按 `account_id` 更新进度。
- 提供同步面板状态：`idle | listening | syncing | error`。
- `syncMailAccounts` 仅触发增量同步；历史拉取通过已有命令扩展时间范围参数，并支持取消。

- [ ] **Step 1: 写同步面板失败测试**

验证多个账户各自显示阶段、进度和错误；实时监听状态不显示伪造百分比；点击单账户重试只发起该账户同步；历史拉取取消后保留已完成数量。

- [ ] **Step 2: 实现事件订阅和面板**

顶部同步图标打开紧凑面板，面板显示账户状态、最近同步时间、阶段、已处理/总数和错误；事件监听只更新状态 Map，不触发整页重载。同步结束后按当前查询刷新列表和计数。

- [ ] **Step 3: 实现历史范围和取消**

提供 7/30/90 天和自定义范围；开始历史任务时写入同步任务表，取消只停止后续批次，不回滚已经落库的邮件。按钮和错误状态使用现有 shadcn 原语与 toast。

- [ ] **Step 4: 运行前端全量验证**

Run: `npm run lint && npm run build && npm test`

Expected: PASS；保留现有 IpLookup `act` 和 CodeMirror jsdom 警告，不修改无关模块。

### Task 6: 端到端验收和文档同步

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-mail-center-v2-design.md` only if implementation changes an approved contract
- Test: `shell-native/tests/*`, `shell-frontend/tests/mail-manager/*`

- [ ] **Step 1: 运行完整 Rust 与前端闭环**

Run: `cargo test --manifest-path shell-native/Cargo.toml && (cd shell-frontend && npm run lint && npm run build && npm test)`

- [ ] **Step 2: 人工验收多账户隔离**

使用至少两个账户确认：全部邮件聚合、单账户过滤、账户图标、未读数量、垃圾箱和已删除互不混淆。

- [ ] **Step 3: 人工验收删除和同步**

确认删除后远程服务器邮件进入已删除文件夹；模拟断网/休眠恢复后出现补同步；历史拉取显示阶段和进度；同步失败只影响对应账户。

- [ ] **Step 4: 检查工作区并交付**

Run: `git diff --check && git status --short`

只报告改动和验证结果，不执行 git add、commit、push 或 PR。
