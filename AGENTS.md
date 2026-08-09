# aIdea 开发约定

本文件是 aIdea 仓库的入口规则。详细契约统一放在 `docs/guide/`；开发前按任务路由读取对应文档，不把专项规则复制到本文件或 Skill 中。

## 核心边界

- 当前只开发内置应用和官方应用，不实现第三方市场、自定义安装、自动发现、插件 SDK 或多作者权限系统。
- aIdea 壳管理应用安装、更新、卸载、启动、停止、健康检查、WebView、日志和运行状态；应用管理自己的业务代码、数据、迁移、网络请求和 UI。
- 内置应用使用 aIdea 内部 Tauri IPC，并统一通过 `shell-frontend/src/lib/ipc.ts` 调用。官方应用不得依赖 Tauri IPC、壳前端封装或 Rust 命令名。
- 官方应用当前只能使用 aIdea 注入的三个环境变量。`AIDEA_COMMAND`、`aidea secret` 和 `aidea notify` 尚未实现，不能写入应用运行前提；实现后再更新对应文档和 Skill。
- 所有 UI、内置应用和官方应用都必须检查浅色与深色主题；邮件正文、Markdown、富文本和第三方 HTML 内容区也必须可读。
- 业务数据默认保存在应用自己的 `app-data/<app-id>/`，卸载默认保留；敏感值不得写入普通配置、业务 SQLite 或日志。

## 开发前文档路由

| 任务 | 先读 |
| --- | --- |
| 平台边界、应用生命周期、设置和运行管理 | [docs/guide/aidea-platform.md](docs/guide/aidea-platform.md) |
| 新增或修改内置应用、manifest、Tauri IPC | [docs/guide/aidea-builtin-app.md](docs/guide/aidea-builtin-app.md)、[docs/guide/aidea-ui.md](docs/guide/aidea-ui.md) |
| 开发独立官方应用、`aidea.yaml`、市场接入、安装更新 | [docs/guide/aidea-official-app.md](docs/guide/aidea-official-app.md)、[docs/guide/aidea-platform.md](docs/guide/aidea-platform.md) |
| 修改 SQLite、缓存、迁移、备份或敏感值 | [docs/guide/aidea-storage.md](docs/guide/aidea-storage.md) |
| 修改官方应用的平台环境或命令接口 | [docs/guide/aidea-platform-cli.md](docs/guide/aidea-platform-cli.md) |
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
