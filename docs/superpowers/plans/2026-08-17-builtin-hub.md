# 开搞中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI Service、DevTools 等内置应用收拢到顶部唯一的“开搞中心”入口，并在其中用窄图标栏切换独立内置应用。

**Architecture:** 壳增加两个 UI 状态：是否显示开搞中心，以及当前选中的内置应用 ID。顶部只负责在开搞中心与官方应用之间切换；新增的 `BuiltinHubPage` 只负责筛选 manifest、显示图标栏和挂载 `BuiltinPage`，不创建伪应用、不解析业务菜单。AI Service 与 DevTools 继续各自维护页面、IPC、数据和内部菜单。

**Tech Stack:** React、TypeScript、Tailwind、现有 shadcn/ui、lucide-react、Vitest、Tauri manifest。

**Spec:** `docs/superpowers/specs/2026-08-17-builtin-hub-design.md`

## Global Constraints

- 顶部入口名称固定为“开搞中心”；开搞中心不是 manifest、数据库或业务应用。
- 开搞中心应用栏只展示 `ui.mode: builtin` 且不是 `ui.entry: account-menu` 的 manifest；默认选中 `ai-service`，其他应用按 manifest 顺序追加。
- 应用栏宽度保持约 56-64px；图标必须来自 `lucide-react`，按钮必须有 `aria-label` 和 Tooltip，选中态不能只依赖颜色。
- 开搞中心不定义应用内部菜单协议，不新增 URL 路由、全局业务导航、跨应用状态持久化或自动发现机制。
- 开发手册继续从右上角设置按钮组进入，不显示在开搞中心应用栏。
- 应用管理页不再显示内置应用卡片或内置业务设置入口；官方应用安装、更新、启停、日志和卸载行为保持不变。
- 复用现有 shadcn/ui、主题 token 和测试工具；不引入新的组件库或未来功能占位。
- 遵守仓库约定：不自动 `git add`、commit、push 或创建 PR；修改后按范围运行前端 lint、测试和构建。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `shell-frontend/src/App.tsx` | 持有开搞中心显示状态和当前内置应用选择，处理顶部切换与返回逻辑。 |
| `shell-frontend/src/components/TopBar.tsx` | 顶部显示“开搞中心”和官方应用标签，过滤普通内置应用。 |
| `shell-frontend/src/components/ContentArea.tsx` | 在开搞中心模式挂载 `BuiltinHubPage`，保持官方 webview 的原有挂载策略。 |
| `shell-frontend/src/components/BuiltinHubPage.tsx` | 窄图标栏、Tooltip、焦点和当前内置应用内容挂载。 |
| `shell-frontend/src/components/BuiltinPage.tsx` | 继续按内置应用 ID 显式渲染 AI Service、DevTools 等入口；只补充 hub 需要的 props。 |
| `shell-frontend/src/components/AppManagementPage.tsx` | 移除内置应用卡片、排序和内置设置详情分支，只保留官方应用管理。 |
| `shell-frontend/src/components/SettingsPanel.tsx` | 保持设置中的开发手册入口和应用管理入口，不把开发手册移入 hub。 |
| `shell-frontend/src/builtin-apps/dev-tools/index.tsx` | 在 DevTools 自己的页面提供工具设置入口，复用现有 `DevToolsSettingsPage`。 |
| `shell-frontend/src/builtin-apps/settings.tsx` | 删除不再由应用管理使用的内置设置注册表；若仍有通用调用，仅保留必要映射。 |
| `shell-frontend/tests/components/BuiltinHubPage.test.tsx` | 验证筛选、默认应用、切换、Tooltip/无障碍和窄栏布局标记。 |
| `shell-frontend/tests/components/TopBar.test.tsx` | 验证顶部只显示 hub 和官方应用，内置应用不再出现标签。 |
| `shell-frontend/tests/App.test.tsx` | 验证进入/离开 hub、默认 ai-service、官方应用切换和目录拖入行为不回归。 |
| `shell-frontend/tests/components/AppManagementPage.test.tsx` | 更新断言：内置应用不出现在管理列表，官方应用管理仍可用。 |
| `shell-frontend/tests/dev-tools/DevToolsPage.test.tsx` | 验证 DevTools 内部设置入口可以打开并保留工具 Tabs。 |
| `docs/guide/aidea-builtin-app.md`、`docs/guide/README.md` | 补充“开搞中心是壳级容器、内置应用仍独立”的长期契约和阅读路由。 |

---

## Task 1: 增加壳级开搞中心状态与顶部切换

**Files:**
- Modify: `shell-frontend/src/App.tsx`
- Modify: `shell-frontend/src/components/TopBar.tsx`
- Modify: `shell-frontend/src/components/ContentArea.tsx`

**Interfaces:**
- `App` 产生 `showBuiltinHub: boolean`、`activeBuiltinAppId: string | null`，并传给 `TopBar` 与 `ContentArea`。
- `TopBar` 接收 `showBuiltinHub`、`onOpenBuiltinHub`、`onSelectApp`；普通内置应用不再渲染为顶部标签。
- `ContentArea` 接收 `showBuiltinHub`、`builtinAppId` 和 `onSelectBuiltinApp`，官方应用路径保持现有参数行为。

- [ ] **Step 1: 写顶部过滤与 hub 切换的失败测试**

在 `shell-frontend/tests/components/TopBar.test.tsx` 增加：给出 `dev-tools`（builtin）和 `mail-center`（webview）时，只能找到“开搞中心”和“邮件中心”按钮；点击“开搞中心”调用 `onOpenBuiltinHub`。

在 `shell-frontend/tests/App.test.tsx` 增加：初始应用列表含 `ai-service` 和 `mail-center` 时，点击 hub 入口后 `ContentArea` 收到 `showBuiltinHub=true`、`builtinAppId='ai-service'`；点击官方应用后收到 `showBuiltinHub=false`。

- [ ] **Step 2: 运行失败测试**

Run: `cd shell-frontend && npx vitest run tests/components/TopBar.test.tsx tests/App.test.tsx`

Expected: FAIL，因为 TopBar 和 App 尚无 hub 状态及入口 props。

- [ ] **Step 3: 实现最小壳状态接线**

从 `apps` 中计算可显示内置应用：`ui.mode === 'builtin' && ui.entry !== 'account-menu'`。应用加载后优先选择 `ai-service`，不存在时选择第一个可用内置应用；官方应用仍由 `useActiveApp` 选择。点击普通内置应用时只更新 hub 状态，点击官方应用时关闭 hub 并调用现有 `selectApp`。目录拖入判断继续只看当前 `activeAppId` 为 `worktrace`，不把 hub 状态混入。

TopBar 固定渲染一个带 `aria-label="开搞中心"` 的按钮，再渲染 `ui.mode !== 'builtin'` 的应用标签；保留官方应用状态、右上角设置和开发手册入口。

- [ ] **Step 4: 运行测试**

Run: `cd shell-frontend && npx vitest run tests/components/TopBar.test.tsx tests/App.test.tsx`

Expected: PASS；官方应用状态位、开发手册返回和目录拖入测试仍通过。

---

## Task 2: 实现窄图标栏与内置应用挂载

**Files:**
- Create: `shell-frontend/src/components/BuiltinHubPage.tsx`
- Modify: `shell-frontend/src/components/ContentArea.tsx`
- Modify: `shell-frontend/src/components/BuiltinPage.tsx`
- Create: `shell-frontend/tests/components/BuiltinHubPage.test.tsx`

**Interfaces:**
- `BuiltinHubPageProps`：`apps: AppManifest[]`、`activeAppId: string | null`、`onSelectApp: (id: string) => void`。
- `BuiltinHubPage` 只消费 manifest 的 `id`、`name`、`ui.icon` 和 `ui.entry`，右侧通过 `<BuiltinPage app={activeApp} />` 渲染业务页面。

- [ ] **Step 1: 写图标栏行为测试**

使用 `vi.mock('../../src/components/BuiltinPage')` 渲染三个 manifest（两个普通 builtin、一个 `account-menu`），断言 account-menu 不显示、普通应用按钮有 `aria-label`、默认内容显示当前应用名、点击另一个按钮调用对应 ID。断言应用栏存在稳定宽度 class（`w-14` 或等价固定宽度）和 `TooltipProvider` 所需的按钮可聚焦。

- [ ] **Step 2: 运行失败测试**

Run: `cd shell-frontend && npx vitest run tests/components/BuiltinHubPage.test.tsx`

Expected: FAIL，因为组件文件尚不存在。

- [ ] **Step 3: 实现最小 hub 页面**

使用现有 `AppIcon` 或 manifest 图标解析逻辑渲染窄栏；无法解析图标时复用现有默认图标。按钮使用 shadcn `Button` 的 `variant="ghost"`、`size="icon"`，通过选中背景和左侧边框/标记同时表达当前项。包裹现有 `TooltipProvider`、`Tooltip`，设置 `aria-label` 和 `title` 等可访问名称。右侧区域 `min-w-0 min-h-0 overflow-hidden`，避免 AI Service/DevTools 内部菜单切换时内容重叠。

在 `ContentArea` 中，当 `showBuiltinHub` 为真时渲染 `BuiltinHubPage`；无可用内置应用时显示现有 `EmptyState`。非 hub 模式沿用 webview 全挂载和 builtin/none 分支，不新增路由。

- [ ] **Step 4: 运行组件测试**

Run: `cd shell-frontend && npx vitest run tests/components/BuiltinHubPage.test.tsx tests/components/TopBar.test.tsx tests/dev-tools/DevToolsPage.test.tsx tests/ai-service`

Expected: PASS；AI Service 和 DevTools 的现有内部菜单/页面测试不受外层容器影响。

---

## Task 3: 把内置应用设置收回各自页面

**Files:**
- Modify: `shell-frontend/src/components/AppManagementPage.tsx`
- Modify: `shell-frontend/src/builtin-apps/dev-tools/index.tsx`
- Modify: `shell-frontend/src/builtin-apps/settings.tsx`
- Modify: `shell-frontend/tests/components/AppManagementPage.test.tsx`
- Modify: `shell-frontend/tests/dev-tools/DevToolsPage.test.tsx`

**Interfaces:**
- `AppManagementPage` 只展示和管理官方应用；不调用 `BUILTIN_SETTINGS_PAGES`，不打开 `AppSettingsDetail`。
- `DevToolsPage` 增加自己的设置触发器和局部设置状态，复用现有 `DevToolsSettingsPage`，保存后继续使用 `DEV_TOOLS_SETTINGS_CHANGED` 刷新 Tabs。

- [ ] **Step 1: 写设置归属测试**

更新应用管理测试：mock 返回 builtin 与 official 应用时，页面不出现 builtin 名称或“应用设置”按钮，但官方应用仍显示启动/更新/卸载操作。

在 DevTools 测试中断言页面显示“设置”按钮，点击后渲染 `DevToolsSettingsPage`；关闭后恢复工具 Tabs。

- [ ] **Step 2: 运行失败测试**

Run: `cd shell-frontend && npx vitest run tests/components/AppManagementPage.test.tsx tests/dev-tools/DevToolsPage.test.tsx`

Expected: FAIL，当前应用管理仍渲染所有 manifest，DevTools 页面没有设置入口。

- [ ] **Step 3: 删除管理页内置分支并迁移 DevTools 设置**

在 `AppManagementPage.load` 中过滤 `app.ui.mode !== 'builtin'`；删除内置卡片的设置按钮、`detailApp` 分支和仅用于该分支的 `AppSettingsDetail`/`BUILTIN_SETTINGS_PAGES` 引用。保留排序参数但只用于官方应用，避免改变官方应用顺序行为。

在 `DevToolsPage` 顶部菜单增加带图标和 Tooltip 的设置按钮；点击后在同一页面内容区显示 `DevToolsSettingsPage embedded onClose`，不创建全局设置协议。保存事件沿用现有自定义事件和 `loadSettings`。

- [ ] **Step 4: 运行设置测试**

Run: `cd shell-frontend && npx vitest run tests/components/AppManagementPage.test.tsx tests/dev-tools/DevToolsPage.test.tsx tests/dev-tools/DevToolsSettingsPage.test.tsx`

Expected: PASS；内置设置入口只在对应应用页出现，官方应用管理功能保持通过。

---

## Task 4: 更新开搞中心契约文档

**Files:**
- Modify: `docs/guide/aidea-builtin-app.md`
- Modify: `docs/guide/README.md`

- [ ] **Step 1: 补充长期规则**

在内置应用规范中增加“开搞中心”小节，明确它是壳级导航容器，不是 manifest/应用数据库/业务版本；顶部只显示一个入口；应用栏筛选普通 builtin；内置应用继续独立维护 IPC、数据、设置和内部菜单；开发手册仍由设置按钮进入。

在 README 的核心概念和阅读路由中链接该规则，保证 Agent 先读入口后能找到内置应用与 hub 的边界。不要把 UI 文案复制到多个专题。

- [ ] **Step 2: 检查 Markdown**

Run: `git diff --check && rg -n "aidea-builtin-app\.md|开搞中心|BuiltinHub" docs/guide docs/superpowers/plans/2026-08-17-builtin-hub.md`

Expected: 无空白错误；链接和关键契约名称可检索。

---

## Task 5: 执行前端闭环验证

**Files:**
- No new files; run repository checks against all changed frontend files.

- [ ] **Step 1: 运行 lint**

Run: `cd shell-frontend && npm run lint`

Expected: PASS，无 TypeScript/ESLint 错误。

- [ ] **Step 2: 运行完整前端测试**

Run: `cd shell-frontend && npm test`

Expected: PASS，包含开搞中心、AI Service、DevTools、应用管理和开发手册测试。

- [ ] **Step 3: 运行生产构建**

Run: `cd shell-frontend && npm run build`

Expected: PASS，Markdown raw import、lucide 图标和内置应用 bundle 均能构建。

- [ ] **Step 4: 汇报未覆盖项**

记录未运行的 Rust 测试（本次只改前端与文档时不强制运行）或无法在当前环境验证的浅色/深色/窄窗口视觉项；不得把未验证内容描述成已通过。

