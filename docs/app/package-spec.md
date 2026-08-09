# aIdea 官方应用接入契约

本文档定义官方应用由 aIdea 安装和运行时所需的接入定义。它只适用于独立维护的官方应用，不适用于随 aIdea 打包的内置应用。

## 定义位置

官方应用的完整定义固定放在其仓库根目录 `aidea.yaml`。aIdea 随发布包携带的 `plugin-markets/official/<app-id>.yaml` 仅收录仓库地址和启用状态，不重复维护版本、运行命令或应用简介。

`aidea.yaml` 中的 `revision` 必须是完整 Git commit SHA。用户点击刷新市场时，aIdea 使用当前 Git 凭据和 SSH 配置读取应用仓库默认分支中的此文件；安装和更新只 checkout 此 SHA，绝不直接安装浮动分支。

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
update_notes: 首期使用本地 mock 行情。
```

字段约定：

- `schema_version`：当前固定为 `1`。
- `id`：全局唯一的 kebab-case 标识，安装后不可更名。
- `name`、`description`、`category`、`icon`：应用市场的展示信息。
- `version`：三段式语义版本；只有高于本机已安装版本时才显示更新。
- `revision`：40 位十六进制 commit SHA，且必须对应本次 `version` 的源码。
- `min_aidea_version`：该定义可被安装所需的最低 aIdea 版本，使用三段式语义版本。
- `runtime`：运行时说明，例如 `node` 或 `system`。
- `install`：可选安装命令数组，每项均为程序和参数数组。
- `process.command`：启动命令数组；`working_directory` 默认 `.`；`ready_url` 为本地就绪检查地址。
- `settings.enabled`：是否提供设置页；设置页地址固定为应用服务的 `/settings`，aIdea 不读取字段 schema。
- `settings.reset_command`：可选的重置命令数组，使用应用源码目录为工作目录，并通过 `AIDEA_APP_ID`、`AIDEA_APP_DATA_DIR` 和 `AIDEA_APP_LOG_DIR` 获得运行上下文。命令只能重置配置，不能删除整个 `app-data/<app-id>/`。
- `update_notes`：本版本在市场中展示的更新说明。

## 运行和网络约束

- 首期目标平台为 macOS Apple Silicon（`aarch64-apple-darwin`）。
- aIdea 启动本地服务进程后，只在 WebView 打开 `http://127.0.0.1:<port>` 地址；禁止嵌入任意远程 URL。
- 安装、启动命令必须是参数数组；不得使用 shell 字符串、`sh -c` 或 `bash -c`。
- 工作目录必须位于插件安装目录内，不得通过相对路径逃出该目录。
- 健康检查必须是 `http://127.0.0.1:<port>` 地址；健康检查成功前不展示 WebView。
- 私有 GitLab 源可直接使用当前网络、Git 凭据和 SSH 配置；aIdea 不另行保存 Git 密码。

## 安装位置与更新

```text
~/Library/Application Support/aIdea/
└── apps/installed/<app-id>/
    ├── install-state.yaml
    ├── source/
    └── staging/
```

`source/` 是当前运行版本，`staging/` 是更新准备目录。更新必须先完成新版本的依赖安装和健康检查，再替换当前源码。插件业务数据不放在 `source/`；位置和保留规则见 [data-layout.md](data-layout.md)。

`install-state.yaml` 由 aIdea 写入安装版本、固定 revision 和定义快照。定义快照只用于离线恢复已安装应用的启动、展示和卸载，不会替代市场刷新；发现新版本仍以市场返回的版本为准。

## 平台注入

官方应用启动时可获得下列环境变量：

```text
AIDEA_APP_ID
AIDEA_APP_DATA_DIR
AIDEA_APP_LOG_DIR
```

`AIDEA_COMMAND` 要等平台 CLI 实现后才会提供，当前应用不得依赖它。

官方应用的平台通信边界见 [platform.md](platform.md) 和 [platform-cli.md](platform-cli.md)：不得直接调用 Tauri IPC；只有在对应命令已经在平台 CLI 契约中定义并由目标 aIdea 版本提供后，应用才能依赖该命令。

应用可以选择使用 aIdea 数据目录；一旦使用，数据库迁移和数据兼容仍由应用自己负责。

卸载默认只删除 `source/`、依赖和运行时记录，保留 `app-data/<app-id>/`。重新安装同一 `id` 后，应用应读取旧配置并执行自己的迁移。重置设置由 aIdea 发起 Touch ID 后执行，不等同于卸载或删除业务数据。
