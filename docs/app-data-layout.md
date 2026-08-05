# aIdea 数据目录规范

本文档定义 aIdea 在 macOS Apple Silicon 上的长期文件边界。应用升级不得改变用户数据目录，也不得把用户配置写入 `.app` 包。

## 1. 应用包

`aIdea.app` 只包含 aIdea 自身的可发布内容：壳程序、前端资源、内置应用源码和内置 manifest。内置应用随 aIdea 版本发布，不能由用户目录覆盖其源码。

## 2. 用户数据根目录

用户数据根目录固定为：

```text
~/Library/Application Support/aIdea/
```

目录结构：

```text
aIdea/
├── shell.config.json
├── apps/
│   ├── installed/<app-id>/manifest.yaml
│   └── local/<app-id>.yaml
├── runtime/
│   ├── processes/
│   └── state/
└── backups/
```

- `shell.config.json`：主题、应用 overrides、AI 历史元数据等用户级配置。
- `apps/installed/`：通过 GitHub 等来源安装的应用 manifest；源码目录由 manifest 的 `path` 指向。
- `apps/local/`：用户手工添加的本地应用 manifest。
- `runtime/`：aIdea 自己产生的进程状态和临时运行信息，不存放子应用业务数据库。
- `backups/`：配置格式迁移前的备份。

## 3. 日志和缓存

```text
~/Library/Logs/aIdea/
~/Library/Caches/aIdea/
```

aIdea 日志放在 `Logs`，下载包和解压临时文件放在 `Caches`。子应用日志默认由子应用自己管理；aIdea 只读取 manifest 中明确配置的日志文件。

## 4. 凭证

完整 AI API Key 只保存到 macOS Keychain，服务标识为 `com.aidea.shell`。`shell.config.json` 只能保存服务地址、模型、key hint、配置 ID 和保存时间，禁止保存完整 API Key。

## 5. 内置与第三方应用边界

内置应用 manifest 是编译时资源，和 aIdea 一起升级。第三方应用的源码、数据库、虚拟环境和 Node/Python 环境由子应用自己负责，aIdea 只管理安装元数据、启动、停止和 WebView 展示，不回写第三方仓库。

## 6. 迁移规则

首次启动新版本时，如果用户目录不存在：

1. 备份已有用户配置（如存在）。
2. 从开发目录的 `shell.config.json` 迁移配置。
3. 从开发目录 `apps/` 迁移非内置 manifest 到 `apps/local/`。
4. 不移动第三方源码目录。
5. 写入迁移完成标记，后续启动不重复迁移。

升级只替换 `aIdea.app`，保留整个用户数据根目录。
