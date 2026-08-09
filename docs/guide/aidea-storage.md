# aIdea 数据与存储规范

本文档定义 aIdea、内置应用和官方应用的长期文件边界、SQLite 迁移和敏感值规则。升级不得改变用户数据目录，也不得把用户配置写进 `.app` 包或应用源码目录。

## 用户数据根目录

```text
~/Library/Application Support/aIdea/
├── shell.config.json
├── databases/
│   ├── shell.db
│   ├── secrets.db
│   └── <builtin-app-id>.db
├── apps/installed/<app-id>/
├── app-data/<app-id>/
├── logs/<app-id>/
├── runtime/
└── backups/
```

- `shell.config.json` 只保存主题、应用覆盖配置和非敏感元数据，不保存密码、授权码、令牌或 API Key 明文。
- `shell.db` 只保存壳数据；每个内置应用使用独立的 `<builtin-app-id>.db`，不得直接读写其他应用的表。
- `secrets.db` 和同级密钥文件是 aIdea 内部实现，应用不得直接访问。
- `apps/installed/<app-id>/` 只保存官方应用安装状态、源码和 staging 环境。业务数据放在 `app-data/<app-id>/`，更新和默认卸载不得删除。
- `runtime/` 只保存市场定义缓存、进程状态等短期信息，不保存业务数据库或 Git 凭据。
- `backups/` 保存迁移前备份。

系统日志和缓存位置分别是 `~/Library/Logs/aIdea/` 与 `~/Library/Caches/aIdea/`。

## SQLite

每个数据库初始化时执行：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

数据库按所有者隔离：壳、内置应用和官方应用不共享业务表。跨表写入必须在事务中完成；列表查询不得默认读取正文、HTML 或二进制大字段；时间统一使用 UTC Unix 秒或带时区 ISO 8601；外键和删除行为必须显式声明。

每个数据库使用自己的迁移目录和 `_migrations` 记录。迁移按版本顺序、在事务中执行；破坏性变更前先备份。失败时停止相关功能并保留原库，不自动删除或覆盖损坏数据。

## 敏感值

密码、授权码、OAuth 刷新令牌和 API Key 不得写入普通配置、业务 SQLite 或日志。

当前壳内部的 `SecretStore` 只供 aIdea 自己和内置应用经 Tauri IPC 使用；`secrets.db` 不对官方应用开放。官方应用平台命令尚未发布，不能依赖 `aidea secret`，也不能自行读取壳的加密数据库或密钥文件。需要该能力时，先实现并发布平台命令，再更新本规范和 `aidea-app` Skill。

本地加密、密钥权限和 Touch ID 的具体实现属于壳内部实现，不是官方应用当前可调用的接口。

## 应用包与升级

`aIdea.app` 只包含壳程序、前端资源、内置应用代码和内置 manifest。升级只替换应用包，完整保留本目录。开发目录迁移必须先备份，写入迁移完成标记，并且只迁移明确支持的配置。
