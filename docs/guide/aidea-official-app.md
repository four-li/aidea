# aIdea 官方应用规范

本文档定义官方应用的市场收录、`aidea.yaml`、安装更新和运行契约。它只适用于独立维护的官方应用，不适用于内置应用。

## 定义与市场收录

官方应用进入市场时，完整定义固定在应用仓库根目录 `aidea.yaml`。开搞内置的 `market-source.yaml` 指向官方市场 Git 仓库；该仓库中的 `official/<app-id>.yaml` 只收录仓库地址和启用状态：

```yaml
schema_version: 1
repository: https://gitee.com/aidea-org/example.git
enabled: true
```

当前官方仓库位置如下。本机路径是开发约定，不是运行时契约；开搞运行时只依赖远程地址和刷新后的缓存。

| 内容 | 远程地址 | 本机开发路径 |
| --- | --- | --- |
| 官方市场收录 | `https://gitee.com/aidea-org/aidea-market.git` | `/Users/fourli/Desktop/app/aidea-apps/aidea-market/` |
| 官方应用 | `https://gitee.com/aidea-org/<app-id>.git` | `/Users/fourli/Desktop/app/aidea-apps/<app-id>/` |

市场链路固定为：开搞的 `market-source.yaml` -> 市场仓库 `official/<app-id>.yaml` -> 应用仓库 `aidea.yaml`。市场收录只决定哪些官方应用可见及其仓库地址；应用定义决定展示信息、固定源码版本或预编译包、架构和运行命令。

市场刷新时，开搞先拉取市场仓库的 `official/` 目录，再用当前用户的 Git 凭据和 SSH 配置读取应用仓库默认分支的 `aidea.yaml`。开搞不保存 Git 密码、Token 或 SSH 私钥。只有市场目录和全部已启用应用定义都读取成功时，才整体替换 `runtime/market-cache/`；刷新失败继续展示最近一次成功缓存和错误，不影响壳或其他应用。

新增官方应用时，先发布应用仓库，再新增或修改市场仓库中的收录文件并发布市场仓库。用户刷新市场即可获取这些变化，无需发布新版开搞。只有 `market-source.yaml` 的市场入口或协议变更时才需要发布开搞。

## `aidea.yaml`

以下是**仅供本地开发验证**的源码安装格式，不能作为新的正式市场应用定义。当前 Node、Python 等系统运行时没有安装前环境检查，正式发布请使用后面的 `runtime: binary` 示例：

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
update_notes: 首期版本。
```

预编译 `binary` v1 已支持 macOS Apple Silicon（arm64），不支持 Intel 包、架构选择或回退。它固定使用单个 Gitee Release `.tar.gz` 附件和 SHA-256：

```yaml
runtime: binary
artifact:
  url: https://gitee.com/aidea-org/mail-center/releases/download/v0.1.6/mail-center-0.1.6-darwin-arm64.tar.gz
  sha256: 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
process:
  command: [mail-center]
  working_directory: .
  ready_url: http://127.0.0.1:43130/health
```

`artifact` 只能含 `url` 和 `sha256`，不能与 `install` 同时声明。URL 必须是 `https://gitee.com/.../releases/download/...` 下的 `.tar.gz`；`sha256` 必须是 64 位十六进制。包顶层必须只有一个目录，包内必须包含启动二进制和所需资源；aIdea 拒绝绝对路径、`..`、符号链接和硬链接。解压后的包根内容装入既有 `source/`，不会新建 `app/` 或 `payload/` 目录。

- `schema_version` 当前固定为 `1`。
- `id` 使用全局唯一的 kebab-case，安装后不可更名。
- `name`、`description`、`category`、`icon` 是市场展示信息。
- `version` 与 `min_aidea_version` 都使用三段式语义版本；`aidea.yaml` 建立后，只要用户可见功能、界面、交互、设置页、数据格式或行为有变化，就必须更新 `version`；纯重构、测试和文档不要求升版本。默认使用 patch 版本递增，只有兼容性范围变化时才升 minor 或 major。定义建立前，应用自己的发布版本仍必须与实际行为一致。
- `revision` 是本次源码的完整 40 位十六进制 commit SHA；不得使用分支名、tag 或短 SHA。
- 正式市场应用的 `runtime` 必须是 `binary`。`node`、`python`、`system` 等源码安装仍依赖用户系统运行时；虽然安装器保留相关实现，但 Python、Node 的环境检查尚未实现，只能用于本地开发验证，不能作为新的正式发布路径。`binary` 使用上述单个 arm64 预编译包，包内必须带齐运行时和依赖。
- `install` 和 `process.command` 都是程序及参数数组，不得使用 shell 字符串、`sh -c` 或 `bash -c`。
- `process.working_directory` 默认 `.`，且必须位于安装目录内；`ready_url` 必须是 `http://127.0.0.1:<port>`。
- binary 的 `process.command[0]` 可以是裸命令，例如 `mail-center`。aIdea 会将解压后包根目录置于该子进程 `PATH` 的最前面，供正式启动和 staging 健康检查共同使用；不支持 `process.path` 或多目录配置。
- 官方应用不得在 `aidea.yaml` 声明 `settings` 或 `settings.reset_command`。账户、同步周期和其他业务配置由应用自己的主页面提供入口、校验和保存；不要把业务字段塞进 manifest，也不要期待 aIdea 提供统一表单。

发布顺序必须先提交可安装源码，再在后续提交的 `aidea.yaml` 写入该源码 commit 的 `revision`。不要让配置文件指向包含自身的同一提交，这会形成无法验证的自引用。

## 安装、更新与网络

```text
~/Library/Application Support/aIdea/apps/installed/<app-id>/
├── install-state.yaml
├── source/
└── staging/
```

安装和更新都先在临时 staging 目录获取固定 revision 或预编译包、执行安装/解压步骤，并通过 `/health` 健康检查后再替换当前版本。binary 下载完成后必须先校验 SHA-256；包校验、解压或 staging 检查失败时清理 staging 并保留旧版本。staging 检查使用临时数据和日志目录，不触碰正式业务数据。运行中的应用更新后若新版本不能启动，aIdea 恢复旧 `source/`、旧安装记录和原运行状态。`install-state.yaml` 记录安装版本、来源、固定 revision 或产物校验信息及定义快照，只用于离线恢复已安装应用，不能替代市场刷新。

安装日志中的 `git checkout <完整 SHA>` 会进入 detached HEAD，这是按固定源码版本安装的正常状态，不需要 `git switch`。打包版 aIdea 不继承 Finder 启动时的终端 `PATH`；安装器会自动查找系统目录和用户级 `~/.local/bin`、`~/.npm-global/bin`、`~/.bun/bin` 中的运行时命令。

官方应用服务只监听 `127.0.0.1`，WebView 只打开本地地址，健康检查成功前不展示 WebView。工作目录不得借相对路径逃出安装目录。

应用主页面会收到 aIdea 追加的 `aidea_theme=light|dark` 查询参数。页面优先使用该参数适配主题；独立运行时没有该参数，则使用系统的 `prefers-color-scheme`。

应用主页面加载后按 [App Bridge 契约](aidea-app-bridge.md) 发送 `ready`，运行时主题通过 `theme` 消息同步。跨源 iframe 中不能读取 `window.parent.origin`；应用必须从 `document.referrer` 获取并精确校验壳 origin，只允许 `tauri://localhost` 和 `http://localhost:5173`，拿不到合法来源时作为独立页面运行、不握手。官方应用需要的通知和应用内跳转也通过 App Bridge 完成，不得依赖 Tauri IPC。搜索属于应用页面自身能力，遵守 [应用内搜索规范](aidea-search.md)。

官方应用必须提供 `GET /health`：快速返回 `200` JSON，例如 `{"status":"ok"}`；只表示服务可用，不检查外部依赖。

## 应用设置、数据与凭据

aIdea 的应用管理只保存通用运行偏好：是否显示在主页，以及是否随 aIdea 启动。官方应用的业务配置（例如邮件账户、同步周期和服务商选项）由应用自己的主页面负责展示、校验和保存；不要把业务字段塞进 aIdea manifest，也不要期待 aIdea 提供统一表单。

启动时 aIdea 注入以下环境变量，官方应用直接使用它们，不需要猜测目录：

| 变量 | 用途 |
| --- | --- |
| `AIDEA_APP_ID` | 当前应用 ID，只用于标识应用。 |
| `AIDEA_APP_DATA_DIR` | 当前应用的数据目录；数据库固定为其中的 `app.db`。 |
| `AIDEA_APP_LOG_DIR` | 当前应用的日志目录。 |

业务数据和配置统一放在 `AIDEA_APP_DATA_DIR/app.db`，日志写入 `AIDEA_APP_LOG_DIR`，不得写入源码目录。密码、授权码等敏感值也属于应用自己的数据，但不得写入日志。SQLite、迁移和备份遵守 [存储规范](aidea-storage.md)。

官方应用不读取 aIdea 壳数据库，也不依赖平台凭据服务。应用直接读写自己的 `app.db`。

## 邮件官方应用

邮件官方应用固定使用应用 ID `mail-center` 和自己的 `AIDEA_APP_DATA_DIR/app.db`。它是独立应用，不迁移、不读取、不兼容旧内置邮件的账户、索引、凭据或数据库；aIdea 壳也不提供旧内置邮件的兼容层。

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
