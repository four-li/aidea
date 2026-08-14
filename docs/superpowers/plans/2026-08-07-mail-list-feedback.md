# 邮件列表反馈 Implementation Plan

> **历史记录，禁止作为当前实现或发布步骤执行。** 本文件描述旧内置邮件实现，不是当前平台或邮件应用契约。新邮件应用以 `mail-center` 官方应用规范为准；规则以仓库根目录 `AGENTS.md` 和 `docs/guide/` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将邮件列表默认页缩小为 30 封，显示匹配总数，并让邮件详情的加载与切换更连续。

**Architecture:** Rust 的邮件列表查询改为返回 `MailMessagePage { items, total }`，使用相同的 SQLite 筛选条件分别读取分页数据和总数。React 保持现有三栏页面，在详情请求期间显示加载状态，并在新详情进入 DOM 时复用 Tailwind 已提供的淡入动画。

**Tech Stack:** Rust、rusqlite、Tauri 2、React 18、TypeScript、Tailwind CSS、Vitest。

## Global Constraints

- 默认和“加载更多”页大小均为 30；数据库仍限制单页最大 200。
- 总数仅统计本地已同步元数据，不能触发 IMAP、下载正文或改变同步状态。
- 不新增依赖；不执行 `git add`、`git commit`、push 或 PR。
- 保持现有邮件 iframe 的 `sandbox` 和正文清理路径不变。

---

### Task 1: 返回带总数的邮件分页结果

**Files:**
- Modify: `shell-native/src/mail_store.rs`
- Modify: `shell-native/src/commands/mail.rs`
- Modify: `shell-frontend/src/types/mail.ts`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Test: `shell-native/tests/mail_store_test.rs`

**Interfaces:**
- Produces `MailMessagePage { items: Vec<MailMessageSummary>, total: i64 }`.
- `MailStore::list_messages(MessageQuery) -> AppResult<MailMessagePage>`.
- `list_mail_messages(query) -> AppResult<MailMessagePage>`.

- [x] **Step 1: 写失败测试**

在已有三封按时间排序的邮件数据上，以 `limit: Some(2)`、`offset: Some(1)` 查询，断言 `items` 是“邮件 2、邮件 1”且 `total == 3`：

```rust
assert_eq!(page.total, 3);
assert_eq!(page.items.len(), 2);
assert_eq!(page.items[0].subject, "邮件 2");
```

- [x] **Step 2: 运行失败测试**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_store_test 邮件列表按页返回最新邮件`

Expected: FAIL，因为现有列表结果没有 `items` 和 `total`。

- [x] **Step 3: 实现同条件的分页与总数查询**

新增可序列化 `MailMessagePage`。在 `list_messages` 中复用账户、文件夹、关键词三个已规范化参数：先执行 `COUNT(*)` 得到 `total`，再执行已有排序和 `LIMIT/OFFSET` 查询得到 `items`。命令和 TypeScript IPC 同步改为该结果类型。

- [x] **Step 4: 运行测试确认通过**

Run: `cargo test --manifest-path shell-native/Cargo.toml --test mail_store_test`

Expected: PASS。

### Task 2: 缩小列表并提供详情反馈

**Files:**
- Modify: `shell-frontend/src/builtin-apps/mail-manager/MailManagerPage.tsx`
- Test: `shell-frontend/tests/mail-manager/MailManagerPage.test.tsx`

**Interfaces:**
- Consumes `MailMessagePage { items, total }` from `ipc.listMailMessages`.
- Produces `MESSAGE_PAGE_SIZE = 30`，并显示 `已显示 {messages.length} / 共 {total} 封`。

- [x] **Step 1: 写失败测试**

mock 邮件列表返回两项和 `total: 3`，渲染页面后断言显示“已显示 2 / 共 3 封”；点击一封邮件后，在 `getMailMessage` 未完成时断言显示“正在加载邮件”，完成后断言邮件主题出现。

```tsx
expect(screen.getByText('已显示 2 / 共 3 封')).toBeInTheDocument();
await user.click(screen.getByRole('button', { name: /告警/ }));
expect(screen.getByText('正在加载邮件')).toBeInTheDocument();
```

- [x] **Step 2: 运行失败测试**

Run: `npm test -- --run tests/mail-manager/MailManagerPage.test.tsx`

Expected: FAIL，因为当前 IPC 返回数组，详情区没有加载状态。

- [x] **Step 3: 实现最小 UI 改动**

将页大小常量改为 30。初次和“加载更多”读取 `page.items`，将 `page.total` 存入状态并使用它判断是否还有更多。列表工具栏显示总数文本。选择邮件时立即设置 `detailLoading`，在 `finally` 清除；加载时显示带 `Loader2` 的文本，成功详情以 `key={selected.id}`、`animate-in fade-in-0 duration-150` 渲染。读取失败保留现有 toast 行为。

- [x] **Step 4: 运行测试确认通过**

Run: `npm test -- --run tests/mail-manager/MailManagerPage.test.tsx`

Expected: PASS。

### Task 3: 全量验证

**Files:**

- [x] **Step 1: 运行 Rust 测试**

Run: `cargo test --manifest-path shell-native/Cargo.toml`

Expected: PASS。

- [x] **Step 2: 运行前端检查**

Run: `npm run lint && npm run build && npm test`（工作目录：`shell-frontend`）

Expected: PASS；记录已有 DevTools `act(...)` 与 CodeMirror/jsdom 警告，不修改无关模块。

- [ ] **Step 3: 人工验收**

启动 `npm run dev`，打开邮件管理。确认初始列表至多 30 封、显示本地总数、加载更多后显示数量增加；点击一封未缓存正文的邮件时先显示“正在加载邮件”，正文出现时无突兀跳变。
