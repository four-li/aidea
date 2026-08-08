# aIdea 本地加密存储实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 aIdea 本地加密存储替换邮件和 AI 对 macOS Keychain 的依赖，并保留 Touch ID 查看明文的 5 分钟认证体验。

**Architecture:** 新增平台内部 `secret_store`，将 AES-256-GCM 密文放入独立 `secrets.db`，随机对称密钥放入受限权限的用户数据文件。邮件与 AI 只通过带应用命名空间的存储接口读写；不读取旧 Keychain，旧凭据由用户重新输入一次。

**Tech Stack:** Rust、rusqlite、AES-256-GCM、rand_core、Tauri IPC、现有 macOS LocalAuthentication、Vitest。

## Global Constraints

- 后台同步和网络请求读取凭据时不得触发 Touch ID 或 Keychain。
- 只有前端主动查看明文的 IPC 调用 Touch ID，认证缓存沿用现有 5 分钟逻辑。
- 旧 Keychain 不读取、不自动迁移，也不由 aIdea 删除；用户在钥匙串访问中手动清理旧条目。
- 敏感值、密钥、nonce 和密文不得写入配置文件、业务 SQLite 明文或日志。
- 本地加密存储不承诺 Keychain 级本机攻击防护。
- 不实现 `aidea` 全局 CLI、插件市场安装器或第三方插件能力。
- 不自动执行 Git 提交、合并或推送。

---

### Task 1: 实现平台本地加密存储

**Files:**
- Modify: `shell-native/Cargo.toml`
- Create: `shell-native/src/secret_store.rs`
- Modify: `shell-native/src/lib.rs`

**Interfaces:**
- Produces: `secret_store::save(app_id, key, value)`, `load(app_id, key)`, `delete(app_id, key)`、`exists(app_id, key)`，均返回 `AppResult`。
- Consumes: 现有用户数据目录定位、`AppError`、rusqlite。

- [ ] 添加 `aes-gcm` 和 `rand_core` 的最小依赖；不引入 ORM 或密钥管理框架。
- [ ] 首次调用时创建 `databases/secrets.db` 与 32 字节 `secrets.key`，密钥文件权限设为 `0600`。
- [ ] 初始化 SQLite 的 `foreign_keys`、WAL、`busy_timeout=5000`，创建以 `(app_id, key)` 唯一的密文表。
- [ ] 每次保存使用新的随机 nonce；以 AES-256-GCM 加密并在事务中 upsert。
- [ ] 对空 ID、空 key、控制字符、无效密钥和损坏密文返回 `AppError::Config`，不泄露敏感值。
- [ ] 编写模块单元测试：首次保存读取、覆盖、删除、命名空间隔离、篡改密文失败、无效密钥失败。
- [ ] 运行：`cargo test secret_store --manifest-path shell-native/Cargo.toml`。

### Task 2: 接入邮件凭据

**Files:**
- Modify: `shell-native/src/commands/mail.rs`
- Modify: `shell-native/src/mail_sync.rs`
- Modify: `shell-native/tests/mail_command_test.rs`
- Modify: `shell-native/tests/mail_sync_test.rs`
- Modify: `shell-frontend/src/builtin-apps/mail-manager/AccountDialog.tsx`
- Modify: `shell-frontend/tests/mail-manager/AccountDialog.test.tsx`

**Interfaces:**
- Consumes: `secret_store` 的 `mail-manager / account:<account-id>` 命名空间和既有 `mac_auth::authenticate_local_user`。
- Produces: 邮件保存、同步、查看和删除都不读取 Keychain；旧账户缺少新凭据时提供“重新保存”错误。

- [ ] 保存新建或编辑账户时写 `secret_store`；密码为空的已有账户只保留已有本地加密值。
- [ ] 将同步和查看路径切换为读取 `secret_store`；查看前保留现有 Touch ID 调用。
- [ ] 缺少本地加密凭据时，后台同步跳过该账户并记录“需要重新保存凭据”，查看操作返回同样的可操作错误。
- [ ] 保存新密码或删除账户后只操作本地加密存储；不得调用任何 Keychain API。
- [ ] 前端编辑历史账户时显示重新保存凭据提示，不暴露 Keychain 术语。
- [ ] 更新 Rust 和 Vitest 用例，验证空密码历史账户、重新保存、删除和眼睛查看路径。
- [ ] 运行相关 Rust 测试和 `npm test -- --run tests/mail-manager`。

### Task 3: 接入 AI API Key

**Files:**
- Modify: `shell-native/src/commands/ai.rs`
- Modify: `shell-native/src/config.rs`
- Modify: `shell-native/tests/` 中现有 AI 命令测试或新增专用测试
- Modify: `shell-frontend/src/lib/ipc.ts`
- Modify: AI 模型测试器对应组件和测试

**Interfaces:**
- Consumes: `secret_store` 的 `shell / ai:<config-id>` 命名空间。
- Produces: AI 保存、查看、淘汰、删除均使用本地加密存储；缺失值提示重新保存 API Key。

- [ ] 保存 AI 配置时写入本地加密存储，历史元数据仍只存 URL、模型、hint 和时间。
- [ ] 查看前调用 Touch ID，之后读取新存储；值缺失时不回退读取 Keychain。
- [ ] 删除和历史淘汰时只删除新值，不访问 Keychain。
- [ ] 更新注释和 IPC 文案，删除“Keychain API Key”表述。
- [ ] 编写或更新测试，覆盖保存、查看、删除、历史淘汰和旧数据缺失值。
- [ ] 运行对应 Rust 测试和前端 AI 测试。

### Task 4: 清除旧直接依赖并完成回归验证

**Files:**
- Modify: `shell-native/Cargo.toml`
- Modify: `shell-native/src/lib.rs`
- Delete: `shell-native/src/mail_keychain.rs`
- Delete: `shell-native/src/ai_keychain.rs`
- Modify: `AGENTS.md`（仅当当前 Rust 模块清单与实现不符时）

**Interfaces:**
- Consumes: Task 1 至 Task 3 完成的调用替换。
- Produces: 运行时不再调用 Keychain API，并移除对应依赖。

- [ ] 搜索所有 Keychain 的读写调用，确认业务路径不再调用 `get_generic_password` 或 `set_generic_password`。
- [ ] 删除旧模块、无用导入和 `security-framework` 依赖。
- [ ] 更新 `AGENTS.md` 的 Rust 模块清单，使其只描述实际模块。
- [ ] 运行 `cargo test --manifest-path shell-native/Cargo.toml`、`npm test`、`npm run lint`、`npm run build`。
- [ ] 运行 `git diff --check`，并人工检查错误信息和日志中不存在明文输出。
