# aIdea 官方插件接入契约

本文档定义官方插件由 aIdea 安装和运行时所需的接入定义。它只适用于独立维护的官方插件，不适用于内置插件。

## 官方定义

`plugin-markets/official/<app-id>.yaml` 至少必须声明：

- `id`：全局唯一的 kebab-case 标识，安装后不可更名。
- 名称、简介、分类、图标和插件版本。
- 源码仓库地址，以及固定的 tag 或完整 commit。
- 运行时类型、安装命令、启动命令和本地健康检查地址。
- 支持的 aIdea 版本范围、插件数据目录约定和更新说明。

官方定义是 aIdea 管理的接入配置，不写回插件仓库。插件仓库不需要提供 `aidea.yaml`。

当前 YAML 格式如下，`revision` 必须使用完整 Git commit SHA：

```yaml
id: stock-assistant
name: 股票助手
description: 本地股票自选列表
category: 金融
version: 0.1.0
icon: TrendingUp
repository: https://github.com/four-li/stock-assistant.git
revision: d351c25ac9a970abb1e13016dcf26128fa8e200b
runtime: node
install:
  - [npm, ci]
process:
  command: [node, node_modules/vite/bin/vite.js, --host, 127.0.0.1, --port, "43120"]
  working_directory: .
  ready_url: http://127.0.0.1:43120/health
update_notes: 首期使用本地 mock 行情。
```

## 运行和网络约束

- 首期目标平台为 macOS Apple Silicon（`aarch64-apple-darwin`）。
- aIdea 启动本地服务进程后，只在 WebView 打开 `http://127.0.0.1:<port>` 地址；禁止嵌入任意远程 URL。
- 安装、启动命令必须是参数数组；不得使用 shell 字符串或 `sh -c`。
- 工作目录必须位于插件安装目录内，不得通过相对路径逃出该目录。
- 健康检查必须是本地地址；健康检查成功前不展示 WebView。
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

## 平台注入

官方插件启动时可获得下列环境变量：

```text
AIDEA_APP_ID
AIDEA_APP_DATA_DIR
AIDEA_APP_LOG_DIR
```

`AIDEA_COMMAND` 要等平台 CLI 实现后才会提供，当前插件不得依赖它。

插件可以选择使用 aIdea 数据目录；一旦使用，数据库迁移和数据兼容仍由插件自己负责。
