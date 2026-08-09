# aIdea 开发约定

本文件是 aIdea 仓库的入口规则。详细契约统一放在 `docs/guide/`；开发前按任务路由读取对应文档，不把专项规则复制到本文件或 Skill 中。

## 产品背景

aIdea 是给本人和少数同事使用的本机桌面应用壳，不是面向陌生开发者的通用插件平台。内置应用和官方应用都由我们自己开发、发布和维护，设计优先级是简单、稳定、容易排查问题，不为尚未存在的第三方扩展场景增加复杂边界。应用自有数据库标准已经确定并落地。

- **内置应用**：代码在本仓库内，随 aIdea 一起发布；前端位于壳的 WebView 中，通过 `shell-frontend/src/lib/ipc.ts` 调用自己的 Rust 业务代码。
- **官方应用**：独立仓库、独立进程，由 aIdea 安装、启动和展示；应用通过 `AIDEA_APP_DATA_DIR` 和 `AIDEA_APP_LOG_DIR` 管理自己的数据与日志。
- 两类应用统一使用自己的 `app-data/<app-id>/app.db`，包括普通配置、业务数据和凭据；应用不读 aIdea 或其他应用的数据库，凭据不写日志。
- aIdea 只管理应用生命周期、显示/启动偏好、安装运行环境、设置入口和日志；不解析应用业务配置，也不提供共享凭据服务。
- 当前邮件管理是内置应用，后续会迁移为独立官方应用；迁移后使用同一套应用数据和设置页约定，不复用当前内置邮件的 IPC 或 Rust 内部实现。
- 旧的 `databases/mail-manager.db`、独立凭据存储和 DevTools JSON 不再是兼容目标；新代码不得读取或写入这些路径。

## 核心边界

- 当前只开发内置应用和官方应用，不实现第三方市场、自定义安装、自动发现或多作者权限系统。
- aIdea 壳管理应用安装、更新、卸载、启动、停止、健康检查、WebView、日志和运行状态；应用管理自己的业务代码、数据、迁移、网络请求和 UI。
- 内置应用使用 aIdea 内部 Tauri IPC，并统一通过 `shell-frontend/src/lib/ipc.ts` 调用。官方应用不得依赖 Tauri IPC、壳前端封装或 Rust 命令名。
- 官方应用只使用 aIdea 注入的应用 ID、数据目录和日志目录环境变量；不依赖未定义的平台命令或 aIdea 内部数据库。
- 所有 UI、内置应用和官方应用都必须检查浅色与深色主题；邮件正文、Markdown、富文本和第三方 HTML 内容区也必须可读。
- 应用数据和配置保存在自己的 `app-data/<app-id>/app.db`，卸载默认保留；敏感值可以保存在应用自己的数据库，但不得写入日志。

## 开发前文档路由

| 任务 | 先读 |
| --- | --- |
| 平台边界、应用生命周期、设置和运行管理 | [docs/guide/aidea-platform.md](docs/guide/aidea-platform.md) |
| 新增或修改内置应用、manifest、Tauri IPC | [docs/guide/aidea-builtin-app.md](docs/guide/aidea-builtin-app.md)、[docs/guide/aidea-ui.md](docs/guide/aidea-ui.md) |
| 开发独立官方应用、`aidea.yaml`、市场接入、安装更新 | [docs/guide/aidea-official-app.md](docs/guide/aidea-official-app.md)、[docs/guide/aidea-platform.md](docs/guide/aidea-platform.md) |
| 修改 SQLite、缓存、迁移、备份或敏感值 | [docs/guide/aidea-storage.md](docs/guide/aidea-storage.md) |
| 修改官方应用运行环境、应用数据或设置页 | [docs/guide/aidea-official-app.md](docs/guide/aidea-official-app.md)、[docs/guide/aidea-storage.md](docs/guide/aidea-storage.md) |
| 修改页面视觉、组件、交互或无障碍 | [docs/guide/aidea-ui.md](docs/guide/aidea-ui.md) |
| 发布 aIdea、改版本、构建 DMG、推送 tag | 使用 `$aidea-release` Skill；它只负责 aIdea 发布流程 |

独立官方应用仓库还必须先读取其自身根目录 `AGENTS.md`，再根据任务读取本表中 aIdea 仓库的绝对路径文档。文档冲突时，以更具体的专项文档为准；未实现的平台能力不得通过猜测使用。

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

文档修改至少运行 `git diff --check`，并检查规范链接和关键路由。不要自动 `git add`、commit、push 或创建 PR；发布 Skill 的明确授权只覆盖其发布流程。
