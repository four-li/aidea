# 邮箱账户编辑与连接测试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为邮件管理增加右键编辑账户、经 macOS 本机认证读取已保存凭据，以及不持久化的 IMAP 连接测试。

**Architecture:** Rust 在现有邮件命令上新增“读取指定账户秘密”和“使用表单秘密测试 IMAP 登录”两个 IPC。两者分别复用 `mac_auth` + `mail_keychain` 与邮件同步相同的 TLS/IMAP 连接路径。React 保持账户弹窗复用，账户右键菜单传入待编辑账户，弹窗加载认证后的秘密并调用连接测试 IPC。

**Tech Stack:** Rust、Tauri 2、security-framework、objc2 LocalAuthentication、imap、native-tls、React 18、TypeScript、shadcn/ui、Vitest。

## Global Constraints

- 不新增 SQLite 表、迁移或依赖；密码和授权码继续只保存于 macOS Keychain。
- 账户右键菜单使用现有 shadcn `ContextMenu` 原语，按钮和图标继续使用 lucide-react。
- 读取密码只允许用户点击眼睛图标后触发，并先调用现有 `mac_auth::authenticate_local_user`；认证缓存时间保持 5 分钟。
- 测试连接只验证 TLS 连接和 IMAP 登录，不写 SQLite、不写 Keychain、不拉取或修改邮件。
- 不自动执行 `git add`、`git commit`、push 或 PR。

---

### Task 1: 增加安全的凭据读取与临时 IMAP 登录 IPC

**Files:**
- Modify: `shell-native/src/commands/mail.rs`
- Modify: `shell-native/src/mail_sync.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-native/tests/mail_command_test.rs`

**Interfaces:**
- Produces: `pub fn validate_connection_request(request: &SaveMailAccountRequest) -> AppResult<()>`。
- Produces: `#[tauri::command] pub fn load_mail_account_secret(id: String) -> AppResult<String>`。
- Produces: `#[tauri::command] pub async fn test_mail_account_connection(request: SaveMailAccountRequest) -> AppResult<()>`。
- Consumes: `mail_sync::login_with_credentials(host, port, tls_mode, username, secret)`，仅建立并登录一次，会话随后登出。

- [x] **Step 1: 写失败的 Rust 请求校验测试**

在 `shell-native/tests/mail_command_test.rs` 引入 `validate_connection_request`。复制 `valid_request()`，分别清空 `imap_host` 与 `secret`，断言都被拒绝；将 `webmail_url` 设为无效协议，断言连接校验仍通过，证明测试连接不依赖网页邮箱地址。

```rust
#[test]
fn 测试连接只校验_imap_登录字段() {
    let mut request = valid_request();
    request.webmail_url = "file:///tmp/mail".into();
    assert!(validate_connection_request(&request).is_ok());

    request.secret.clear();
    assert!(validate_connection_request(&request).is_err());
}
```

- [x] **Step 2: 运行失败测试**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_command_test 测试连接只校验_imap_登录字段`

Expected: FAIL，因为 `validate_connection_request` 尚不存在。

- [x] **Step 3: 实现最小的共享登录路径和命令**

在 `mail_sync.rs` 将现有 `login(account)` 中的 TLS 创建、`imap::connect` 和 `client.login` 提取为参数明确的内部函数：

```rust
pub fn login_with_credentials(
    imap_host: &str,
    imap_port: i64,
    tls_mode: &str,
    username: &str,
    secret: &str,
) -> AppResult<imap::Session<native_tls::TlsStream<std::net::TcpStream>>>;
```

保留 `login(account)`，仅负责从 Keychain 读取秘密后调用该函数。新测试命令调用 `validate_connection_request`、解析空 `username` 为 `email`、调用共享函数并立即 `logout()`。新读取命令先从 `MailStore` 查询账户，找不到时返回“邮件账户不存在”，再调用：

```rust
crate::mac_auth::authenticate_local_user("查看已保存的邮件凭据")?;
crate::mail_keychain::load(&account.keychain_id)
```

在 `lib.rs` 的 `generate_handler!` 注册两个新命令。

- [x] **Step 4: 运行邮件命令与 Rust 全量测试**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_command_test && cargo test --manifest-path shell-native/Cargo.toml`

Expected: PASS。

### Task 2: 扩展前端 IPC 和账户弹窗

**Files:**
- Modify: `shell-frontend/src/lib/ipc.ts`
- Modify: `shell-frontend/src/builtin-apps/mail-manager/AccountDialog.tsx`
- Modify: `shell-frontend/tests/mail-manager/AccountDialog.test.tsx`

**Interfaces:**
- Produces: `ipc.loadMailAccountSecret(id: string): Promise<string>`。
- Produces: `ipc.testMailAccountConnection(request: SaveMailAccountRequest): Promise<void>`。
- `AccountDialog` 新 props：`account?: MailAccount | null`；`account === null` 表示新增账户。
- `AccountDialog` 在编辑时默认不读取凭据；点击眼睛后调用 `loadMailAccountSecret(account.id)`，成功后将 `secret` 填入表单并显示明文。

- [x] **Step 1: 写失败的弹窗行为测试**

扩展 `AccountDialog.test.tsx` 的 IPC mock，并渲染一个 `account`。断言弹窗出现“编辑邮箱账户”，`loadMailAccountSecret` 使用账户 ID 调用；等待秘密返回后断言密码输入框有该值。再点击“测试连接”，断言 `testMailAccountConnection` 收到当前表单且 `saveMailAccount` 未被调用。

```tsx
expect(mockLoadMailAccountSecret).toHaveBeenCalledWith('account-1');
expect(await screen.findByDisplayValue('saved-secret')).toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: '测试连接' }));
await waitFor(() => {
  expect(mockTestMailAccountConnection).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'account-1', secret: 'saved-secret' })
  );
});
expect(mockSaveMailAccount).not.toHaveBeenCalled();
```

- [x] **Step 2: 运行失败测试**

Run: `npm test -- --run tests/mail-manager/AccountDialog.test.tsx`

Expected: FAIL，因为编辑 props 和新 IPC 方法尚不存在。

- [x] **Step 3: 实现弹窗编辑和测试连接**

在 `ipc.ts` 增加两条类型明确的调用。`AccountDialog` 接收可选账户，在打开编辑弹窗时将账户字段复制进 `SaveMailAccountRequest` 并异步加载秘密；加载期间禁用“保存”和“测试连接”，显示“正在通过 macOS 身份验证读取凭据”。新增 `testing` 状态和 outline 类型的“测试连接”按钮；成功 toast 为“IMAP 连接成功”，失败 toast 为“连接测试失败”。

新增时沿用当前预设初始化，编辑时不重新套用预设。保存成功后清空表单并关闭；认证读取失败时保留弹窗和非敏感字段，不显示或记录秘密。

- [x] **Step 4: 运行弹窗测试和前端检查**

Run: `npm test -- --run tests/mail-manager/AccountDialog.test.tsx && npm run lint && npm run build`

Expected: PASS。

### Task 3: 在账户树提供右键编辑入口

**Files:**
- Modify: `shell-frontend/src/builtin-apps/mail-manager/MailManagerPage.tsx`
- Modify: `shell-frontend/tests/mail-manager/MailManagerPage.test.tsx`

**Interfaces:**
- Consumes: `AccountDialog` 的 `account` prop。
- Produces: 账户行的 `ContextMenu`，菜单项名称固定为“编辑账户”。

- [x] **Step 1: 写失败的右键菜单测试**

在 `MailManagerPage.test.tsx` 对账户显示名称触发 `contextMenu`，等待并点击“编辑账户”，断言出现“编辑邮箱账户”。为 IPC mock 增加 `loadMailAccountSecret` 并返回测试秘密。

```tsx
fireEvent.contextMenu(screen.getByText('腾讯企业邮箱'));
fireEvent.click(await screen.findByRole('menuitem', { name: '编辑账户' }));
expect(await screen.findByRole('heading', { name: '编辑邮箱账户' })).toBeInTheDocument();
```

- [x] **Step 2: 运行失败测试**

Run: `npm test -- --run tests/mail-manager/MailManagerPage.test.tsx`

Expected: FAIL，因为账户行尚未提供 `ContextMenu` 和编辑状态。

- [x] **Step 3: 实现右键菜单与编辑状态**

从 lucide-react 导入 `Pencil`，从现有 UI 原语导入 `ContextMenu`、`ContextMenuContent`、`ContextMenuItem`、`ContextMenuTrigger`。为每个账户卡片包裹右键菜单，选择菜单项后设置 `editingAccount` 并打开弹窗。新增账户入口清空 `editingAccount`；弹窗关闭后清空该状态。账户内容和错误展示保持不变。

- [x] **Step 4: 运行页面测试**

Run: `npm test -- --run tests/mail-manager/MailManagerPage.test.tsx`

Expected: PASS。

### Task 4: 更新设计文档并完成验证

**Files:**
- Modify: `docs/superpowers/specs/2026-08-08-mail-account-connection-design.md`

- [x] **Step 1: 同步最终接口名称**

在设计文档“接口与数据流”中确认最终命令名为 `load_mail_account_secret` 与 `test_mail_account_connection`，并标注编辑入口是账户右键菜单。

- [x] **Step 2: 运行完整验证**

Run: `cargo test --manifest-path shell-native/Cargo.toml && npm run lint && npm run build && npm test`

Working directory for npm commands: `shell-frontend`

Expected: Rust 与前端测试全部通过。记录已有 DevTools `act(...)` 和 CodeMirror/jsdom 警告，但不修改无关模块。

- [ ] **Step 3: 人工验收**

启动 aIdea，进入“邮件管理”。右键一个账户，选择“编辑账户”；完成 Touch ID 后确认密码显示。点击“测试连接”确认成功提示；把密码临时改错后再次测试，确认显示 IMAP 登录失败且弹窗不关闭；恢复密码并保存后点击刷新，确认账户错误消失。
