# aIdea 应用存储规范

本文档定义 aIdea 本体和内置子应用的持久化数据规则。目录位置见
[app-data-layout.md](app-data-layout.md)；外部应用的安装和运行边界见
[app-package-spec.md](app-package-spec.md)。

## 1. 数据库边界

aIdea 使用“按所有者隔离”的 SQLite 数据库，不建立所有模块共用的一张大库：

```text
~/Library/Application Support/aIdea/
├── databases/
│   ├── shell.db
│   └── <builtin-app-id>.db
└── apps/
    ├── installed/<app-id>/data/<app-id>.db
    └── local/<app-id>/data/<app-id>.db
```

- `shell.db` 只存 aIdea 壳的数据，例如应用排序、最近打开记录和通知索引。
- 每个内置子应用使用自己的数据库，例如 `mail-manager.db`。
- 内置子应用不得直接读写其他内置子应用的表。
- aIdea 与内置子应用需要共享数据时，使用 Tauri IPC，不通过跨库查询耦合表结构。
- `owned` 外部应用可以遵守本规范；`external` 第三方应用继续管理自己的数据库，aIdea 不迁移或读取其业务表。

数据库文件不放在 `.app` 包、源码目录或日志目录中。

## 2. SQLite 基础规则

每个数据库首次使用时必须完成初始化，并执行以下设置：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

规则：

1. 所有跨表写入必须放在事务中。
2. 列表查询不得默认读取大字段，正文、HTML、二进制内容单独存表。
3. 时间统一保存为 UTC Unix 秒或带时区的 ISO 8601 字符串；同一数据库只能选一种，优先使用 Unix 秒。
4. 主键使用应用生成的稳定字符串或 SQLite 整数主键；远程系统的 UID 不得直接作为全局主键。
5. 外键必须显式声明，删除行为必须在表结构中明确（`CASCADE`、`SET NULL` 或拒绝删除）。
6. 密码、授权码、OAuth 刷新令牌和 API Key 不得写入 SQLite，统一放 macOS Keychain。

当前不引入 ORM。Rust 侧使用 SQL 初始化和迁移，业务层用明确的数据结构映射查询结果；只有查询模式明显重复时才抽取共享辅助函数。

## 3. 迁移

每个数据库拥有独立的迁移目录：

```text
shell-native/migrations/shell/
shell-native/migrations/mail-manager/
```

数据库内部维护 `_migrations` 表，记录已执行的迁移版本和执行时间。迁移必须：

- 按版本号顺序执行，不能依赖当前代码版本猜测状态；
- 在事务中完成；
- 失败时停止启动相关功能，并保留原数据库；
- 不删除用户数据，破坏性变更必须先复制或重命名旧数据；
- 在升级前把数据库备份到 `backups/`。

迁移只允许修改所属数据库，不得跨应用直接改表。

## 4. 备份、清理与错误处理

- 数据库迁移前备份到 `~/Library/Application Support/aIdea/backups/`。
- 缓存型数据可以按子应用策略清理，但业务数据必须由用户操作或明确保留策略触发清理。
- SQLite 损坏时先关闭写入，保留原文件和错误日志，不自动删除或覆盖用户数据。
- WAL、SHM 文件属于数据库运行文件，正常退出时由 SQLite 管理；备份时应在关闭连接或使用 SQLite 在线备份能力后复制。

## 5. 跨应用数据

跨应用共享只允许共享“稳定契约”，不共享内部表：

- 邮件中心负责判断邮件是否重要，并通过 IPC 或壳命令提交通知索引；
- aIdea 壳负责展示统一通知，不复制整封邮件正文；
- 其他子应用需要邮件数据时，通过已定义的 IPC 查询，不直接打开 `mail-manager.db`。

新增共享数据前，先确认是否确实存在两个以上消费者；只有一个消费者时，数据留在所属子应用数据库中。
