# 邮件管理实时同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让邮件管理通过 IMAP IDLE 实时接收腾讯企业邮箱和阿里云企业邮箱的收件箱、垃圾箱变更，并提供可观察的历史同步。

**Architecture:** Rust 进程内为每个账户的每个已配置文件夹维护一个阻塞 IDLE 工作线程；事件触发时复用现有 UID 游标做增量同步。运行态的监听状态、同步任务和日志只放内存，SQLite 继续只保存账户、文件夹游标和邮件数据。React 通过 IPC 读取状态和历史同步进度，并由 Tauri 事件刷新邮件列表。

**Tech Stack:** Rust、Tauri 2、`imap 2.4` IDLE 扩展、SQLite、React 18、TypeScript、Vitest。

## Global Constraints

- 腾讯企业邮箱 `imap.exmail.qq.com` 与阿里云企业邮箱 `imap.qiye.aliyun.com` 都已实测声明 IMAP `IDLE`；IDLE 是主收信机制。
- 每个收件箱和垃圾箱使用独立 IMAP 连接；一条 IMAP 连接不能同时监听两个被选中的文件夹。
- 连接失效、网络恢复、Mac 睡眠恢复和用户手动刷新时只做 UID 增量补偿；不设置固定间隔的邮件主动查询。
- IDLE 每 29 分钟重建一次以保活；自动监听和历史同步只下载列表元数据，正文继续按需获取。
- 历史同步只能由用户发起，用户选择账户、文件夹和 `7/30/90/180/365` 天范围；按批次抓取并返回进度与日志。
- 密码、授权码和 OAuth 凭据由邮件应用自己保存到 `app-data/mail-manager/app.db`，不写入日志；前端只在需要时通过内置应用 IPC 读取。
- 不新增依赖、不执行 `git add`、`git commit`、push 或 PR。

---

### Task 1: 让列表查询支持账户和文件夹视图

**Files:**
- Modify: `shell-native/src/mail_store.rs`
- Modify: `shell-native/src/commands/mail.rs`
- Modify: `shell-frontend/src/types/mail.ts`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Test: `shell-native/tests/mail_store_test.rs`

**Interfaces:**
- Produces `MessageQuery { account_id: Option<String>, folder_kind: Option<String>, search: Option<String> }`。
- Produces `list_mail_messages(query: MessageQuery) -> AppResult<Vec<MailMessageSummary>>`，以当前 Rust 命令的 snake_case 参数反序列化前端请求。

- [ ] **Step 1: 写查询过滤的失败测试**

在 `mail_store_test.rs` 写入属于两个账户和两个文件夹的四条邮件，断言指定账户、`inbox` 和关键词后只返回一条：

```rust
let result = store.list_messages(MessageQuery {
    account_id: Some("account-a".into()),
    folder_kind: Some("inbox".into()),
    search: Some("构建失败".into()),
})?;
assert_eq!(result.len(), 1);
assert_eq!(result[0].subject, "构建失败");
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_store_test`

Expected: FAIL，原因是 `MessageQuery` 还没有可传入的过滤字段。

- [ ] **Step 3: 实现参数化 SQL 过滤**

将 `MessageQuery` 声明为 `Deserialize + Default`，在 `MailStore::list_messages` 用 `WHERE (?1 IS NULL OR m.account_id = ?1) AND (?2 IS NULL OR f.folder_kind = ?2)` 过滤账户和文件夹，并对 `sender_name`、`sender_address`、`subject`、`snippet` 使用一个参数化的 `LIKE` 条件。查询保持 `received_at DESC`，不读取正文表。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_store_test`

Expected: PASS。

### Task 2: 分批同步和可观察的同步运行态

**Files:**
- Modify: `shell-native/src/mail_sync.rs`
- Create: `shell-native/src/mail_runtime.rs`
- Modify: `shell-native/src/lib.rs`
- Test: `shell-native/tests/mail_sync_test.rs`

**Interfaces:**
- Produces `MailSyncProgress { running, kind, account_id, folder_kind, phase, processed, total, logs, started_at, completed_at, error }`。
- Produces `MailRuntime::progress() -> MailSyncProgress`，供后续历史同步和监听线程共同更新。
- `sync_folder` 接收可选 `SyncObserver` 回调；每完成一个 FETCH 批次更新 `processed` 与日志。

- [ ] **Step 1: 写批次划分的失败测试**

在 `mail_sync_test.rs` 添加纯函数测试，验证 101 个 UID 使用每批 50 个分成 `50、50、1` 三批，且空 UID 不产生批次：

```rust
assert_eq!(uid_batches(&(1..=101).collect::<Vec<_>>(), 50)
    .iter().map(Vec::len).collect::<Vec<_>>(), vec![50, 50, 1]);
assert!(uid_batches(&[], 50).is_empty());
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_sync_test`

Expected: FAIL，原因是 `uid_batches` 尚不存在。

- [ ] **Step 3: 实现最小批次拉取和运行态**

添加 `const FETCH_BATCH_SIZE: usize = 50` 和私有 `uid_batches`。`fetch_messages` 对每批 UID 调用现有 `uid_fetch(..., METADATA_FETCH_QUERY)`，解析后立即通过观察回调报告已处理数量；一批解析失败要返回账户/文件夹/批次上下文的错误，不能 `filter_map` 静默丢弃。`MailRuntime` 用 `Arc<Mutex<MailSyncProgress>>` 保存唯一任务状态，用一个 `Mutex<()>` 串行化同步写入；不持久化日志。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_sync_test`

Expected: PASS。

### Task 3: 历史同步 IPC 与进度日志

**Files:**
- Modify: `shell-native/src/commands/mail.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-native/src/mail_sync.rs`
- Modify: `shell-frontend/src/types/mail.ts`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Test: `shell-native/tests/mail_command_test.rs`

**Interfaces:**
- Consumes `HistorySyncRequest { account_id: String, folder_kind: String, since_days: i64 }`。
- Produces `start_mail_history_sync(request) -> AppResult<()>` 和 `get_mail_sync_progress() -> AppResult<MailSyncProgress>`。

- [ ] **Step 1: 写历史范围校验的失败测试**

在 `mail_command_test.rs` 断言仅接受 `inbox`、`trash` 与 `7、30、90、180、365`：

```rust
assert!(validate_history_sync_request(&HistorySyncRequest {
    account_id: "a".into(), folder_kind: "inbox".into(), since_days: 30,
}).is_ok());
assert!(validate_history_sync_request(&HistorySyncRequest {
    account_id: "a".into(), folder_kind: "sent".into(), since_days: 30,
}).is_err());
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_command_test`

Expected: FAIL，原因是历史同步请求及校验函数尚不存在。

- [ ] **Step 3: 实现单任务历史同步**

`start_mail_history_sync` 先校验请求、确认账户与对应远程文件夹存在，再调用 `MailRuntime`。运行中的任务直接返回 `邮件同步正在进行`，不排队。后台任务按 `SINCE` 搜索、50 封一批抓取，将 `total` 设为搜索到的 UID 数，每批更新 `processed`，追加“连接中”“搜索到 N 封”“已处理 X/N”“完成”或错误日志。完成后沿用 `apply_folder_sync` 更新 UID 游标和保留清理。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_command_test`

Expected: PASS。

### Task 4: IDLE 监听、重连与增量补偿

**Files:**
- Modify: `shell-native/src/mail_runtime.rs`
- Modify: `shell-native/src/mail_sync.rs`
- Modify: `shell-native/src/commands/mail.rs`
- Modify: `shell-native/src/lib.rs`
- Test: `shell-native/tests/mail_sync_test.rs`

**Interfaces:**
- Produces `MailRuntime::start_all() -> AppResult<()>`、`MailRuntime::restart_account(account_id: &str) -> AppResult<()>`、`MailRuntime::sync_incremental() -> AppResult<SyncResult>`。
- Produces公开的 `MailListenerStatus { account_id, folder_kind, state, last_event_at, last_error }` 和 `get_mail_listener_status()` IPC。

- [ ] **Step 1: 写 IDLE 保活与重连间隔的失败测试**

在 `mail_sync_test.rs` 添加纯逻辑测试，要求正常 IDLE 的保活为 29 分钟、前三次重连间隔为 `1、2、4` 秒，最大不超过 60 秒：

```rust
assert_eq!(idle_keepalive(), Duration::from_secs(29 * 60));
assert_eq!(reconnect_delay(0), Duration::from_secs(1));
assert_eq!(reconnect_delay(8), Duration::from_secs(60));
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_sync_test`

Expected: FAIL，原因是保活与退避函数尚不存在。

- [ ] **Step 3: 实现双文件夹监听工作线程**

`start_all` 读取启用账户，针对 `inbox_folder` 和非空 `trash_folder` 创建一个工作线程，重复执行：登录、`select_folder`、执行一次增量补偿、`session.idle()?.set_keepalive(idle_keepalive())`、`wait_keepalive()`。收到邮箱变更后立即调用对应 `sync_folder`，然后重新进入 IDLE；连接、认证或 IDLE 出错时更新该文件夹监听状态，以 `reconnect_delay` 等待后重新登录。不要使用定时 `uid_search`；29 分钟保活只重建 IDLE 命令。

在 Tauri `setup` 中初始化 `MailRuntime` 后异步启动 `start_all`；保存账户成功后调用 `restart_account`，删除账户后移除其运行态状态。`sync_mail_accounts` 改为手动增量补偿，并在完成后触发 `mail-sync-completed` 事件。

- [ ] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_sync_test`

Expected: PASS。

### Task 5: 多账户账户树、监听状态和历史同步面板

**Files:**
- Modify: `shell-frontend/src/builtin-apps/mail-manager/MailManagerPage.tsx`
- Create: `shell-frontend/src/builtin-apps/mail-manager/HistorySyncDialog.tsx`
- Modify: `shell-frontend/src/types/mail.ts`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Test: `shell-frontend/tests/mail-manager/MailManagerPage.test.tsx`
- Test: `shell-frontend/tests/mail-manager/HistorySyncDialog.test.tsx`

**Interfaces:**
- Consumes `listMailMessages(query)`、`getMailListenerStatus()`、`getMailSyncProgress()`、`startMailHistorySync(request)` 和 Tauri `mail-sync-completed` 事件。
- Produces当前选择 `MailView = { account_id: string | null, folder_kind: 'inbox' | 'trash' }`；`null + inbox` 是“全部收件箱”。

- [ ] **Step 1: 写账户树和聚合列表的失败测试**

在 `MailManagerPage.test.tsx` mock `ipc`，验证默认调用 `{ account_id: null, folder_kind: 'inbox', search: '' }`，点击某账户的垃圾箱后调用该账户 ID 和 `trash`，聚合列表中显示邮件账户名称：

```tsx
await user.click(screen.getByRole('button', { name: 'ops@example.com 垃圾箱' }));
expect(ipc.listMailMessages).toHaveBeenLastCalledWith({
  account_id: 'account-a', folder_kind: 'trash', search: '',
});
expect(screen.getByText('腾讯企业邮箱')).toBeInTheDocument();
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/mail-manager/MailManagerPage.test.tsx`

Expected: FAIL，原因是页面仍使用全局二选一文件夹状态。

- [ ] **Step 3: 实现账户树与增量刷新反馈**

左栏按“全部收件箱”“每账户/收件箱/垃圾箱”渲染，账户名称和邮箱只显示一次；账户旁用文本状态显示“监听中”“重连中”或错误。中栏每封邮件显示所属账户名称。工具栏的刷新按钮改为“立即补偿”，调用增量同步，不因 IDLE 常驻而禁用。组件挂载时订阅 `mail-sync-completed`，事件到达后重新加载账户和当前列表；卸载时取消订阅。

- [ ] **Step 4: 写历史同步进度的失败测试**

在 `HistorySyncDialog.test.tsx` 验证选择 30 天并提交调用 `startMailHistorySync`，mock 进度从 `processed: 0` 到 `processed: 50, total: 120` 后显示 `50 / 120` 和一条服务器日志：

```tsx
expect(ipc.startMailHistorySync).toHaveBeenCalledWith({
  account_id: 'account-a', folder_kind: 'inbox', since_days: 30,
});
expect(screen.getByText('50 / 120')).toBeInTheDocument();
```

- [ ] **Step 5: 实现历史同步对话框**

使用现有 `Dialog`、`Select`、`Button`，不新增组件库。入口只在已选定某个账户及文件夹时启用；显示固定时间范围、进度、当前阶段、最近日志和错误。任务运行期间每秒调用 `getMailSyncProgress`，任务结束后停止状态轮询并刷新当前列表。状态轮询只读取内存进度，绝不触发邮件查询。

- [ ] **Step 6: 运行前端测试确认通过**

Run: `npm test -- --run tests/mail-manager/MailManagerPage.test.tsx tests/mail-manager/HistorySyncDialog.test.tsx`

Expected: PASS。

### Task 6: 全量验证与真实 IMAP 验收

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-mail-manager-design.md`（仅在实现与设计不一致时）

- [ ] **Step 1: 运行 Rust 测试**

Run: `cargo test --manifest-path shell-native/Cargo.toml`

Expected: PASS。

- [ ] **Step 2: 运行前端检查**

Run: `npm run lint && npm run build && npm test`（工作目录：`shell-frontend`）

Expected: PASS；记录项目已有的 `act(...)` 与 CodeMirror 警告，不修改无关模块。

- [ ] **Step 3: 执行人工验收**

使用已配置的腾讯企业邮箱：保持邮件管理打开，向收件箱发送测试邮件并验证无需点击刷新即可出现；将一封测试邮件放进垃圾箱并验证垃圾箱视图更新；断开再恢复网络，验证状态先显示重连后增量补齐；启动一次 30 天历史同步，验证批次进度和日志；确认授权码只保存在邮件应用自己的 `app.db` 中，不出现在前端日志或普通运行日志。

- [ ] **Step 4: 记录验证边界**

在交付说明中注明：自动测试不连接真实邮箱，腾讯和阿里云的 CAPABILITY 已做无鉴权实测；Gmail OAuth、发信、附件、规则与系统通知仍不在本次范围内。
