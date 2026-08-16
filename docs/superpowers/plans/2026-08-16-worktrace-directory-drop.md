# Worktrace Directory Drop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户将 Finder 中的本地项目目录拖入当前激活的 Worktrace 添加项目弹窗，并继续由 Worktrace 验证 Git。

**Architecture:** 原生 aIdea 窗口取得一个目录绝对路径后，以内部事件交给壳前端。壳前端只把该路径经 App Bridge 定向交给当前激活、已连接并声明 `directory-drop` 能力的 Worktrace iframe；Worktrace 复用既有目录校验接口。

**Tech Stack:** Tauri 2、Rust、React、TypeScript strict、Vitest、浏览器 `postMessage`。

**Spec:** `docs/guide/aidea-app-bridge.md`

## Global Constraints

- 官方应用不得使用 Tauri IPC；壳与官方应用只通过明确 `targetOrigin` 的 App Bridge `postMessage` 通信。
- 只接受一个存在的绝对目录；aIdea 不检查 Git，不记录路径，不广播给其他应用。
- 只向当前激活、已 `ready` 且声明 `directory-drop` 的 Worktrace iframe 发送路径。
- Worktrace 嵌入 aIdea 时，浏览器 drop 读不到路径不提示失败；独立浏览器保持现有降级提示。
- 不新增依赖，不自动 `git add`、commit、push 或创建 PR。

---

### Task 1: 同步通信契约

**Files:**
- Modify: `docs/guide/aidea-app-bridge.md`
- Modify: `docs/guide/aidea-platform.md`
- Modify: `docs/postMessage.md`

- [x] 定义 `directory:drop` 的 `{ path }` payload、能力名 `directory-drop`、定向发送与路径隐私边界。

### Task 2: 原生目录事件

**Files:**
- Modify: `shell-native/src/lib.rs`
- Test: `shell-native/src/lib.rs`

- [x] 写失败测试：仅单个、存在、绝对目录可被转换为内部事件路径。
- [x] 在 Tauri 窗口的 `DragDropEvent::Drop` 中发送 `aidea:directory-dropped`，payload 为 `{ path }`。
- [ ] 运行 `cargo test`、`cargo fmt --check` 与 `cargo clippy -- -D warnings`。`cargo clippy` 被既有未修改文件中的 9 项告警阻断。

### Task 3: 壳端定向桥接

**Files:**
- Modify: `shell-frontend/src/hooks/useAppBridge.ts`
- Modify: `shell-frontend/src/App.tsx`
- Test: `shell-frontend/tests/useAppBridge.test.tsx`

- [x] 写失败测试：未连接、未声明能力或错误应用不能收到 `directory:drop`；合法 Worktrace 收到定向信封。
- [x] `useAppBridge` 仅暴露定向到 Worktrace 的 `deliverDirectoryDrop(path)`；App 只在 `activeAppId === 'worktrace'` 时转发原生事件。
- [x] 运行 `npm run lint`、`npm test` 与 `npm run build`。

### Task 4: Worktrace 接收与校验

**Files:**
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/worktrace/web/src/lib/aideaBridge.ts`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/worktrace/web/src/main.tsx`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/worktrace/web/src/App.tsx`
- Test: `/Users/fourli/Desktop/app/aidea-plugins/worktrace/web/src/App.test.tsx`

- [x] 写失败测试：合法 `directory:drop` 在打开的添加项目弹窗中请求既有 `/projects/validate-directory`；嵌入壳时无路径的浏览器 drop 不弹错误。
- [x] Worktrace 在 `ready` 中声明 `directory-drop`，严格校验壳消息后将路径交给已打开的添加项目弹窗，并复用 `selectPath(path)`。
- [x] 运行 `npm test` 与 `npm run build`。

### Task 5: 集成验收

**Files:**
- Modify: `docs/postMessage.md`

- [x] 更新使用清单为“已实现”。
- [ ] 用 aIdea 打开 Worktrace，在浅色、深色和 390px 宽视口检查添加弹窗；拖入 Git 与非 Git 目录，确认前者可验证、后者不可保存且没有控制台错误。
- [x] 在两个仓库分别运行 `git diff --check`。
