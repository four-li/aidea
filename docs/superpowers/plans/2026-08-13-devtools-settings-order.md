# DevTools 设置排序 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** 将 DevTools 设置页改为可拖拽排序的卡片列表，并把排序持久化到 DevTools 自己的 `app.db`，让顶部工具 Tab 使用相同顺序。

**Architecture:** 继续使用现有 `dev_tools_settings` 表中的 JSON 字段，不新增表或依赖。`tabs.ts` 提供默认元数据和一个纯顺序规范化函数；设置页负责卡片排序、显隐保存与失败回滚，主页面负责读取规范化顺序后渲染可见 Tab。Rust 只扩展 Serde 数据结构并保持旧 JSON 兼容。

**Tech Stack:** React 18、TypeScript、Vitest、Testing Library、shadcn/ui、`@dnd-kit/core`、`@dnd-kit/sortable`、Rust、Serde、rusqlite。

## Global Constraints

- 只修改完成本需求所必需的文件，保留工作区已有的无关修改。
- 不新增数据库表、迁移、依赖、通用拖拽组件或未来扩展抽象。
- 拖拽使用现有 `@dnd-kit`，手柄启动、激活距离 `8px`、拖拽中透明度 `0.5`，支持键盘排序。
- 旧配置没有 `tab_order` 时使用默认顺序；未知 ID 忽略，重复 ID 去重，新工具追加到默认顺序末尾；隐藏工具仍参与排序。
- 至少保留一个可见工具；保存失败必须恢复操作前状态并提示错误。
- 重要代码注释使用中文；UI 必须复用现有 shadcn 组件并兼容浅色/深色主题。
- 用户可见功能变化需将 `apps/builtin/dev-tools.yaml` 从 `0.3.2` 升级到 `0.3.3`。
- 不执行 `git add`、commit、push 或创建 PR。

---

### Task 1: 前端顺序模型与 Rust 设置契约

**Files:**
- Modify: `shell-frontend/src/types/dev-tools.ts`
- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs.ts`
- Modify: `shell-native/src/commands/dev_tools.rs`
- Test: `shell-native/src/commands/dev_tools.rs` 内现有测试模块

**Interfaces:**
- Produces `normalizeDevToolsTabOrder(order: readonly string[]): DevToolsTab[]`，按已注册工具默认顺序规范化。
- `DevToolsSettings` 增加 `tab_order: string[]`；Rust 对应字段为 `Vec<String>`，缺失字段默认空数组。

- [ ] **Step 1: Write the failing tests**

在 Rust 现有测试中增加：顺序可以保存并读回、旧 JSON 缺少 `tab_order` 时读取为空数组、顺序中的空字符串和控制字符被拒绝。前端后续页面测试会覆盖规范化行为。

- [ ] **Step 2: Run the focused Rust test to verify it fails**

Run: `cd shell-native && cargo test commands::dev_tools::tests -- --nocapture`

Expected: 新增顺序字段相关断言因 `DevToolsSettings` 没有 `tab_order` 或 JSON 契约未支持而失败。

- [ ] **Step 3: Implement the minimal contract**

在 TypeScript 类型和 Rust 结构体增加 `tab_order`，Rust 保存/读取继续使用同一 `hidden_tabs` JSON 列；扩展校验遍历顺序 ID。`tabs.ts` 增加顺序规范化逻辑：先取已知 ID 的第一次出现，再按默认列表追加缺失工具。

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `cd shell-native && cargo test commands::dev_tools::tests -- --nocapture`

Expected: 相关 Rust 测试全部通过；同时运行 `cd shell-frontend && npm test -- --run tests/dev-tools`，此时既有页面测试应通过或只因新字段 mock 尚未补齐而暴露明确测试缺口。

### Task 2: DevTools 设置页卡片拖拽排序

**Files:**
- Modify: `shell-frontend/src/builtin-apps/dev-tools/DevToolsSettingsPage.tsx`
- Modify: `shell-frontend/tests/dev-tools/DevToolsSettingsPage.test.tsx`

**Interfaces:**
- Consumes `normalizeDevToolsTabOrder` 与 `DevToolsSettings`。
- Saves `{ hidden_tabs: string[], tab_order: string[] }` through `ipc.saveDevToolsSettings`。

- [ ] **Step 1: Write the failing tests**

覆盖以下行为：旧配置按默认顺序渲染、持久化顺序按配置渲染、隐藏工具仍在卡片列表中且未选中、拖拽结束保存完整的显隐和顺序、排序保存失败恢复原顺序并提示错误、至少保留一个可见工具。拖拽测试通过 `@dnd-kit` 的真实手柄事件；若 jsdom 不能完成指针流程，直接调用页面暴露的排序交互所产生的 DOM 事件并断言保存契约，不引入新的拖拽 mock 库。

- [ ] **Step 2: Run the focused frontend tests to verify they fail**

Run: `cd shell-frontend && npm test -- --run tests/dev-tools/DevToolsSettingsPage.test.tsx`

Expected: 新增顺序渲染和保存断言失败，因为当前页面仍是原生分隔行且只保存 `hidden_tabs`。

- [ ] **Step 3: Implement the minimal card list**

使用 `DndContext`、`SortableContext`、`useSortable`、`arrayMove`、`PointerSensor` 和 `KeyboardSensor`。卡片左侧只让 `GripVertical` 手柄绑定 listeners，卡片使用主题 token；Checkbox 继续负责显隐。排序或显隐保存时传完整设置，失败时恢复对应操作前状态并调用 `toast.error`。保留 `onSaved`，改为传完整设置中的隐藏列表以兼容现有调用边界。

- [ ] **Step 4: Run the focused frontend tests to verify they pass**

Run: `cd shell-frontend && npm test -- --run tests/dev-tools/DevToolsSettingsPage.test.tsx`

Expected: 设置页测试全部通过。

### Task 3: 顶部工具 Tab 使用持久化顺序

**Files:**
- Modify: `shell-frontend/src/builtin-apps/dev-tools/index.tsx`
- Modify: `shell-frontend/tests/dev-tools/DevToolsPage.test.tsx`

**Interfaces:**
- Consumes `normalizeDevToolsTabOrder` 与 `DevToolsSettings.tab_order`。
- Produces ordered visible tabs for both triggers and content fallback selection。

- [ ] **Step 1: Write the failing tests**

增加带 `tab_order: ['ai', 'data', 'timestamp', 'ip']` 时顶部 Tab 按 AI、JSON、时间戳顺序渲染的测试；增加未知/重复/新增工具配置仍能得到完整合理顺序的测试，并保留隐藏工具不显示的断言。

- [ ] **Step 2: Run the focused frontend tests to verify they fail**

Run: `cd shell-frontend && npm test -- --run tests/dev-tools/DevToolsPage.test.tsx`

Expected: 持久化顺序测试失败，当前页面总是使用 `DEV_TOOLS_TABS` 默认顺序。

- [ ] **Step 3: Implement ordered rendering**

加载设置时同时保存 `tab_order`，通过规范化结果过滤 `hidden_tabs`；当前 Tab 被隐藏时切换到第一个可见工具，异常情况下保留默认第一个工具兜底。内容区继续按固定已注册工具条件渲染，避免改变工具业务页面。

- [ ] **Step 4: Run the focused frontend tests to verify they pass**

Run: `cd shell-frontend && npm test -- --run tests/dev-tools/DevToolsPage.test.tsx tests/dev-tools/DevToolsSettingsPage.test.tsx`

Expected: 两个 DevTools 测试文件全部通过。

### Task 4: 版本与完整验证

**Files:**
- Modify: `apps/builtin/dev-tools.yaml`

- [ ] **Step 1: Update the manifest version**

将 `version: 0.3.2` 改为 `version: 0.3.3`，因为设置页交互和持久化数据格式对用户可见。

- [ ] **Step 2: Run frontend lint, tests, and build**

Run: `cd shell-frontend && npm run lint && npm test && npm run build`

Expected: lint、全部前端测试和生产构建均以退出码 0 完成。

- [ ] **Step 3: Run native tests and diff validation**

Run: `cd shell-native && cargo test`; then `git diff --check`.

Expected: Rust 测试通过，`git diff --check` 无输出且退出码为 0。

- [ ] **Step 4: Inspect the final diff**

Run: `git status --short && git diff --stat && git diff -- apps/builtin/dev-tools.yaml shell-frontend/src/builtin-apps/dev-tools shell-frontend/src/types/dev-tools.ts shell-native/src/commands/dev_tools.rs`

确认只包含本需求修改和原有工作区修改，没有自动暂存、提交、推送或 PR 操作。
