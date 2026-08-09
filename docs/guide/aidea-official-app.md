# aIdea 官方应用规范

本文档定义官方应用的市场收录、`aidea.yaml`、安装更新和运行契约。它只适用于独立维护的官方应用，不适用于内置应用。

## 定义与市场收录

官方应用的完整定义固定在应用仓库根目录 `aidea.yaml`。aIdea 仓库中的 `plugin-markets/official/<app-id>.yaml` 只收录仓库地址和启用状态：

```yaml
schema_version: 1
repository: https://github.com/owner/repository.git
enabled: true
```

市场刷新时，aIdea 用当前用户的 Git 凭据和 SSH 配置读取应用仓库默认分支的 `aidea.yaml`。aIdea 不保存 Git 密码、Token 或 SSH 私钥。最近一次成功读取的公开定义缓存到 `runtime/market-cache/`；刷新失败继续展示缓存和错误，不影响壳或其他应用。

新增官方应用时，先发布应用仓库，再新增该市场收录文件，然后发布新版 aIdea。已收录应用日常更新只需更新其仓库，用户刷新市场即可发现。

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
- `version` 与 `min_aidea_version` 都使用三段式语义版本；只有市场版本高于本机版本时显示更新。
- `revision` 是本次源码的完整 40 位十六进制 commit SHA；不得使用分支名、tag 或短 SHA。
- `runtime` 是运行时说明，例如 `node` 或 `system`。
- `install`、`process.command` 和 `settings.reset_command` 都是程序及参数数组，不得使用 shell 字符串、`sh -c` 或 `bash -c`。
- `process.working_directory` 默认 `.`，且必须位于安装目录内；`ready_url` 必须是 `http://127.0.0.1:<port>`。
- `settings.enabled` 表示应用提供固定的本地 `/settings` 页面。`reset_command` 只能重置配置，不能删除整个 `app-data/<app-id>/`。

发布顺序必须先提交可安装源码，再在后续提交的 `aidea.yaml` 写入该源码 commit 的 `revision`。不要让配置文件指向包含自身的同一提交，这会形成无法验证的自引用。

## 安装、更新与网络

```text
~/Library/Application Support/aIdea/apps/installed/<app-id>/
├── install-state.yaml
├── source/
└── staging/
```

安装和更新都先在临时 staging 目录获取固定 revision、执行安装命令并完成健康检查，再替换当前 `source/`。失败时保留旧版本和错误日志。`install-state.yaml` 记录安装版本、固定 revision 和定义快照，只用于离线恢复已安装应用，不能替代市场刷新。

官方应用服务只监听 `127.0.0.1`，WebView 只打开本地地址，健康检查成功前不展示 WebView。工作目录不得借相对路径逃出安装目录。

## 数据、凭据与 UI

业务数据放在 `AIDEA_APP_DATA_DIR`，日志写入 `AIDEA_APP_LOG_DIR`，不得写入源码目录。SQLite、迁移和备份遵守 [存储规范](aidea-storage.md)。

当前 aIdea 尚未向官方应用提供凭据命令或 `AIDEA_COMMAND`。需要平台保管敏感值的官方应用尚不属于已发布能力，必须先完成平台命令实现；不得直接读写 aIdea 的 `secrets.db`、密钥文件或 Tauri IPC。

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
