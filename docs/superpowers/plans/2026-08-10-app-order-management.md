# 应用排序入口调整 Implementation Plan

> **历史实施记录**：本文件只记录当时实现，不是当前平台契约。当前规则以仓库根目录 `AGENTS.md` 和 `docs/guide/` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将应用排序从顶部菜单移动到应用管理列表。

**Architecture:** `App.tsx` 继续拥有顺序状态和 localStorage 持久化；`TopBar` 只消费顺序；`AppManagementPage` 使用已有 `@dnd-kit` 组件能力完成排序并回调更新顺序。

**Tech Stack:** React 18、TypeScript、`@dnd-kit/core`、`@dnd-kit/sortable`、Vitest。

## Global Constraints

- 只做本次交互迁移，不新增 IPC、数据库或依赖。
- 保留现有双列应用卡片布局。
- 只触碰本需求涉及的组件和测试。

### Task 1: 移动排序入口

**Files:**
- Modify: `shell-frontend/src/components/TopBar.tsx`
- Modify: `shell-frontend/src/components/AppManagementPage.tsx`
- Modify: `shell-frontend/src/App.tsx`
- Modify: `shell-frontend/src/components/SortableAppIcon.tsx`（如复用范围需要）

- [ ] 移除顶部 DnD 上下文和排序回调。
- [ ] 在管理页用同一顺序数组排序应用卡片，增加带无障碍名称的拖拽手柄。
- [ ] 通过 `DndContext` 和 `SortableContext` 在管理页更新顺序。

### Task 2: 更新验证

**Files:**
- Modify: `shell-frontend/tests/components/TopBar.test.tsx`
- Modify: `shell-frontend/tests/components/AppManagementPage.test.tsx`

- [ ] 调整组件 props 测试。
- [ ] 增加排序列表渲染和拖拽入口断言。
- [ ] 运行 `cd shell-frontend && npm run lint && npm test && npm run build`。
