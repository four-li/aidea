# aIdea 官方应用规范

本文档定义官方应用的市场收录、`aidea.yaml`、安装更新和运行契约。它只适用于独立维护的官方应用，不适用于内置应用。

## 定义与市场收录

官方应用的完整定义固定在应用仓库根目录 `aidea.yaml`。开搞内置的 `market-source.yaml` 指向官方市场 Git 仓库；该仓库中的 `official/<app-id>.yaml` 只收录仓库地址和启用状态：

```yaml
schema_version: 1
repository: https://gitee.com/aidea-org/example.git
enabled: true
```

当前官方仓库位置如下。本机路径是开发约定，不是运行时契约；开搞运行时只依赖远程地址和刷新后的缓存。

| 内容 | 远程地址 | 本机开发路径 |
| --- | --- | --- |
| 官方市场收录 | `https://gitee.com/aidea-org/aidea-market.git` | `/Users/fourli/Desktop/app/aidea-plugins/aidea-market/` |
| 官方应用 | `https://gitee.com/aidea-org/<app-id>.git` | `/Users/fourli/Desktop/app/aidea-plugins/<app-id>/` |

市场链路固定为：开搞的 `market-source.yaml` -> 市场仓库 `official/<app-id>.yaml` -> 应用仓库 `aidea.yaml`。市场收录只决定哪些官方应用可见及其仓库地址；应用定义决定展示信息、固定源码版本和运行命令。

市场刷新时，开搞先拉取市场仓库的 `official/` 目录，再用当前用户的 Git 凭据和 SSH 配置读取应用仓库默认分支的 `aidea.yaml`。开搞不保存 Git 密码、Token 或 SSH 私钥。只有市场目录和全部已启用应用定义都读取成功时，才整体替换 `runtime/market-cache/`；刷新失败继续展示最近一次成功缓存和错误，不影响壳或其他应用。

新增官方应用时，先发布应用仓库，再新增或修改市场仓库中的收录文件并发布市场仓库。用户刷新市场即可获取这些变化，无需发布新版开搞。只有 `market-source.yaml` 的市场入口或协议变更时才需要发布开搞。

## `aidea.yaml`

```yaml
schema_version: 1
id: stock-assistant
name: 股票助手
description: 本地股票自选列表
category: 金融
version: 0.1.0
icon: TrendingUp
revision: d351c25ac9a970abb1e13016dcf26128fa8e200b
min_aidea_version: 0.1.4
runtime: node
install:
  - [npm, ci]
process:
  command: [node, node_modules/vite/bin/vite.js, --host, 127.0.0.1, --port, '43120']
  working_directory: .
  ready_url: http://127.0.0.1:43120/health
settings:
  enabled: true
  reset_command: [node, scripts/reset-config.mjs]
update_notes: 首期版本。
```

- `schema_version` 当前固定为 `1`。
- `id` 使用全局唯一的 kebab-case，安装后不可更名。
- `name`、`description`、`category`、`icon` 是市场展示信息。
- `version` 与 `min_aidea_version` 都使用三段式语义版本；只要用户可见功能、界面、交互、设置页、数据格式或行为有变化，就必须更新 `version`；纯重构、测试和文档不要求升版本。默认使用 patch 版本递增，只有兼容性范围变化时才升 minor 或 major。
- `revision` 是本次源码的完整 40 位十六进制 commit SHA；不得使用分支名、tag 或短 SHA。
- `runtime` 是运行时说明，例如 `node` 或 `system`。
- `install`、`process.command` 和 `settings.reset_command` 都是程序及参数数组，不得使用 shell 字符串、`sh -c` 或 `bash -c`。
- `process.working_directory` 默认 `.`，且必须位于安装目录内；`ready_url` 必须是 `http://127.0.0.1:<port>`。
- aIdea 始终在应用列表提供通用设置入口，并在设置弹窗中打开固定的本地 `/settings` 页面，不解析页面字段；即使暂时没有业务字段，应用也应提供可打开的空设置页。`settings.enabled` 是当前 manifest 的兼容字段，不控制入口；Rust 代码只在它为 `true` 时接受 `reset_command`。`reset_command` 只能重置配置，不能删除整个 `app-data/<app-id>/`。

发布顺序必须先提交可安装源码，再在后续提交的 `aidea.yaml` 写入该源码 commit 的 `revision`。不要让配置文件指向包含自身的同一提交，这会形成无法验证的自引用。

## 安装、更新与网络

```text
~/Library/Application Support/aIdea/apps/installed/<app-id>/
├── install-state.yaml
├── source/
└── staging/
```

安装和更新都先在临时 staging 目录获取固定 revision、执行安装命令并完成健康检查，再替换当前 `source/`。失败时保留旧版本和错误日志。`install-state.yaml` 记录安装版本、固定 revision 和定义快照，只用于离线恢复已安装应用，不能替代市场刷新。

安装日志中的 `git checkout <完整 SHA>` 会进入 detached HEAD，这是按固定源码版本安装的正常状态，不需要 `git switch`。打包版 aIdea 不继承 Finder 启动时的终端 `PATH`；安装器会自动查找系统目录和用户级 `~/.local/bin`、`~/.npm-global/bin`、`~/.bun/bin` 中的运行时命令。

官方应用服务只监听 `127.0.0.1`，WebView 只打开本地地址，健康检查成功前不展示 WebView。工作目录不得借相对路径逃出安装目录。

应用页面和 `/settings` 页面都会收到 aIdea 追加的 `aidea_theme=light|dark` 查询参数。页面优先使用该参数适配主题；独立运行时没有该参数，则使用系统的 `prefers-color-scheme`。

## 应用设置、数据与凭据

aIdea 的应用管理只保存通用运行偏好：是否显示应用，以及是否随 aIdea 启动。官方应用的业务配置（例如邮件账户、同步周期和服务商选项）由应用自己的 `/settings` 页面负责展示、校验和保存；不要把业务字段塞进 aIdea manifest，也不要期待 aIdea 提供统一表单。

启动时 aIdea 注入以下环境变量，官方应用直接使用它们，不需要猜测目录：

| 变量 | 用途 |
| --- | --- |
| `AIDEA_APP_ID` | 当前应用 ID，只用于标识应用。 |
| `AIDEA_APP_DATA_DIR` | 当前应用的数据目录；数据库固定为其中的 `app.db`。 |
| `AIDEA_APP_LOG_DIR` | 当前应用的日志目录。 |

业务数据和配置统一放在 `AIDEA_APP_DATA_DIR/app.db`，日志写入 `AIDEA_APP_LOG_DIR`，不得写入源码目录。密码、授权码等敏感值也属于应用自己的数据，但不得写入日志。SQLite、迁移和备份遵守 [存储规范](aidea-storage.md)。

官方应用不读取 aIdea 壳数据库，也不依赖平台凭据服务。应用直接读写自己的 `app.db`。

UI 遵守 [UI 规范](aidea-ui.md)，并同时验证浅色和深色主题。邮件正文、Markdown、富文本和第三方 HTML 必须独立验证可读性。

## 发布前检查

```bash
npm test
npm run build
git diff --check
git rev-parse --verify <revision>^{commit}
git show <revision>:aidea.yaml
```

同时确认：版本符合语义版本、`revision` 是完整 SHA、命令不越出安装目录、健康检查是本地地址、日志不含敏感值。应用自身提交、推送和发布由用户明确授权；aIdea 的发布只使用 `$aidea-release`。
