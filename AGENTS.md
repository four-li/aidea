# aIdea 设计约定

## 平台术语与硬约束

- **aIdea 壳**：本地应用平台，负责插件目录、生命周期、运行状态、日志、平台组件和自身更新。
- **内置插件**：代码直接位于 aIdea 仓库，随 aIdea 一起构建、发布和更新。
- **官方插件**：独立 GitHub 或 GitLab 仓库的自研应用，由 aIdea 官方插件市场预设接入定义；当前只开发内置插件与官方插件。
- **官方插件市场**：随 aIdea 发布的 `plugin-markets/official/` 官方仓库收录集合，不是远程市场服务。每项只声明仓库地址和启用状态；官方插件仓库根目录必须提供 `aidea.yaml`，其中定义版本、固定 commit SHA、安装命令和运行配置。
- **平台组件**：aIdea 可选提供的数据目录、日志目录、本地加密存储、通知和命令行入口。官方插件通过注入的环境变量和 `aidea` 命令使用，不依赖 SDK。
- **通信边界**：Tauri IPC 只供 aIdea 壳和内置插件使用；内置应用前端统一通过 `shell-frontend/src/lib/ipc.ts` 调用，不得直接 `invoke`。官方插件与平台的稳定通信统一走 `AIDEA_COMMAND` 指向的 `aidea` 命令，不得依赖 Tauri IPC、壳前端 IPC 封装或 Rust 命令名。
- aIdea 管理官方插件的安装、更新、卸载、启动、停止、健康检查、WebView、日志和状态；插件管理自己的业务代码、业务数据、配置、迁移、网络请求和业务 UI。
- 官方插件卸载默认只删除源码、依赖和运行环境，保留业务数据；删除数据必须由用户单独确认。
- 当前不实现第三方插件市场、自定义插件安装、自动发现、插件 SDK 或多作者权限系统；需要这些能力时先单独设计。
- 官方插件目录、运行与平台组件的详细契约以 `docs/app/` 下的专项文档为准。

## UI 规范

UI 视觉、组件、交互、配色和无障碍约定统一维护在 [docs/app/ui.md](docs/app/ui.md)。本仓库内的 UI 修改必须先遵守该文档，外部独立子项目也只需读取该文档，不引用本仓库的 UI 套件。

所有页面、内置子应用和官方插件的 UI 修改都必须同时检查浅色和深色主题；邮件正文、Markdown 预览、富文本、第三方 HTML 等内容区也不能例外。

外部设计库仅可作为视觉和交互原则参考；不得引入第二套组件、token、图标或主题体系。项目仍以 `docs/app/ui.md`、shadcn/ui、Tailwind CSS 和 lucide-react 为唯一实现基线。

## 开发前文档路由

根据任务类型先阅读对应文档，再修改代码：

| 任务 | 必读文档 |
|---|---|
| 修改页面视觉、组件、交互或无障碍 | [docs/app/ui.md](docs/app/ui.md) |
| 新增或修改内置子应用 | 本文件的「内置子应用规范」、[docs/app/ui.md](docs/app/ui.md)；涉及持久化时再读 [docs/app/storage.md](docs/app/storage.md) |
| 新增或修改 SQLite、缓存、持久化数据 | [docs/app/data-layout.md](docs/app/data-layout.md)、[docs/app/storage.md](docs/app/storage.md) |
| 开发可安装的官方插件 | [docs/app/package-spec.md](docs/app/package-spec.md)、[docs/app/platform.md](docs/app/platform.md)、[docs/app/platform-cli.md](docs/app/platform-cli.md)、[docs/app/data-layout.md](docs/app/data-layout.md)；涉及 UI 时再读 [docs/app/ui.md](docs/app/ui.md) |
| 修改应用 manifest、应用安装或生命周期 | 本文件的「Manifest 规范」「应用管理与覆盖配置」、[docs/app/package-spec.md](docs/app/package-spec.md)、[docs/app/marketplace.md](docs/app/marketplace.md) |
| 修改 Rust IPC、本地加密存储、Touch ID 或网络请求 | 本文件的「shell-native 模块规范」；涉及凭据或持久化时再读 [docs/app/storage.md](docs/app/storage.md) |

文档之间有冲突时，以更具体的专项文档为准；新增约定应更新对应专项文档，不把详细规则复制到本文件。

## 工程配置

| 工具 | 配置文件 | 说明 |
|---|---|---|
| ESLint | `eslint.config.js` | ESLint 9 新格式；禁止 `any`、未用变量；允许 `console.warn/error` |
| Prettier | `.prettierrc` | 单引号、分号、2 空格、100 字符宽 |
| EditorConfig | `.editorconfig` | 跨编辑器统一换行符(LF)/缩进(2空格)/文件结尾换行 |
| Node 版本 | `.nvmrc` | 统一 Node 版本（当前 20），配合 nvm/n 切换 |
| 路径别名 | `vite.config.ts` + `tsconfig.json` | `@/*` → `src/*`（但 shadcn 组件内部用相对路径） |
| Vite 类型 | `src/vite-env.d.ts` | Vite 环境类型声明（`import.meta.env` 等） |
| husky + lint-staged | `.husky/pre-commit` + `package.json` | commit 时自动 eslint + prettier |
| tailwind 配置 | `tailwind.config.js` | ESM 写法（项目是 `type: module`，禁用 `require()`） |

**命令**：
- `npm run lint` — 检查
- `npm run lint:fix` — 自动修复
- `npm run format` — 格式化全部
- `npm run build` — tsc + vite 构建
- `npm test` — vitest 单测

**TS 严格度说明**：
- 已开 `strict` + `noUnusedLocals` + `noUnusedParameters`
- 未开 `noUncheckedIndexedAccess`，避免现有代码产生大量无关告警

## 目录结构

```text
shell-frontend/src/
├── components/
│   ├── ui/              # shadcn 组件原语
│   ├── TopBar.tsx       # 业务组件
│   └── ...
├── hooks/               # 自定义 hooks（use 前缀）
├── lib/                 # 工具函数和 IPC 封装
├── types/               # TypeScript 类型定义
├── builtin-apps/        # 内置子应用页面
└── index.css            # 全局样式和 CSS 变量
```

规则：
- `components/ui/` 只放 shadcn 原语，不放业务组件
- 业务组件放 `components/` 下，PascalCase 命名
- hooks 放 `hooks/`，camelCase + `use` 前缀
- 工具函数放 `lib/`，camelCase
- TypeScript 禁止 `any`
- 组件 props 用 interface 定义
- 不添加无必要的注释；只在解释设计原因时添加注释

## 内置子应用规范

一个内置子应用对应一个 manifest 和一个 `builtin-apps/<app-id>/` 目录。内置子应用通过 `BuiltinPage.tsx` 显式注册，暂不做自动扫描。

DevTools 是一个内置子应用，内部小工具使用 tab 组织，不拆成多个顶层应用：

```text
shell-frontend/src/builtin-apps/dev-tools/
├── index.tsx
└── tabs/
    ├── data-formatter/
    │   ├── DataFormatter.tsx
    │   ├── format-utils.ts
    │   └── codemirror-theme.ts
    ├── timestamp-converter/
    │   └── TimestampConverter.tsx
    ├── ip-lookup/
    │   └── IpLookup.tsx
    └── ai-model-tester/
        └── AiModelTester.tsx
```

约定：
- 内置应用目录使用 kebab-case
- 入口固定为 `index.tsx`
- 业务组件使用 PascalCase
- 每个 DevTools tab 使用独立目录，tab 相关工具函数放在该目录内
- DevTools 内部多个 tab 共享的代码，确认有共享需求后再建立 `shared/`
- 类型定义继续放在 `src/types/`，与 Rust IPC 数据结构保持一致
- 测试目录跟随源码：`tests/dev-tools/tabs/<tab-name>/`
- 新增 tab 只修改 DevTools 入口的显式注册和对应测试，不引入自动扫描
- 内置应用可以声明自己的设置页；设置字段和持久化由应用负责，不写入 `shell.config.json` 或壳数据库。
- DevTools 的内部工具显示状态保存在 `app-data/dev-tools/settings.json`，不是壳的 `app_settings`。

## Manifest 规范

```yaml
id: dev-tools
name: DevTools
version: 0.3.0
category: 开发
path: shell-frontend/src/builtin-apps/dev-tools
status: active
ui:
  mode: builtin
  icon: Wrench
settings:
  enabled: true
  reset_command: [builtin, dev-tools]
```

字段约定：
- `id`：全局唯一，使用 kebab-case
- `name`：显示名称
- `version`：功能有用户可见变化时更新
- `category`：应用分类
- `path`：builtin 应用源码目录；当前由 manifest 保留并用于定位
- `status`：`active`、`disabled` 或 `deprecated`
- `ui.mode`：内置应用固定为 `builtin`
- `ui.icon`：lucide-react 图标名或图片路径
- `ui.url`：仅 webview 应用使用
- `settings.enabled`：保留用于兼容旧 manifest；每个应用在 aIdea 的应用管理中都必须有设置详情页。内置应用由应用设置注册表提供内容，官方应用固定使用本地服务的 `/settings`，尚未提供具体字段时显示空配置状态。
- `settings.reset_command`：可选的重置设置命令数组。官方应用执行应用仓库声明的命令；内置应用只能使用已注册的壳内处理器。完整重置由 aIdea 先请求 Touch ID。
- `process`：仅需要独立进程的应用使用

## 应用管理与覆盖配置

用户在设置弹窗「应用管理」里修改的字段，不写回原 yaml，而是存到 `shell.config.json` 的 `overrides` 字段（key = app id）。前端 `list_apps` 返回的 manifest 已经合并过 overrides，无需前端二次合并。

可覆盖字段：`name`、`icon`、`url`、`start`。覆盖配置在 aIdea 重启后生效，`save_app_override` 只写文件，不主动重载。

应用管理列表只负责显示应用、显示开关和进入设置详情；设置详情页在 aIdea 设置弹窗内部打开，不跳转主内容区。aIdea 不解析应用字段。只有声明 `process` 的应用在详情页显示“随 aIdea 启动”；`reset_command` 存在时才显示红色“重置”按钮。卸载官方应用默认保留 `app-data/<app-id>/`；重置设置不能删除整个应用数据目录，也不能删除业务数据库。

## shell-native 模块规范

Rust 后端按职责组织模块：

```text
shell-native/src/
├── main.rs
├── lib.rs
├── error.rs
├── config.rs
├── manifest.rs
├── process.rs
├── plugin_market.rs
├── plugin_installer.rs
├── secret_store.rs
├── mac_auth.rs
├── mail_runtime.rs
├── mail_store.rs
├── mail_sync.rs
└── commands/
    ├── mod.rs
    ├── shell.rs       # 壳和子应用生命周期 IPC
    ├── network.rs     # 网络/IP 查询 IPC
    ├── ai.rs          # AI 请求和 AI 配置 IPC
    └── mail.rs        # 邮件内置应用 IPC
```

约定：
- `commands/` 中的函数是 Tauri IPC 命令，按业务职责拆分
- `lib.rs` 只负责模块声明、状态初始化和 invoke handler 注册
- 命令名和前端参数是跨端接口，修改前端需同步 Rust 与 TypeScript 类型
- 共享错误统一使用 `AppError` / `AppResult`
- 网络请求必须设置超时，敏感配置不写入普通配置文件
- 单模块测试放在对应 Rust module 内，跨模块测试放在 `shell-native/tests/`

## 文件命名

- React 组件：PascalCase，例如 `TopBar.tsx`
- Hooks：camelCase + `use` 前缀，例如 `useTheme.ts`
- 工具函数：camelCase，例如 `ipc.ts`
- 类型定义：PascalCase，例如 `manifest.ts`
- Rust 模块：snake_case
