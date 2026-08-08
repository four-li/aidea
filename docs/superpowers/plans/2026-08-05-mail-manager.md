# 邮件管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 aIdea 中实现只读的多账户 IMAP 邮件管理内置子应用，第一阶段同步收件箱和垃圾箱。

**Architecture:** Rust 模块负责 SQLite、Keychain、IMAP 和 URL 校验，通过 Tauri IPC 提供账户与邮件操作；React 内置页面只消费 IPC 类型。每个账户的同步失败独立记录，列表只读取 SQLite 摘要，正文按需下载、清理并缓存。

**Tech Stack:** Rust、Tauri 2、`rusqlite`、`imap`、`native-tls`、`mailparse`、`ammonia`、React 18、TypeScript、Vitest、shadcn/ui。

## Global Constraints

- 只支持 IMAP 收件箱和垃圾箱；Gmail OAuth、发信、附件、规则和后台常驻同步不在本计划内。
- 密码和授权码只进入 macOS Keychain，SQLite 与 JSON 配置不得保存敏感值。
- 数据库遵守 [app-storage-spec.md](../../app-storage-spec.md)，文件固定为 `databases/mail-manager.db`。
- 同步只保留收件箱最近 90 天、垃圾箱最近 30 天的本地数据，不删除服务器邮件。
- 邮件 HTML 必须清理后再显示，默认不加载远程资源。
- 不执行 `git add` 或 `git commit`；由用户决定提交时机。

---

### Task 1: 建立邮件数据库与本地存储模块

**Files:**
- Modify: `shell-native/Cargo.toml`
- Modify: `shell-native/src/config.rs`
- Modify: `shell-native/src/error.rs`
- Create: `shell-native/migrations/mail-manager/001_initial.sql`
- Create: `shell-native/src/mail_store.rs`
- Test: `shell-native/src/mail_store.rs`

**Interfaces:**
- Produces: `MailStore::open() -> AppResult<MailStore>`、`MailStore::list_messages(query: MessageQuery) -> AppResult<Vec<MailMessageSummary>>`、`MailStore::message_detail(message_id: i64) -> AppResult<MailMessageDetail>`。
- Produces: 内部 `MailAccountRecord`、`MailFolder`、`MailMessageSummary`、`MailMessageDetail`、`MessageQuery`。`MailAccountRecord` 含 Keychain ID，只供 Rust 存储与同步模块使用。

- [ ] **Step 1: 写数据库初始化失败测试**

在 `mail_store.rs` 的测试模块中，使用临时 `AIDEA_DATA_DIR`，断言 `MailStore::open()` 创建 `databases/mail-manager.db`、执行迁移，并能查询空列表：

```rust
#[test]
fn open_creates_database_and_returns_empty_messages() {
    let store = MailStore::open().expect("应创建邮件数据库");
    assert!(store.database_path().exists());
    assert!(store.list_messages(MessageQuery::default()).unwrap().is_empty());
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cargo test --manifest-path shell-native/Cargo.toml mail_store::tests::open_creates_database_and_returns_empty_messages`

Expected: FAIL，提示 `mail_store` 或 `MailStore` 尚不存在。

- [ ] **Step 3: 添加最小数据库依赖和迁移**

在 `Cargo.toml` 添加：

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
uuid = { version = "1", features = ["v4"] }
```

在 `config::ensure_data_dirs()` 增加 `root.join("databases")`。`001_initial.sql` 创建 `_migrations`、`mail_accounts`、`mail_folders`、`mail_messages`、`mail_bodies`，表和唯一约束严格按设计规格定义，另外创建 `(folder_id, received_at DESC)` 与 `(account_id, received_at DESC)` 索引。

- [ ] **Step 4: 实现 `MailStore` 和迁移执行**

`MailStore::open()` 必须：

```rust
let connection = Connection::open(database_path)?;
connection.execute_batch(
    "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;",
)?;
```

随后在事务中检查 `_migrations`，仅执行尚未记录的 `001_initial.sql`，最后记录版本 `1` 和当前 Unix 秒。为 `rusqlite::Error` 增加 `AppError::Database` 转换。不要建立全局连接池；每次存储操作打开短生命周期连接即可。

- [ ] **Step 5: 实现本地读写和保留清理测试**

实现账户、文件夹、邮件摘要、正文的 upsert 与读取；在同一事务内保存邮件与正文。补充测试验证：同一 `folder_id + remote_uid` 重复写入不会生成第二条记录；清理函数只删除超过给定截止时间的本地邮件。

```rust
assert_eq!(store.list_messages(MessageQuery::default()).unwrap().len(), 1);
store.delete_messages_before(folder_id, cutoff).unwrap();
assert!(store.list_messages(MessageQuery::default()).unwrap().is_empty());
```

- [ ] **Step 6: 运行 Rust 数据库测试**

Run: `cargo test --manifest-path shell-native/Cargo.toml mail_store`

Expected: PASS。

### Task 2: 实现账户凭据与账户管理 IPC

**Files:**
- Create: `shell-native/src/mail_keychain.rs`
- Create: `shell-native/src/commands/mail.rs`
- Modify: `shell-native/src/commands/mod.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-native/src/mail_store.rs`
- Test: `shell-native/src/commands/mail.rs`

**Interfaces:**
- Consumes: `MailStore`、内部 `MailAccountRecord`。
- Produces: `save_mail_account(request: SaveMailAccountRequest)`、`list_mail_accounts()`、`delete_mail_account(id)`、`list_mail_messages(query)`、`get_mail_message(id)`。
- Produces: `SaveMailAccountRequest`，其中 `secret` 只在命令入参中存在，不写入返回类型。

- [ ] **Step 1: 写账户保存测试**

用纯参数校验测试覆盖空邮箱、非 HTTP(S) 网页邮箱地址和无效端口：

```rust
assert!(validate_account_request(&invalid_port_request()).is_err());
assert!(validate_account_request(&invalid_webmail_request()).is_err());
```

- [ ] **Step 2: 实现独立邮件 Keychain 服务**

创建 `mail_keychain.rs`，服务名固定为 `com.aidea.mail-manager`，复用现有 `security_framework::passwords` 写入、读取和删除模式。账户删除时必须先删数据库记录，再尽力删除对应 Keychain 条目；删除 Keychain 失败返回明确错误，不静默吞掉。

- [ ] **Step 3: 实现账户命令和输入校验**

`SaveMailAccountRequest` 必填字段为显示名、邮箱、IMAP 主机、端口、用户名、认证方式、密钥和网页邮箱 URL。校验 IMAP 主机非空、端口在 `1..=65535`、网页邮箱 URL 只允许 `http` 或 `https`。新账户使用 `Uuid::new_v4()`；更新账户复用已有 ID 和 Keychain ID。

命令将内部 `MailAccountRecord` 映射为公开 `MailAccount`；返回值不得序列化 `secret`、Keychain ID 或任何凭据提示以外的敏感字段。

- [ ] **Step 4: 注册 IPC 并运行测试**

在 `commands/mod.rs` 导出 `mail`，在 `lib.rs` 的 `invoke_handler!` 注册邮件命令。运行：

`cargo test --manifest-path shell-native/Cargo.toml commands::mail`

Expected: PASS。

### Task 3: 实现 IMAP 增量同步、正文按需加载与安全清理

**Files:**
- Modify: `shell-native/Cargo.toml`
- Create: `shell-native/src/mail_sync.rs`
- Modify: `shell-native/src/mail_store.rs`
- Modify: `shell-native/src/commands/mail.rs`
- Modify: `shell-native/src/lib.rs`
- Test: `shell-native/src/mail_sync.rs`

**Interfaces:**
- Consumes: `MailStore::list_enabled_accounts()`、`mail_keychain::load()`。
- Produces: `sync_mail_accounts() -> AppResult<SyncResult>`、`load_mail_body(message_id: i64) -> AppResult<MailMessageDetail>`、`mark_mail_read(message_id: i64) -> AppResult<()>`。

- [ ] **Step 1: 写 MIME 解析与 HTML 清理测试**

先写不依赖真实邮箱服务器的测试：

```rust
#[test]
fn parse_message_prefers_plain_text_and_removes_unsafe_html() {
    let parsed = parse_message(FIXTURE.as_bytes()).unwrap();
    assert_eq!(parsed.subject, "构建失败");
    assert!(!parsed.sanitized_html.contains("<script"));
    assert!(!parsed.sanitized_html.contains("https://tracker.example"));
}
```

- [ ] **Step 2: 添加邮件协议与正文清理依赖**

在 `Cargo.toml` 添加：

```toml
imap = "2.4"
native-tls = "0.2"
mailparse = "0.15"
ammonia = "4"
```

同步运行在 `tokio::task::spawn_blocking` 中，避免阻塞 Tauri async runtime；不增加连接池或后台守护线程。

- [ ] **Step 3: 实现纯解析函数**

`parse_message(raw: &[u8])` 提取发件人、主题、日期、`Message-ID`、纯文本摘要和清理后的 HTML。HTML 清理须移除脚本、表单、内联事件、`javascript:` URL、图片和外部资源；清理后没有可用 HTML 时保存纯文本。解析失败返回 `AppError::Mail`，不保存半条正文。

- [ ] **Step 4: 实现文件夹识别和增量同步**

优先依据 IMAP `\\Trash` 特殊用途选择垃圾箱；服务器未提供时，从账户配置的手工 `remote_name` 使用。每个文件夹依据 `uid_validity` 与 `last_uid` 拉取增量元数据；首次同步按日期条件取 90 天或 30 天。保存元数据、同步游标和超期清理必须在同一个 SQLite 事务内。单个账户失败写回 `last_error`，循环继续同步下一个账户。

- [ ] **Step 5: 实现正文读取、已读写回和 IPC**

详情请求先读取 `mail_bodies`；未缓存时从对应 IMAP UID 拉取完整 MIME、解析清理后写缓存。`mark_mail_read` 向 IMAP 写 `\\Seen` 成功后再更新本地 `is_read`，远端失败则保持本地未读。注册 `sync_mail_accounts`、`get_mail_message`、`mark_mail_read` 命令。

- [ ] **Step 6: 运行模块测试和静态检查**

Run: `cargo test --manifest-path shell-native/Cargo.toml mail_sync`

Run: `cargo clippy --manifest-path shell-native/Cargo.toml -- -D warnings`

Expected: PASS。

### Task 4: 注册内置应用并实现账户配置界面

**Files:**
- Create: `apps/builtin/mail-manager.yaml`
- Modify: `shell-native/src/manifest.rs`
- Modify: `shell-native/tests/manifest_test.rs`
- Create: `shell-frontend/src/types/mail.ts`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Create: `shell-frontend/src/builtin-apps/mail-manager/index.tsx`
- Create: `shell-frontend/src/builtin-apps/mail-manager/MailManagerPage.tsx`
- Create: `shell-frontend/src/builtin-apps/mail-manager/AccountDialog.tsx`
- Modify: `shell-frontend/src/components/BuiltinPage.tsx`
- Test: `shell-frontend/tests/mail-manager/AccountDialog.test.tsx`
- Test: `shell-frontend/tests/manifest-loader.test.ts`

**Interfaces:**
- Consumes: Rust `SaveMailAccountRequest`、`MailAccount` IPC 类型。
- Produces: `MailManagerPage` 和 `MailAccount` TypeScript 类型。

- [ ] **Step 1: 添加失败的 manifest 测试**

在 `shell-native/tests/manifest_test.rs` 添加：

```rust
#[test]
fn mail_manager_应为_builtin_模式且无_process() {
    let manifests = load_all_manifests().unwrap();
    let mail = manifests.iter().find(|m| m.id == "mail-manager").unwrap();
    assert_eq!(mail.ui.mode, UiMode::Builtin);
    assert!(mail.process.is_none());
}
```

- [ ] **Step 2: 添加 manifest 和显式注册**

创建 `apps/builtin/mail-manager.yaml`，使用 `id: mail-manager`、`name: 邮件管理`、`category: 效率`、`version: 0.1.0`、`ui.mode: builtin`、`ui.icon: Mail`。在 `BUILTIN_MANIFESTS` 加入文件，在 `BuiltinPage` 添加 `mail-manager` 分支。

- [ ] **Step 3: 声明前端跨端类型与 IPC 封装**

`src/types/mail.ts` 定义不含 `secret` 的账户、邮件摘要、详情、查询和同步结果类型。`ipc.ts` 添加 `listMailAccounts`、`saveMailAccount`、`deleteMailAccount`、`listMailMessages`、`syncMailAccounts`、`getMailMessage`、`markMailRead` 方法，参数名和 Rust 命令保持一致。

- [ ] **Step 4: 编写账户配置测试并实现对话框**

测试至少覆盖：腾讯企业邮箱预设填充、阿里云邮箱预设填充、缺少必填项时保存按钮禁用、提交时不回显授权码。`AccountDialog` 使用现有 `Dialog`、`Input`、`Select` 和 `Button` 原语；“手工配置”只在用户选择后显示主机和端口字段。

- [ ] **Step 5: 实现空状态和账户管理入口**

`MailManagerPage` 在无账户时显示添加账户的主要按钮；有账户但无邮件时显示刷新按钮。账户列表只显示名称、邮箱和上次同步错误摘要，不显示凭据。保存成功后重新获取账户列表并触发一次同步。

- [ ] **Step 6: 运行前端单元测试**

Run: `npm test -- --run tests/mail-manager/AccountDialog.test.tsx tests/manifest-loader.test.ts`

Expected: PASS。

### Task 5: 实现邮件三段式阅读界面与浏览器写信跳转

**Files:**
- Create: `shell-frontend/src/builtin-apps/mail-manager/MessageList.tsx`
- Create: `shell-frontend/src/builtin-apps/mail-manager/MessageDetail.tsx`
- Modify: `shell-frontend/src/builtin-apps/mail-manager/MailManagerPage.tsx`
- Modify: `shell-native/src/commands/mail.rs`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Test: `shell-frontend/tests/mail-manager/MailManagerPage.test.tsx`
- Test: `shell-frontend/tests/mail-manager/MessageDetail.test.tsx`

**Interfaces:**
- Consumes: `listMailMessages`、`getMailMessage`、`markMailRead`、`openMailWebmail`。
- Produces: 按账户/文件夹/关键词筛选的邮件阅读页面。

- [ ] **Step 1: 写列表交互测试**

Mock `ipc`，断言默认查询为收件箱、选择垃圾箱后使用 `folderKind: 'trash'`、输入关键词后传递 `search`，以及点击未读邮件会请求详情并调用 `markMailRead`：

```tsx
await user.click(screen.getByRole('button', { name: '垃圾箱' }));
expect(ipc.listMailMessages).toHaveBeenLastCalledWith({ folderKind: 'trash', search: '' });
```

- [ ] **Step 2: 实现列表和详情布局**

使用桌面三段式 `grid`：左侧账户/文件夹固定 208px，中间邮件列表最小 320px，右侧详情 `minmax(420px, 1fr)`。邮件列表只展示发件人、主题、摘要、时间和未读状态；详情先展示纯文本，存在 `sanitized_html` 时在不带 Tauri IPC 注入的 sandboxed iframe 中显示。

- [ ] **Step 3: 实现刷新、错误和加载状态**

页面加载账户和当前文件夹消息；刷新时禁用刷新按钮并显示旋转图标。账户同步失败时仅在该账户旁显示错误状态，其余邮件仍可阅读。请求失败用 `toast.error` 提示，并保留上一次成功列表，避免内容跳动。

- [ ] **Step 4: 实现安全的网页写信跳转**

Rust 添加 `open_mail_webmail(account_id)`：从数据库取得 `webmail_url`，再次校验只允许 `http`、`https`，然后调用 `/usr/bin/open`。前端“写信”按钮调用该 IPC；不接受前端直接传入任意 URL。测试 URL 校验拒绝 `file:`、`javascript:` 与空地址。

- [ ] **Step 5: 运行前端验证**

Run: `npm test -- --run tests/mail-manager/MailManagerPage.test.tsx tests/mail-manager/MessageDetail.test.tsx`

Run: `npm run lint`

Run: `npm run build`

Expected: PASS。

### Task 6: 全量验证与人工 IMAP 验收

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-mail-manager-design.md`（仅在实现与规格不一致时同步修正）

- [ ] **Step 1: 运行完整自动化验证**

Run: `cargo test --manifest-path shell-native/Cargo.toml`

Run: `cargo clippy --manifest-path shell-native/Cargo.toml -- -D warnings`

Run: `npm test`

Run: `npm run lint`

Run: `npm run build`

Expected: 全部 PASS。

- [ ] **Step 2: 执行人工验收**

使用一个测试 IMAP 账户验证：添加账户、首次同步、收件箱与垃圾箱切换、打开纯文本和 HTML 邮件、标记已读、错误凭据提示、浏览器写信跳转。确认数据库和 `shell.config.json` 中不含授权码或密码。

- [ ] **Step 3: 记录未覆盖的边界**

在交付说明中明确：Gmail OAuth、附件、发信、后台通知和规则统计未实现；由于自动化测试不连接真实 IMAP 服务，真实服务商的 TLS 和垃圾箱特殊用途识别由人工验收覆盖。
