# 官方应用启动失败重试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让官方应用启动失败后仍可在原菜单重试启动，同时明确不接管开发目录的手动服务。

**Architecture:** 保持 Rust 生命周期和既有 `ipc.startApp()` 不变。前端根据已停止、非过渡和是否存在 `issue` 决定显示“启动”或“重试启动”；两种操作复用同一个启动调用。平台文档补充重试和安装目录接管边界。

**Tech Stack:** React、TypeScript、Vitest、Rust、Markdown。

## Global Constraints

- 不新增 IPC、状态类型、依赖、开发模式或进程接管规则。
- `issue` 在下次启动成功前保留；成功后由既有 Rust `start_app` 清除。
- 仅接管工作目录属于已安装 `source/` 且 `/health` 成功的进程。
- 不自动 git add、commit、push 或创建 PR。

---

### Task 1: 应用管理菜单重试

**Files:**
- Modify: `shell-frontend/tests/components/AppManagementPage.test.tsx`
- Modify: `shell-frontend/src/components/AppManagementPage.tsx:427-456`

**Interfaces:**
- Consumes: `AppState.status`、`AppState.issue`、既有 `controlProcess(app, 'start')`。
- Produces: 已停止且存在异常时的“重试启动”菜单项。

- [ ] **Step 1: 写失败测试**

在 `AppManagementPage.test.tsx` 添加测试，提供停止状态及端口占用异常，打开“更多操作”菜单后断言：

```tsx
expect(await screen.findByRole('menuitem', { name: '重试启动' })).toBeInTheDocument();
expect(screen.queryByRole('menuitem', { name: '启动' })).not.toBeInTheDocument();
```

点击该菜单项并断言：

```tsx
await waitFor(() => expect(mockStartApp).toHaveBeenCalledWith('official-mail'));
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd shell-frontend && npm test -- AppManagementPage.test.tsx`

Expected: 失败，因为当前异常状态不显示启动入口。

- [ ] **Step 3: 写最小实现**

将应用管理菜单的已停止判断改为始终可启动，文案根据异常选择：

```tsx
{!running && !transitioning && (
  <DropdownMenuItem onSelect={() => void controlProcess(app, 'start')}>
    <Play size={16} />
    {issue ? '重试启动' : '启动'}
  </DropdownMenuItem>
)}
```

已运行的停止、重启操作不以 `issue` 为条件隐藏。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd shell-frontend && npm test -- AppManagementPage.test.tsx`

Expected: PASS。

### Task 2: 顶部右键菜单重试

**Files:**
- Create: `shell-frontend/tests/components/AppContextMenu.test.tsx`
- Modify: `shell-frontend/src/components/AppContextMenu.tsx:24-79`

**Interfaces:**
- Consumes: `AppManifest.issue`、`AppState.status`、既有 `ipc.startApp(app.id)`。
- Produces: 与应用管理一致的“启动”或“重试启动”菜单文案。

- [ ] **Step 1: 写失败测试**

渲染 `AppContextMenu`，提供 `app.issue` 和 `state.status: 'stopped'`，触发右键菜单，断言：

```tsx
expect(await screen.findByRole('menuitem', { name: '重试启动' })).toBeInTheDocument();
fireEvent.click(screen.getByRole('menuitem', { name: '重试启动' }));
await waitFor(() => expect(mockStartApp).toHaveBeenCalledWith('official-mail'));
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd shell-frontend && npm test -- AppContextMenu.test.tsx`

Expected: 失败，因为当前菜单始终显示“启动”。

- [ ] **Step 3: 写最小实现**

读取 `const hasIssue = !!(app.issue ?? state?.issue)`，并只改停止状态菜单文案：

```tsx
<ContextMenuItem onClick={handleStart}>{hasIssue ? '重试启动' : '启动'}</ContextMenuItem>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd shell-frontend && npm test -- AppContextMenu.test.tsx`

Expected: PASS。

### Task 3: 平台约定与完整验证

**Files:**
- Modify: `docs/guide/aidea-platform.md:46`
- Modify: `docs/guide/aidea-official-app.md:104-110`

**Interfaces:**
- Consumes: 当前 `ProcessManager::adoptable_process` 实现。
- Produces: 与实现一致的启动重试和接管范围说明。

- [ ] **Step 1: 更新规范**

在平台异常隔离章节明确：失败不会锁死生命周期操作；已停止应用可重试，异常在成功前保留。官方应用规范明确：仅接管安装 `source/` 内且 `/health` 成功的监听进程，开发目录手动服务不接管。

- [ ] **Step 2: 运行前端验证**

Run:

```bash
cd shell-frontend && npm run lint && npm test && npm run build
```

Expected: 全部通过。

- [ ] **Step 3: 运行 Rust 验证**

Run: `cd shell-native && cargo test`

Expected: 全部通过；若沙箱禁止本地端口绑定，按授权方式在受限环境外重跑。

- [ ] **Step 4: 检查差异**

Run: `git diff --check`

Expected: 无空白错误。
