# aIdea 本地加密存储设计

**日期：** 2026-08-08  
**状态：** 待审阅

## 1. 目标

以 aIdea 平台组件替换邮件和 AI 当前对 macOS Keychain 的直接依赖。后台业务可在重启后静默读取敏感值；用户主动查看明文时使用 macOS Touch ID，认证成功后 5 分钟内复用。

该能力保护本地配置和数据库不会直接暴露明文。它不防御能够读取 aIdea 用户数据目录的本机攻击者，不宣称提供 Keychain 级保护。

## 2. 范围

本期覆盖：

- 邮件账户的密码和客户端授权码。
- AI 模型测试器保存的 API Key。
- 平台内部的保存、读取、删除和列举命名空间凭据能力。
- 旧 Keychain 条目的手动清理说明。

本期不实现：

- 对外安装的官方插件执行 `aidea secret` 命令。
- `/usr/local/bin/aidea` 安装、全局命令发现或完整 CLI 二进制。
- Keychain 自动迁移、第三方插件权限系统或跨设备同步。

`aidea secret` 的命令契约继续保留在 `docs/app/platform-cli.md`；本期先由 Rust 内部模块和 Tauri IPC 使用相同的命名空间模型。

## 3. 存储设计

```text
~/Library/Application Support/aIdea/
├── databases/
│   └── secrets.db
└── secrets.key
```

- `secrets.key` 在首次使用时生成 32 字节随机密钥，并以仅当前用户可读写的文件权限保存。
- `secrets.db` 是平台专用 SQLite。每行保存 `app_id`、`key`、随机 nonce、密文、创建时间和更新时间；`(app_id, key)` 是唯一键。
- 值使用 AES-256-GCM 加密。认证失败、密钥文件无效或密文损坏时返回错误，不返回部分明文，也不自动覆盖原数据。
- 密钥、明文、nonce 和密文不得写入普通日志；插件不能直接访问数据库或密钥文件。
- SQLite 初始化与迁移遵守 `docs/app/storage.md`：外键、WAL、5 秒 busy timeout、事务和迁移前备份。

解密材料与密文均在本机保存是刻意的体验取舍：aIdea 需要在重启后自动同步邮件，且用户明确不使用 Keychain。

## 4. 平台 API

新增 Rust 内部模块 `secret_store`，其最小接口为：

```rust
save(app_id: &str, key: &str, value: &str) -> AppResult<()>
load(app_id: &str, key: &str) -> AppResult<String>
delete(app_id: &str, key: &str) -> AppResult<()>
exists(app_id: &str, key: &str) -> AppResult<bool>
```

`load` 是后台读取接口，不触发 Touch ID。仅在 Tauri IPC 的“查看已保存密码/API Key”路径中，先调用已有 `mac_auth::authenticate_local_user`，再调用 `load`。

命名空间：

| 调用方 | `app_id` | `key` |
| --- | --- | --- |
| 邮件管理 | `mail-manager` | `account:<邮件账户 ID>` |
| AI 模型测试器 | `shell` | `ai:<AI 配置 ID>` |

`key` 必须非空且不包含控制字符；`app_id` 必须使用已知平台或官方插件 ID，避免未来命名空间冲突。

## 5. 邮件行为

`mail_accounts.keychain_id` 是历史字段，保留字段名以避免不必要的邮件数据库迁移，但其值仅作为账户 ID 使用，不再表示 Keychain 条目。

- 新建邮件账户：保存密码或授权码到 `mail-manager / account:<id>`。
- 编辑并填写新密码：覆盖同一个本地加密值。
- 编辑且密码为空：保留现有本地加密值；若不存在，返回“需要重新保存凭据”。
- 手动连接测试：只使用当前表单输入值，不读旧 Keychain。
- 后台同步：从本地加密存储读取；未重新保存的旧账户跳过同步并记录“需要重新保存凭据”，不触发 Keychain。
- 点击眼睛：先 Touch ID，再读取本地加密值；值缺失时提示重新输入。
- 删除账户：只删除本地加密值，不访问旧邮件 Keychain 条目。

## 6. AI 行为

- 保存 AI 配置：将 API Key 保存到 `shell / ai:<配置 ID>`，继续只把 hint、URL、模型和时间放入 `shell.config.json`。
- 历史列表：继续只返回元数据，不返回 API Key。
- 点击查看 AI 配置：先 Touch ID，再读取本地加密值；值缺失时返回“需要重新保存 API Key”。
- 删除或历史容量淘汰：只删除本地加密值，不访问旧 AI Keychain 条目。

## 7. 旧 Keychain 迁移策略

不读取旧 Keychain 中的敏感值，不做自动迁移。升级后已有邮件账户和 AI 历史的元数据仍保留，但用户需要在对应编辑界面重新输入一次凭据。

aIdea 不读取、写入或删除旧 Keychain 条目，避免任何迁移路径再次触发系统授权弹窗。用户完成重新输入后，可在 macOS「钥匙串访问」中手动删除服务名为 `com.aidea.mail-manager` 和 `com.aidea.shell` 的旧条目。这样新版本的运行路径不再依赖旧 Keychain。

## 8. 前端与错误提示

前端保持现有密码输入框和眼睛交互。对于缺少新本地加密凭据的历史配置：

- 邮件账户编辑弹窗明确提示“此账户需要重新保存密码或授权码后才能同步”。
- AI 历史查看失败时提示“此配置需要重新保存 API Key”。
- 不显示 Keychain 术语或要求用户在系统弹窗中授权。

## 9. 测试

- `secret_store` 单元测试覆盖首次建库、保存后读取、覆盖、删除、命名空间隔离、密文篡改和无效密钥。
- 邮件命令测试覆盖新建/编辑/删除使用本地加密存储，且缺失新凭据的旧账户不会访问 Keychain。
- AI 命令测试覆盖保存、读取、淘汰与删除使用本地加密存储。
- 现有 `mac_auth` 缓存逻辑保持不变；前端测试覆盖缺失凭据时的提示和重新输入流程。
- 运行 Rust 相关测试、前端 `npm test`、`npm run lint` 和 `npm run build`。
