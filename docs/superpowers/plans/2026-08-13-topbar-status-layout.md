# Topbar Status Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将官方应用运行状态显示在顶部标签最右侧，激活与非激活标签始终可见。

**Architecture:** 保留 Rust `ProcessManager` 和 `useProcessStatus` 的现有状态来源。`AppIcon` 只渲染应用图标；顶部标签在名称后加入固定宽度的状态图形，复用已有状态文字和图形语义。

**Tech Stack:** React、TypeScript、Tailwind CSS、Vitest、Testing Library、lucide-react。

## Global Constraints

- 只修改顶部标签布局；应用管理页不改。
- 不新增依赖、状态类型、IPC 或后端接口。
- 官方应用显示状态位，内置应用不显示。
- 状态位固定宽度，状态变化不得导致标签文字位置跳动。
- 不自动 git add、commit 或 push。

---

### Task 1: 顶部状态回归测试

**Files:**
- Modify: `shell-frontend/tests/components/TopBar.test.tsx`

**Interfaces:**
- Consumes: `TopBar` 的 `apps`、`states`、`appOrder` props。
- Produces: 顶部运行状态位置与内置应用无状态位的回归覆盖。

- [ ] **Step 1: 写失败测试**

```tsx
it('官方应用在标签最右侧显示运行状态，内置应用不显示状态位', () => {
  render(<TopBar apps={[builtinApp, officialApp]} states={{ official: { id: 'official', status: 'running', pid: 1 } }} {...props} />);

  expect(screen.getByLabelText('官方应用：运行中')).toHaveClass('ml-auto');
  expect(screen.queryByLabelText('内置应用：已停止')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd shell-frontend && npm test -- tests/components/TopBar.test.tsx`

Expected: FAIL，因为状态仍嵌在 `AppIcon` 中，标签右侧没有状态位。

- [ ] **Step 3: 最小实现**

在 `AppIcon.tsx` 删除顶部角标；在 `TopBar.tsx` 名称后渲染官方应用状态位，使用 `ml-auto` 和固定宽度保持对齐。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd shell-frontend && npm test -- tests/components/TopBar.test.tsx`

Expected: PASS。

### Task 2: 全量验证

**Files:**
- Modify: `shell-frontend/src/components/AppIcon.tsx`
- Modify: `shell-frontend/src/components/TopBar.tsx`
- Test: `shell-frontend/tests/components/TopBar.test.tsx`

**Interfaces:**
- Consumes: `AppState` 的现有状态联合类型和 `app.process`。
- Produces: 不影响应用管理页状态展示的顶部标签布局。

- [ ] **Step 1: 执行代码质量检查**

Run: `cd shell-frontend && npm run lint && npm test && npm run build`

Expected: 全部通过；构建如保留既有体积提示，记录但不处理。

- [ ] **Step 2: 检查改动范围**

Run: `git diff --check && git diff --stat`

Expected: 仅包含顶部状态布局、测试和本设计/计划文档的改动。
