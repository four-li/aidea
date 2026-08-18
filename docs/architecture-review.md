# aIdea 架构评审：长期迭代风险与改造方向

> 定位：本文是架构评审记录，不是开发契约。三个问题的改造方向均未确认，任何一条动手前需先按 `AGENTS.md` 的开发期纪律对齐：先修订 `docs/guide/` 对应专题文档，再改实现。
>
> 评审范围：壳核心（`shell-native/src/`、`shell-frontend/src/`）截至 2026-08-18 的状态。
>
> 排序原则：按"继续迭代时的复利成本"排序，问题 1 的修复窗口最短，问题 3 是慢性病。

---

## 问题 1：内置应用没有模块边界，壳根入口是全局耦合点

**严重程度：高（每次新增/修改内置应用都在付利息，且利息递增）**

### 现状

新增或修改一个内置应用，必须同步触碰 5 个散布点：

| 序号 | 位置 | 内容 |
| --- | --- | --- |
| 1 | `shell-native/src/lib.rs` `invoke_handler` | 平铺注册命令，当前约 50 个，无分组 |
| 2 | `shell-native/src/commands/` | 新增 Rust 命令模块（`dev_tools.rs`、`ai_service.rs` 等） |
| 3 | `shell-frontend/src/lib/ipc.ts` | 手工维护的命令 → 函数映射，135 行 |
| 4 | `shell-frontend/src/types/` | 新增类型文件 |
| 5 | `shell-frontend/src/builtin-apps/` | 新增页面组件 |

manifest 系统（`apps/builtin/*.yaml`）名义上统一了两类应用，但内置应用的"注册"实际是硬编码在壳里的——manifest 只描述 UI 入口，不描述命令归属。同一个概念存在两套真相来源。

### 为什么危险

1. **Tauri IPC 命令名是全局命名空间**，没有按应用前缀隔离（`get_dev_tools_settings`、`list_ai_service_models` 平铺）。每加一个命令，冲突面和心智负担就涨一分。一旦两个应用出现同名命令，调试成本极高（Tauri 同名命令注册行为不友好）。
2. **壳核心文件的变更频率与内置应用数正相关**。`lib.rs` 和 `ipc.ts` 是所有人的公共修改点，git 冲突面和壳构建时间随应用数线性恶化，且没有任何机制强制收敛——只靠约定。
3. **无法做应用级隔离测试**。命令注册在壳根，内置应用的 Rust 测试必须拉起整个壳的命令上下文。

### 改造方向

原则：不改变"内置应用随壳发布"的边界，只把散布的 5 处收敛为每应用 1 处。

1. **Rust 侧按应用聚合**：`commands/` 下每个内置应用一个目录（如 `commands/dev_tools/mod.rs`），目录内导出自己的命令切片。`lib.rs` 的 `invoke_handler` 只做拼装：

   ```rust
   // 示意：lib.rs 不再罗列全部命令，各应用模块自己贡献
   invoke_handler![
       ...shell::commands(),
       ...dev_tools::commands(),
       ...ai_service::commands(),
   ]
   ```

   注意：`generate_handler!` 是宏，不能直接展开切片数组。可行做法是每个应用模块暴露自己的 `generate_handler!` 结果合并，或退一步保持宏内按应用分组注释块——至少让归属可读。动手前先验证 Tauri 2 对切片合并的支持方式。

2. **命令名强制前缀**：新命令一律 `<app>_<verb>` 命名（如 `dev_tools_get_settings`）。存量命令在顺手改动时迁移，不做一次性大改（遵循外科手术式修改）。

3. **前端 ipc.ts 按应用拆分**：`lib/ipc/` 目录，每应用一个文件（`lib/ipc/dev-tools.ts`），`lib/ipc/index.ts` 只做聚合。类型文件随之并入各应用文件或对应 `types/` 子文件。

4. **manifest 声明命令归属**（可选，最后做）：`apps/builtin/*.yaml` 增加 `commands:` 段，作为文档级真相来源，运行时仍以 Rust 注册为准。

### 分期建议

- 第一期：前端 `ipc.ts` 拆分（纯机械，风险最低，立刻降低冲突面）。
- 第二期：Rust 命令目录重组 + 新命令前缀约定写入 `docs/guide/aidea-builtin-app.md`。
- 第三期（可选）：manifest 命令声明。

### 不改的成本

每新增一个内置应用 = 5 处散改 + 一次全量回归。应用数到 8~10 个时，`lib.rs` 的 `invoke_handler` 会超过 150 行，`ipc.ts` 超过 400 行，新人无法建立归属心智地图。

---

## 问题 2：AI Service 的双重身份——说是内置应用，实际是平台基础设施

**严重程度：高（修复窗口最短：每多一个平台级能力，改造成本翻倍）**

### 现状

文档（`docs/guide/aidea-ai-service.md`）定义 AI Service 是"独立内置应用"，但实现上它是平台级服务：

1. `shell-native/src/lib.rs` setup 中**硬编码无条件拉起**：`AiServiceState::new()` + `http::start_http_server()` + `app.manage(ai_service_state)`，不受 manifest 或用户偏好控制。对比其他内置应用（如 DevTools）按需加载，AI Service 的生命周期 = 壳的生命周期。
2. 它的 20+ 个 IPC 命令直接注册在壳根 `invoke_handler`（见问题 1）。
3. `ApprovalDialog`（审批弹窗）直接挂在 `App.tsx` 根部——这是平台级 UI（任何官方应用触发审批都会弹出），却物理上属于"某个内置应用"的目录 `builtin-apps/ai-service/`。
4. `setup` 里还硬编码注入 `rg` 资源路径（`resources/rg`），这是平台资源分发的特例。

### 为什么危险

1. **这是架构里最模糊的边界**。当下一个平台级能力出现（统一通知中心、应用内搜索索引、凭据代理……）时，没有可复用的模式，只会复制这种"setup 里硬编码 + 全局 state + 根挂 UI"的后门做法。三次之后就成了既成事实的架构，届时再拆就是伤筋动骨。
2. **单点故障半径等于整个 aIdea**。AI Service 与壳同进程同生命周期，却承担给所有官方应用供能的职责。它 panic 或死锁（例如 Rig 升级引入不兼容），整个 aIdea 跟着挂——包括与 AI 无关的应用管理、设置、日志查看。
3. **"内置应用"概念失去判定标准**。新贡献者无法从代码分辨哪些内置应用是"页面"（DevTools）、哪些是"平台服务"（AI Service）。文档说"内置应用 = 随壳发布的独立应用"，但 AI Service 显然不独立。
4. **无法独立演进**：AI Service 想独立重启、灰度新版本、调整端口策略时，都被壳的生命周期绑死。

### 改造方向

核心动作：在平台模型里正式拆出第三种角色——**平台服务（platform service）**，与"内置应用""官方应用"并列：

```
aIdea 应用模型
├── 内置应用：随壳发布，按需加载，Tauri IPC，有自己的页面和设置（DevTools、developer-guide）
├── 官方应用：独立仓库独立进程，App Bridge 通信
└── 平台服务（新）：随壳发布，壳启动时拉起，提供跨应用能力，无独立用户入口（AI Service）
```

具体步骤：

1. **文档先行**：在 `docs/guide/aidea-platform.md` 增加平台服务角色定义（生命周期、启动顺序、健康检查、与壳的依赖关系、UI 挂载约定），`aidea-ai-service.md` 改为引用该定义。这一步零代码风险。
2. **显式化启动**：`lib.rs` setup 中的 AI Service 启动逻辑收敛到一个显式的"平台服务注册表"（可以只是一个 `Vec<PlatformServiceDescriptor>` 或简单的模块函数），下一个平台服务照此接入，而不是继续往 setup 里塞代码。
3. **平台 UI 与应用 UI 分离**：`ApprovalDialog` 之类的平台级 UI 移出 `builtin-apps/ai-service/`，放入 `components/`（壳组件区），文件头注释标明它属于平台服务。
4. **远期（评估后再定）**：AI Service 拆成独立进程，走官方应用的进程管理 + 本地 HTTP。收益是故障隔离，代价是多一层进程管理和端口占用。不急于现在决定，但平台服务的定义要为这条路留出可能。

### 分期建议

- 第一期：纯文档（平台服务角色 + AI Service 身份修订），半天量级。
- 第二期：启动显式化 + UI 归位，小规模重构。
- 第三期：进程化拆分，等出现第二个平台服务或第一次真实故障再做决策。

### 不改的成本

AGENTS.md 开发期纪律原话："不要在挂载了很多子应用之后才回头推翻重构，那时代价极高、风险极大。"当前只有 AI Service 一个平台服务，现在拆的成本是全生命周期最低点。

---

## 问题 3：前端导航状态组合爆炸，无路由抽象

**严重程度：中高（慢性病，每次新增入口都在加状态和手工同步）**

### 现状

`shell-frontend/src/App.tsx`（331 行）同时管理十余个状态：`activeAppId`、`showBuiltinHub`、`activeBuiltinAppId`、`previousMainAppId`、`showDebug`、`debugTarget`、`showSettings`、`settingsCategory`……视图真相是这些状态的组合。

具体症状：

1. **三元组合靠 effect 手工同步**：`activeAppId × showBuiltinHub × activeBuiltinAppId` 的同步在 App.tsx 的 effect 里完成，其中一个 effect 的依赖数组有 7 项。每加一种入口（迷你面板、全局搜索浮层、通知中心……）都要再加状态并在所有回调里手工维护一致性。
2. **手工模拟返回栈**：`onBackToMain` 用 `previousMainAppId` ref 手工实现"返回上一个应用"——这正是路由系统被发明要解决的问题。返回路径超过一层（A → guide → B → back）时行为开始不可预测。
3. **进程状态轮询 + 手动刷新**：`states` 通过 `useProcessStatus` 轮询，启动应用时连续调用两次 `refresh()`（乐观刷新 + 结果刷新）。Rust 侧完全可以用 Tauri event 推送进程状态变化，前端订阅即可。
4. **状态层层透传**：`states`、`refresh`、`onShowLog` 在 App → TopBar / ContentArea / SettingsPanel 逐层手递手。没有 context 或状态管理，每加一个消费者都要再加一条透传链。
5. **同类用户偏好双源持久化**：`appOrder` 存 localStorage（`aidea-app-order`），而应用的其他用户设置存 SQLite（`save_app_user_settings`）。WebView 数据被清时排序丢失且 Rust 侧永远看不到顺序，备份/迁移（`aidea-storage.md` 的 app.db 契约）也覆盖不到它。

### 改造方向

1. **视图状态机单一真相**：用一个可辨识联合（discriminated union，即一个带 `kind` 字段的对象，不同视图不同字段）替代布尔组合：

   ```ts
   // 示意：所有导航真相收敛为一个状态
   type View =
     | { kind: 'hub'; builtinAppId: string }        // 开搞中心
     | { kind: 'app'; appId: string }               // 官方应用 / 全屏内置页
     | { kind: 'guide' };                           // 开发手册
   // debug / settings 作为 overlay 叠加态，不参与主视图组合
   const [view, setView] = useState<View>({ kind: 'hub', builtinAppId: 'ai-service' });
   ```

   返回栈（如需要）用一个 `View[]` 栈即可，`previousMainAppId` ref 删除。

2. **进程状态改事件推送**：Rust 侧 `ProcessManager` 在进程启动/退出/崩溃时 emit Tauri event，前端 hook 订阅维护本地缓存。轮询和手动 `refresh()` 双刷全部移除。这个改动同时消灭"启动应用后状态短暂不一致"的窗口。

3. **`appOrder` 迁入 SQLite**：并入 `save_app_user_settings` 的既有通道（app.db 契约已覆盖备份/迁移），localStorage 读取逻辑做一次性迁移后删除。

4. **透传收敛**（顺手做，不单独开工）：引入轻量 context 只放 `states` + `refresh` 这一对，其余 props 保持显式传递，避免过度设计。

### 分期建议

- 第一期：`appOrder` 迁 SQLite（小、独立、消灭双源）。
- 第二期：进程状态事件化（前后端各半，可独立验证）。
- 第三期：视图状态机重构（改动面最大，放最后，前两期完成后 App.tsx 状态会自然减少）。

### 不改的成本

下一种视图入口（通知中心、全局搜索浮层、迷你面板）出现时，App.tsx 状态数和 effect 同步逻辑继续膨胀，回归测试范围指数扩大。331 行的 App.tsx 会先于架构其他部分到达不可维护点。

---

## 落选但值得记录

以下是评审中发现、未进前三的问题。记录在此避免重复排查：

| 问题 | 现状 | 不进前三的原因 |
| --- | --- | --- |
| `process.rs` 单文件 1408 行 | `ProcessManager` 单个 impl 块约 460 行，混合进程表、重试、健康检查、runtime record 持久化、端口探测 | 职责域仍然单一（都是进程生命周期），拆分是低风险体力活，可分期偿还 |
| 配置多源 | `shell.config.json` + `market-source.yaml` + SQLite + localStorage + RuntimeRecord 文件，共 5 种机制 | 各有明确归属，当前痛点未到临界；问题 3 第一期会顺带消掉 localStorage 一源 |

---

## 决策请求

| 编号 | 待决策 | 建议 |
| --- | --- | --- |
| D1 | 是否接受问题 1 的"每应用一处注册"方向，并从 ipc.ts 拆分开始 | 建议接受，第一期风险极低 |
| D2 | 是否在平台模型中正式增加"平台服务"第三角色 | 建议接受，文档先行，代码小步跟随 |
| D3 | 视图状态机 + 进程事件化的重构排期 | 建议排在 D1/D2 之后，按三期分步 |

确认任何一条后，按文档治理规则先更新 `docs/guide/` 对应专题文档，再动实现。
