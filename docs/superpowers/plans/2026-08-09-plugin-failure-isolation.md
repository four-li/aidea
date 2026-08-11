# 官方应用异常隔离 Implementation Plan

> **历史实施记录**：本文件只记录当时实现，不是当前平台契约。当前规则以仓库根目录 `AGENTS.md` 和 `docs/guide/` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 单个官方应用的定义、安装记录或进程异常只显示为可恢复的警告，不阻断 aIdea 壳、顶部菜单、应用管理或官方市场。

**Architecture:** 后端在 `AppManifest` 中携带加载期 `issue`，在 `AppState` 中携带运行期 `issue`，并为无法恢复的官方应用构造占位 manifest；`load_all_manifests` 因此始终能返回其他正常应用。前端把 `manifest.issue ?? state.issue` 作为应用状态显示在顶部、内容区和应用管理页；官方市场页面先显示缓存，再在首次打开时刷新远程定义。

**Tech Stack:** Rust/Tauri、React 18、TypeScript、Vitest、Tailwind、lucide-react。

## Global Constraints

- aIdea 壳配置、IPC 初始化和数据库初始化失败才允许阻断壳启动；单个应用错误不得阻断。
- 异常应用必须保留在顶部菜单和应用管理中，并显示清晰、可操作的错误信息。
- 官方应用定义和业务数据契约以 `docs/guide/aidea-official-app.md`、`docs/guide/aidea-platform.md`、`docs/guide/aidea-storage.md` 为准。
- 不新增依赖；所有图标来自 `lucide-react`，UI 服从 `docs/guide/aidea-ui.md`。
- 不自动执行 `git add`、commit、push 或创建 PR。

---

### Task 1: 后端返回异常应用占位状态

**Files:**
- Modify: `shell-native/src/manifest.rs`
- Modify: `shell-native/src/plugin_installer.rs`
- Modify: `shell-frontend/src/types/manifest.ts`
- Test: `shell-native/src/plugin_installer.rs`

**Interfaces:**
- Produces Rust `AppIssue { level: String, message: String, updated_at: i64 }`。
- Produces `AppManifest.issue: Option<AppIssue>`，序列化给 TypeScript `AppIssue`。
- Produces `AppState.issue: Option<AppIssue>`；`ProcessManager` 保存最近一次运行错误，成功启动后清除。
- `list_installed_app_manifests() -> AppResult<Vec<AppManifest>>` 对每条官方安装记录返回正常 manifest 或带 `issue` 的占位 manifest。

- [ ] **Step 1: 写失败测试，证明旧记录不会被静默隐藏**

在 `plugin_installer` 测试模块创建缺少 `definition` 的临时 `install-state.yaml`，断言返回一个 `id == "legacy-plugin"` 且 `issue.is_some()` 的 manifest：

```rust
let manifests = list_installed_app_manifests().unwrap();
assert_eq!(manifests[0].id, "legacy-plugin");
assert!(manifests[0].issue.is_some());
```

- [ ] **Step 2: 运行失败测试**

Run: `cargo test plugin_installer::tests::旧安装记录缺少定义快照会显示异常应用`

Expected: FAIL，因为当前实现会跳过该记录或返回整个错误。

- [ ] **Step 3: 定义跨端异常类型和占位 manifest**

在 `manifest.rs` 增加：

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppIssue {
    pub level: String,
    pub message: String,
    pub updated_at: i64,
}

#[serde(default)]
pub issue: Option<AppIssue>,
```

在 `plugin_installer.rs` 为每条无法读取、解析或恢复定义的官方安装记录构造：

```rust
AppManifest {
    id: record.id.clone(),
    name: record.id.clone(),
    version: record.version.clone(),
    category: "官方应用".into(),
    path: install_root(&record.id)?.to_string_lossy().into_owned(),
    status: AppStatus::Active,
    ui: UiConfig { mode: UiMode::None, url: None, icon: None },
    process: None,
    issue: Some(AppIssue { level: "warning".into(), message, updated_at: chrono::Utc::now().timestamp() }),
}
```

不要在启动时 `eprintln!` 同一异常；异常信息仅通过 manifest 和该应用日志目录提供。正常应用仍使用完整定义创建 webview manifest。

- [ ] **Step 4: 同步 TypeScript 类型**

在 `types/manifest.ts` 增加：

```ts
export interface AppIssue {
  level: 'warning';
  message: string;
  updated_at: number;
}

export interface AppManifest {
  // existing fields
  issue?: AppIssue;
}
```

- [ ] **Step 5: 运行后端测试**

Run: `cargo test plugin_installer::tests --quiet`

Expected: PASS，旧记录返回异常应用，正常安装记录和安装定义快照测试仍通过。

### Task 2: 进程运行错误状态隔离

**Files:**
- Modify: `shell-native/src/process.rs`
- Modify: `shell-frontend/src/types/manifest.ts`
- Test: `shell-native/src/process.rs`

**Interfaces:**
- `AppState.issue?: AppIssue` 表示最近一次启动、停止或健康检查错误。
- `ProcessManager` 成功启动后清除同一应用的 issue；失败时记录 warning，不影响其他应用。

- [ ] **Step 1: 写失败测试**

为端口被占用或健康检查失败的启动路径增加断言：`get_all_states` 返回该应用的 `issue`，其他应用状态仍可读取。

- [ ] **Step 2: 运行失败测试**

Run: `cargo test process::tests::运行失败会保留应用异常状态`

Expected: FAIL，因为当前 `AppState` 没有 issue 字段，启动错误不会被保存。

- [ ] **Step 3: 实现运行时错误状态**

在 `AppState` 增加 `#[serde(default)] pub issue: Option<AppIssue>`，在 `ProcessManager` 增加按 app id 保存最近 issue 的内存映射。启动、停止、健康检查失败时写入 issue；成功启动或成功停止后清除。`get_all_states` 和恢复进程状态都要带上 issue。

- [ ] **Step 4: 运行进程测试**

Run: `cargo test process::tests --quiet`

Expected: PASS。

### Task 3: 顶部、内容区和应用管理展示异常状态

**Files:**
- Modify: `shell-frontend/src/components/AppIcon.tsx`
- Modify: `shell-frontend/src/components/SortableAppIcon.tsx`
- Modify: `shell-frontend/src/components/ContentArea.tsx`
- Modify: `shell-frontend/src/components/AppManagementPage.tsx`
- Create: `shell-frontend/tests/components/ContentArea.test.tsx`
- Modify: `shell-frontend/tests/components/AppManagementPage.test.tsx`

**Interfaces:**
- Consumes `AppManifest.issue` from Task 1 and `AppState.issue` from Task 2。
- Produces可点击但置灰警告的顶部应用项，以及含“刷新市场/应用管理/查看日志”提示的内容区。

- [ ] **Step 1: 写前端失败测试**

为 `ContentArea` 传入 `ui.mode: 'none'` 和：

```ts
issue: { level: 'warning', message: '应用定义不可用，请刷新市场后更新或卸载', updated_at: 0 }
```

断言显示应用名、异常消息和“应用异常”。为应用管理页 mock 同样的 manifest，断言显示异常 Badge 和消息。

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- --run tests/components/ContentArea.test.tsx tests/components/AppManagementPage.test.tsx`

Expected: FAIL，因为现有内容区只显示“后台运行中，无 UI”，应用管理没有异常状态。

- [ ] **Step 3: 实现最小异常展示**

在 `AppIcon` 为 `app.issue` 或运行态 issue 显示 `TriangleAlert`，并使用 `text-muted-foreground`；在 `SortableAppIcon` 为异常应用固定灰色样式，不阻止点击或拖拽。顶部组件需要接收对应 `AppState`，统一判断 `app.issue ?? state.issue`。

在 `ContentArea` 的 webview/builtin 分支之前优先渲染异常面板：

```tsx
if (activeApp?.issue || states[activeApp.id]?.issue) {
  return <AppIssuePanel app={activeApp} />;
}
```

面板使用 `TriangleAlert`、异常消息和“在设置的应用管理中刷新市场、更新或卸载该应用”的说明；不展示不存在的启动按钮。

在 `AppManagementPage` 的应用名称后增加 `Badge variant="outline"`，文字为“异常”，并在版本下方显示 `app.issue?.message ?? states[app.id]?.issue?.message`。异常应用禁用启动、停止、重启；保留日志和卸载操作。

- [ ] **Step 4: 运行前端目标测试**

Run: `npm test -- --run tests/components/ContentArea.test.tsx tests/components/AppManagementPage.test.tsx`

Expected: PASS。

- [ ] **Step 5: 构建前端**

Run: `npm run build`

Expected: PASS，无 TypeScript 类型错误。

### Task 4: 应用市场首次打开主动刷新并保留缓存

**Files:**
- Modify: `shell-frontend/src/builtin-apps/plugin-market/index.tsx`
- Modify: `shell-frontend/tests/plugin-market/PluginMarketPage.test.tsx`

**Interfaces:**
- Consumes现有 `ipc.listOfficialPlugins()` 和 `ipc.refreshOfficialPlugins()`。
- 首次进入页面先显示缓存，再自动刷新；失败时保留缓存并更新 `error`。

- [ ] **Step 1: 写失败测试**

mock `listOfficialPlugins` 返回缓存列表，mock `refreshOfficialPlugins` 返回新列表。渲染页面后断言两个 IPC 都被调用，最终显示刷新结果。再添加刷新失败用例：缓存列表仍显示，页面显示错误文字。

- [ ] **Step 2: 运行失败测试**

Run: `npm test -- --run tests/plugin-market/PluginMarketPage.test.tsx`

Expected: FAIL，因为当前首次挂载只调用 `load()`，不会调用 `refreshMarket()`。

- [ ] **Step 3: 依次加载缓存和刷新远程定义**

将首次挂载 effect 改为：

```ts
useEffect(() => {
  void (async () => {
    await load();
    await refreshMarket();
  })();
}, []);
```

`refreshMarket` 发生异常时不得清空 `plugins` 或 `installed` 状态；只设置 `error`。保留现有手动刷新按钮和 `refreshing` 禁用状态。

- [ ] **Step 4: 运行市场测试**

Run: `npm test -- --run tests/plugin-market/PluginMarketPage.test.tsx`

Expected: PASS，首次自动刷新成功和失败保留缓存均被覆盖。

### Task 5: 端到端回归验证与契约同步

**Files:**
- Modify: `docs/guide/aidea-platform.md`
- Modify: `docs/guide/aidea-official-app.md`

**Interfaces:**
- 消费前四个任务的 `issue` 状态和首次市场刷新行为。

- [ ] **Step 1: 补充平台契约**

在 `platform.md` 生命周期段加入：单个官方应用定义、安装、进程和健康检查异常必须隔离为应用异常状态；壳继续加载其他应用。并注明异常应用保留在顶部菜单和应用管理中。

在 `marketplace.md` 加入：市场首次打开读取缓存后主动刷新；刷新失败保留缓存并显示错误。

- [ ] **Step 2: 运行定向测试集合**

Run:

```bash
cargo test plugin_installer::tests --quiet
cargo test plugin_market::tests --quiet
npm test --prefix shell-frontend -- --run tests/manifest-loader.test.ts tests/components/ContentArea.test.tsx tests/components/AppManagementPage.test.tsx tests/plugin-market/PluginMarketPage.test.tsx
npm run build --prefix shell-frontend
git diff --check
```

Expected: 全部 PASS。若完整 `npm test` 或 `cargo test` 仍因已知的无关失败停止，记录失败测试名和原因，不把它算作本功能失败。
