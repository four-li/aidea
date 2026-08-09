# aIdea 存储与本地加密规范

本文档定义 aIdea 壳、内置插件和官方插件的 SQLite、迁移与敏感值规则。目录位置见 [data-layout.md](data-layout.md)。

## 数据库边界

aIdea 采用按所有者隔离的 SQLite 数据库，不建立供所有模块任意读写的一张大库。

- `shell.db` 只存 aIdea 壳数据，例如应用排序、最近打开记录和通知索引。
- 每个内置插件使用独立数据库，例如 `mail-manager.db`；不得直接读写其他插件的表。
- 官方插件自行维护业务数据库。选择使用 `AIDEA_APP_DATA_DIR` 后，迁移与兼容仍由插件负责。
- 应用设置由应用自己持有：简单非敏感配置使用应用专属 JSON，复杂配置使用应用专属 SQLite；不把业务设置写入 `shell.config.json`、`shell.db` 或插件源码目录。
- 内置插件之间共享稳定数据时使用 Tauri IPC；官方应用使用平台命令或已定义的平台 API，不通过跨库查询耦合表结构。

每个 SQLite 数据库初始化时必须执行：

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

所有跨表写入必须在事务中完成。列表查询不得默认读取正文、HTML 或二进制等大字段。时间在同一数据库内统一为 UTC Unix 秒或带时区 ISO 8601，优先 UTC Unix 秒。外键和删除行为必须显式声明。

## 迁移与备份

每个数据库拥有独立迁移目录，例如：

```text
shell-native/migrations/shell/
shell-native/migrations/mail-manager/
```

数据库使用 `_migrations` 记录已执行版本与执行时间。迁移按版本顺序、在事务中执行；失败时停止相关功能并保留原库。破坏性变更先复制或重命名旧数据，升级前备份到 `backups/`。SQLite 损坏时关闭写入、保留原文件和错误日志，不自动删除或覆盖。

## 本地加密存储

密码、授权码、OAuth 刷新令牌和 API Key 禁止写入普通配置或业务 SQLite 明文。aIdea 通过 `aidea secret` 将它们保存到平台内部的 `secrets.db`，由平台以对称加密保存密文；插件不直接访问表或解密材料。

为支持重启后的后台同步，解密材料同样保存在本机并由 aIdea 限制文件权限。它的目标是防止配置和数据库直接泄漏明文，不防御能读取 aIdea 用户数据目录的本机攻击者，也不等同于 macOS Keychain 级凭据保护。

后台业务读取敏感值不触发认证。只有用户主动请求在 UI 显示明文时，aIdea 才调用 macOS Touch ID；成功后 5 分钟内可以重复查看。Touch ID 认证结果只保存在内存，aIdea 退出后失效。

平台实现应使用带完整性校验的对称加密，且不得把明文、解密材料或加密后的值输出到普通日志。具体算法和内部表结构是平台实现细节，不作为插件契约。

完整重置设置必须由 aIdea 先完成 Touch ID 认证，再调用应用的重置处理器。处理器只能修改配置范围，不能通过删除整个 `app-data/<app-id>/` 实现重置。
