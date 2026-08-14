# aIdea 数据与存储规范

本文档定义 aIdea、内置应用和官方应用的目标文件边界、SQLite 迁移和敏感值规则。升级不得改变用户数据目录，也不得把用户配置写进 `.app` 包或应用源码目录。

## 用户数据根目录

```text
~/Library/Application Support/aIdea/
├── shell.config.json
├── apps/installed/<app-id>/
├── app-data/<app-id>/
│   └── app.db
├── logs/<app-id>/
├── runtime/
└── backups/
```

- `shell.config.json` 只保存应用显示/启动偏好，不保存应用业务字段；主题由壳前端自己的主题设置管理。
- `apps/installed/<app-id>/` 只保存官方应用安装状态、解压后的 binary 包和 staging 环境。业务数据放在 `app-data/<app-id>/`，更新和默认卸载不得删除。
- 每个内置应用和官方应用都拥有自己的 `app-data/<app-id>/app.db`。应用自己创建数据库、执行迁移和读写业务表，不读 aIdea 或其他应用的数据库。
- `databases/mail-manager.db`、`app-data/mail-manager/`、`logs/mail-manager/`、独立凭据存储和 DevTools `settings.json` 是已废弃的历史路径。aIdea 新代码不得读取或写入，也不自动删除这些路径。邮件官方应用固定使用 `mail-center`，直接创建自己的 `app-data/mail-center/app.db`，不读取旧数据。
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

数据库按应用隔离：每个应用只有自己的 `app.db`，不共享业务表。跨表写入必须在事务中完成；列表查询不得默认读取正文、HTML 或二进制大字段；时间统一使用 UTC Unix 秒或带时区 ISO 8601；外键和删除行为必须显式声明。

每个数据库使用自己的迁移目录和 `_migrations` 记录。迁移按版本顺序、在事务中执行；破坏性变更前先备份。失败时停止相关功能并保留原库，不自动删除或覆盖损坏数据。

## 敏感值

密码、授权码、OAuth 刷新令牌和 API Key 可以写入应用自己的 `app.db`，但不得写入日志。aIdea 不提供独立的凭据数据库和凭据命令。

应用自行决定数据库字段和业务校验；aIdea 不解析应用表结构，也不访问应用数据库内容。

## 应用包与升级

`aIdea.app` 只包含壳程序、前端资源、内置应用代码和内置 manifest。升级只替换应用包，完整保留本目录。开发目录迁移必须先备份，写入迁移完成标记，并且只迁移明确支持的配置。
