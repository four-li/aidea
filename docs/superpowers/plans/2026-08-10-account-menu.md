# 顶部账户菜单 Implementation Plan

> **历史实施记录**：本文件只记录当时实现，不是当前平台契约。当前规则以仓库根目录 `AGENTS.md` 和 `docs/guide/` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将设置入口放在顶部右侧账户菜单，并增加 macOS 顶部“设置”菜单入口。

**Architecture:** Rust 通过一个最小 IPC 返回当前账户短用户名；React 在顶部栏放置账户菜单组件，复用现有设置弹窗回调。Tauri 菜单事件与现有检查更新事件保持同一事件转发模式。

**Tech Stack:** Tauri 2、Rust、React、TypeScript、Radix DropdownMenu、lucide-react、Vitest。

## Global Constraints

- 不新增依赖；复用现有 shadcn/ui、DropdownMenu 和 lucide-react。
- 账户菜单必须兼容浅色和深色主题。
- `invoke` 只能通过 `shell-frontend/src/lib/ipc.ts` 封装。
- 不自动 commit 或 push。

### Task 1: 用户名 IPC

**Files:**
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Test: `shell-native/src/commands/shell.rs` 内测试

- [ ] **Step 1: 添加 Rust 测试**

测试用户名读取函数返回非空短用户名，并保持 `AppResult<String>` 接口。

- [ ] **Step 2: 实现命令并注册**

使用 Rust 标准库 `std::env::var("USER")`，为空或读取失败返回 `AppError`；注册 `get_os_username` Tauri 命令和前端 IPC 封装。

- [ ] **Step 3: 运行 Rust 测试**

运行 `cargo test --manifest-path shell-native/Cargo.toml commands::shell::tests`，预期通过。

### Task 2: 顶部账户菜单

**Files:**
- Create: `shell-frontend/src/components/AccountMenu.tsx`
- Modify: `shell-frontend/src/components/TopBar.tsx`
- Modify: `shell-frontend/src/App.tsx`
- Test: `shell-frontend/tests/components/AccountMenu.test.tsx`

- [ ] **Step 1: 写菜单行为测试**

覆盖用户名显示、点击“设置”调用打开回调、“报告问题”存在且 disabled。

- [ ] **Step 2: 实现最小组件**

使用 `DropdownMenuTrigger` 作为用户名/齿轮按钮，菜单项使用 `DropdownMenuItem disabled`；加载中显示“账户”，读取失败显示“未知用户”。

- [ ] **Step 3: 调整页面布局**

`TopBar` 右侧放置 `AccountMenu`；主内容不增加底部栏，保持原有可用空间。

- [ ] **Step 4: 运行前端组件测试**

运行 `npm test --prefix shell-frontend -- AccountMenu.test.tsx`，预期通过。

### Task 3: macOS 顶部设置菜单

**Files:**
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-frontend/src/App.tsx`
- Test: `shell-frontend/tests/components/App.test.tsx`（若现有测试可注入 Tauri 事件）

- [ ] **Step 1: 新增 Tauri 菜单项**

在 aIdea 子菜单中加入 `settings-aidea`，与检查更新并列。

- [ ] **Step 2: 转发设置事件**

菜单点击时发出 `aidea:open-settings`；前端监听后将 `showSettings` 置为 `true`。

- [ ] **Step 3: 运行闭环验证**

运行 `npm test --prefix shell-frontend`、`npm run lint --prefix shell-frontend`、`npm run build --prefix shell-frontend`、`cargo test --manifest-path shell-native/Cargo.toml` 和 `git diff --check`。
