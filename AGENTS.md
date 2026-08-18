# aIdea 开发约定

本文件是 aIdea 仓库的入口规则。每次开发先读 [docs/guide/README.md](docs/guide/README.md)，再按其中的任务路由读取专题文档。详细契约统一放在 `docs/guide/`；不把专项规则复制到本文件、Skill 或内置页面文案中。

## 产品背景

aIdea 是给本人和少数同事使用的本机桌面应用壳，不是面向陌生开发者的通用插件平台。内置应用和官方应用都由我们自己开发、发布和维护，设计优先级是简单、稳定、容易排查问题，不为尚未存在的第三方扩展场景增加复杂边界。应用自有数据库标准已经确定并落地。

- **内置应用**：代码在本仓库内，随 aIdea 一起发布；前端位于壳的 WebView 中，通过 `shell-frontend/src/lib/ipc.ts` 调用自己的 Rust 业务代码。
- **官方应用**：独立仓库、独立进程，由 aIdea 安装、启动和展示；应用通过 `AIDEA_APP_DATA_DIR` 和 `AIDEA_APP_LOG_DIR` 管理自己的数据与日志。
- 两类应用统一使用自己的 `app-data/<app-id>/app.db`，包括普通配置、业务数据和凭据；应用不读 aIdea 或其他应用的数据库，凭据不写日志。
- aIdea 只管理应用生命周期、显示/启动偏好、安装运行环境和日志；内置应用可使用壳内设置入口，官方应用的业务设置由自己的主页面组织。aIdea 不解析应用业务配置，也不提供共享凭据服务。
- 内置应用和官方应用的 `version` 都是发布契约的一部分：开发阶段不因代码改动自动升版本；正式发布时，如果改动影响用户可见功能、界面、交互、设置页、数据格式或业务行为，发布流程必须同步升版本。纯重构、测试和文档不要求升版本。
- 官方应用只发布单个 macOS Apple Silicon（arm64）自包含 binary 包：包内必须带齐启动所需运行时和应用依赖，用户无需安装 Rust、Cargo、Node、npm、Python 或 SQLite。aIdea 不自动安装、升级用户运行时；启动程序只从解压包根目录执行，子进程不继承用户 `PATH`。
- 官方应用不发布或维护 Intel Mac、Windows、iOS、Android 等其他平台安装包。源码调试直接在应用仓库进行，不属于市场安装契约。
- 内置邮件管理已经从 aIdea 移除；新邮件管理必须在独立官方应用仓库中实现，固定应用 ID 为 `mail-center`，不得依赖旧内置邮件的 IPC、Rust 模块、前端组件或数据结构。
- 旧邮件不做数据迁移、不做双写、不保留兼容读取。历史 `mail-manager` 数据路径不是兼容目标，aIdea 新代码不得读取或写入，也不自动删除这些路径。

## 核心边界

- 当前只开发内置应用和官方应用，不实现第三方市场、自定义安装、自动发现或多作者权限系统。
- 官方应用发布目标只覆盖 macOS Apple Silicon（arm64）；Intel Mac、Windows、iOS、Android 及其他平台不在范围内。二进制安装 v1 只接收一个 arm64 产物，不设计架构选择或 Intel 回退。
- aIdea 壳管理应用安装、更新、卸载、启动、停止、健康检查、WebView、日志和运行状态；应用管理自己的业务代码、数据、迁移、网络请求和 UI。
- 内置应用使用 aIdea 内部 Tauri IPC，并统一通过 `shell-frontend/src/lib/ipc.ts` 调用。官方应用不得依赖 Tauri IPC、壳前端封装或 Rust 命令名。
- 官方应用只使用 aIdea 注入的应用 ID、数据目录和日志目录环境变量；不依赖未定义的平台命令或 aIdea 内部数据库。
- 内置应用和官方应用如果启动自己的本地 HTTP 服务，服务端口统一从 `43000-43999` 范围内分配，并为每个应用保持稳定且不重复的端口；内置应用仅通过 Tauri IPC 通信时不需要端口。该范围是开发和发布规范，安装时不强制拒绝范围外的既有应用。
- 所有 UI、内置应用和官方应用都必须检查浅色与深色主题；邮件正文、Markdown、富文本和第三方 HTML 内容区也必须可读。
- 所有 Web UI 统一使用 shadcn/ui 标准：复用项目已有 shadcn 组件，缺失时只从 shadcn 官方组件或官方 registry 添加；不引入第二套 UI 组件库，不手写 `Button`、`Dialog`、`Select`、`Switch` 等基础交互组件。详细约束见 `docs/guide/aidea-ui.md`。
- 应用数据和配置保存在自己的 `app-data/<app-id>/app.db`，卸载默认保留；敏感值可以保存在应用自己的数据库，但不得写入日志。

## 开发期架构纪律（临时）

> 本小节为开发期临时纪律，待 Fourli 认为架构稳定、成熟后由本人手动删除；删除前始终有效。

- 开发期内，凡是发现不规范、技术选型不当或方案落后的地方，主动提出来，不要默默绕开或在子应用里打补丁。
- 该重构就重构，该换技术方案就换技术方案；**不要在挂载了很多子应用之后才回头推翻重构**，那时代价极高、风险极大。开发期应有这种魄力。
- 壳↔子应用的通信契约（App Bridge，见 `docs/guide/aidea-app-bridge.md`）是当前重点搭建对象。子应用须严格按契约实现；若发现契约自身有问题，优先修订契约规范，而不是在个别子应用里各搞一套兼容。
- 任何对核心边界、通信契约、应用生命周期的改动，先在本仓库文档（`docs/guide/`）和本文件对齐，再动手；改动后同步更新受影响文档。

## 开发前文档路由

| 任务 | 先读 |
| --- | --- |
| 所有 aIdea 开发 | [docs/guide/README.md](docs/guide/README.md)，再按任务进入专题文档 |
| 平台边界、应用生命周期、设置和运行管理 | [docs/guide/aidea-platform.md](docs/guide/aidea-platform.md) |
| 壳与官方应用通信、主题、通知和应用内搜索 | [docs/guide/aidea-app-bridge.md](docs/guide/aidea-app-bridge.md)、[docs/guide/aidea-search.md](docs/guide/aidea-search.md) |
| 新增或修改内置应用、manifest、Tauri IPC | [docs/guide/aidea-builtin-app.md](docs/guide/aidea-builtin-app.md)、[docs/guide/aidea-ui.md](docs/guide/aidea-ui.md) |
| 开发独立官方应用、`aidea.yaml`、市场接入、安装更新 | [docs/guide/aidea-official-app.md](docs/guide/aidea-official-app.md)、[docs/guide/aidea-platform.md](docs/guide/aidea-platform.md) |
| 子应用调用 AI、AI Service、Agent 工具或 Rig 升级 | [docs/guide/aidea-ai-service.md](docs/guide/aidea-ai-service.md) |
| 修改 SQLite、缓存、迁移、备份或敏感值 | [docs/guide/aidea-storage.md](docs/guide/aidea-storage.md) |
| 修改官方应用运行环境、应用数据或设置页 | [docs/guide/aidea-official-app.md](docs/guide/aidea-official-app.md)、[docs/guide/aidea-storage.md](docs/guide/aidea-storage.md) |
| 修改页面视觉、组件、交互或无障碍 | [docs/guide/aidea-ui.md](docs/guide/aidea-ui.md)，优先复用 shadcn/ui 组件 |
| 发布 aIdea、改版本、构建 DMG、推送 tag | [docs/guide/aidea-release.md](docs/guide/aidea-release.md)，再使用 `$aidea-release` Skill |

独立官方应用仓库还必须先读取其自身根目录 `AGENTS.md`，再根据任务读取本表中 aIdea 仓库的绝对路径文档。文档冲突时，以更具体的专项文档为准；未实现的平台能力不得通过猜测使用。

## 发布边界

aIdea 自身发布的完整契约见 [docs/guide/aidea-release.md](docs/guide/aidea-release.md)。不要为了消除 Chrome 对 aIdea 自身 Gitee `foruda.gitee.com` 附件 URL 的安全误报而改变 aIdea 发布平台；官方子应用选择 Gitee、GitHub 或 GitLab 时仍须遵守官方应用规范。

## 工程配置

| 工具 | 配置 | 约定 |
| --- | --- | --- |
| ESLint | `shell-frontend/eslint.config.js` | ESLint 9；禁止 `any`、未用变量；允许 `console.warn/error` |
| Prettier | `shell-frontend/.prettierrc` | 单引号、分号、2 空格、100 字符 |
| EditorConfig | `.editorconfig` | LF、2 空格、文件结尾换行 |
| Node | `.nvmrc` | 当前 20 |
| 路径别名 | `shell-frontend/vite.config.ts`、`tsconfig.json` | `@/*` -> `src/*` |
| Tailwind | `shell-frontend/tailwind.config.js` | ESM 写法，不使用 `require()` |

TypeScript 开启 `strict`、`noUnusedLocals` 和 `noUnusedParameters`，禁止 `any`。React 组件 props 使用 `interface`；hooks 使用 `use` 前缀；工具函数使用 camelCase；React 组件使用 PascalCase；Rust 模块使用 snake_case。

## 目录约定

```text
shell-frontend/src/
├── components/ui/       # shadcn 原语，不放业务组件
├── components/          # 业务组件
├── hooks/               # 自定义 hooks
├── lib/                 # 工具函数和 IPC 封装
├── types/               # TypeScript 类型
└── builtin-apps/        # 内置应用
```

Rust 后端按职责组织模块；Tauri 命令放在 `shell-native/src/commands/`，共享错误使用 `AppError` / `AppResult`。不要为单一实现提前增加 interface、factory、DTO 或 helper；只有真实复用或复杂度需要时才抽象。

## 验证与交付

修改代码前评估是否需要测试；需要时一并补充。按修改范围至少运行：

```bash
cd shell-frontend && npm run lint && npm test && npm run build
cd ../shell-native && cargo test
```

运行 `shell-native` 的全量 `cargo test` 时，必须直接申请允许本机回环端口监听的提升权限。

文档修改至少运行 `git diff --check`，并检查规范链接和关键路由。不要自动 `git add`、commit、push 或创建 PR；调用发布 Skill 时，发布 Skill 自己负责其发布流程内必要的提交、推送和远端发布操作。
