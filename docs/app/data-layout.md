# aIdea 数据目录规范

本文档定义 macOS 上 aIdea 和官方插件的长期文件边界。升级不得改变用户数据目录，也不得将用户配置写进 `.app` 包或插件源码目录。

## 用户数据根目录

```text
~/Library/Application Support/aIdea/
├── shell.config.json
├── databases/
│   ├── shell.db
│   ├── secrets.db
│   └── <builtin-app-id>.db
├── apps/
│   └── installed/<app-id>/
│       ├── install-state.yaml
│       ├── source/
│       └── staging/
├── app-data/<app-id>/
├── logs/<app-id>/
├── runtime/
│   ├── market-cache/<catalog-file-stem>/
│   │   ├── aidea.yaml
│   │   └── metadata.json
│   ├── processes/
│   └── state/
└── backups/
```

- `shell.config.json` 只保存主题、应用覆盖配置和非敏感元数据，禁止保存密码、授权码、令牌或 API Key 明文。
- `databases/shell.db` 只保存 aIdea 壳数据；每个内置插件使用独立的 `<builtin-app-id>.db`。
- `databases/secrets.db` 是平台本地加密存储的内部数据库，插件不得直接读写。
- `apps/installed/<app-id>/` 是 aIdea 管理的安装状态、源码和更新临时目录；安装状态使用 `install-state.yaml`，不能与本地可启动应用的 `manifest.yaml` 混用。
- `app-data/<app-id>/` 和 `logs/<app-id>/` 属于插件业务数据与日志。更新和默认卸载不得删除它们。
- `runtime/` 只存短期进程状态、市场定义缓存和临时运行信息，不存业务数据库。市场缓存只保存公开的应用定义与刷新元数据，不保存 Git 凭据。
- `backups/` 存放迁移前的数据备份。

日志和缓存的系统位置分别为：

```text
~/Library/Logs/aIdea/
~/Library/Caches/aIdea/
```

## 应用包与迁移

`aIdea.app` 只包含可发布的壳程序、前端资源、内置插件代码和内置 manifest。首次启动需要迁移旧开发目录配置时，应先备份、只迁移非内置应用配置、写入迁移完成标记；不得移动第三方源码或重复迁移。

升级只替换 `aIdea.app`，完整保留本目录。数据库和本地加密存储规则见 [storage.md](storage.md)。
