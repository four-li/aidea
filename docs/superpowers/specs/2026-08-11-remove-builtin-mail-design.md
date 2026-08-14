# 删除内置邮件管理设计

> 历史记录，禁止作为当前实现或发布步骤执行。

> **历史设计记录**：本文件只记录删除旧内置邮件的设计过程，不是当前平台或官方应用契约。当前规则以仓库根目录 `AGENTS.md` 和 `docs/guide/` 为准；新邮件功能应按 `mail-center` 官方应用规范实现。

## 背景

aIdea 当前的 `mail-manager` 是旧的内置邮件管理实现。新的邮件管理已经作为独立官方应用 `mail-center` 开发，旧内置实现不再有保留价值。

当前仍处于开发阶段，没有需要兼容的正式用户数据。本次删除不做数据迁移、不做双写、不保留兼容读取，也不在 aIdea 壳中增加启动时清理旧数据的逻辑。

## 目标

- 从 aIdea 壳中彻底移除旧内置邮件管理的业务代码。
- 移除所有旧邮件的注册入口、IPC、数据结构、数据库迁移、后台同步和测试。
- 移除仅旧邮件使用的依赖。
- 更新当前有效开发约定，避免文档继续要求不存在的运行时清理能力。
- 保证 `mail-center` 作为独立官方应用的边界和示例不受影响。

## 非目标

- 不实现或修改官方应用 `mail-center`。
- 不新增运行时清理、迁移标记、兼容读取或旧数据备份。
- 不操作当前机器用户目录中的历史邮件数据。
- 不重写历史 changelog 或已经完成的旧设计计划。

## 实现范围

### 前端

删除：

- `shell-frontend/src/builtin-apps/mail-manager/`
- `shell-frontend/src/types/mail.ts`
- `shell-frontend/tests/mail-manager/`

修改：

- 从 `shell-frontend/src/lib/ipc.ts` 移除邮件类型导入和所有邮件 IPC 方法。
- 从 `shell-frontend/src/components/BuiltinPage.tsx` 移除邮件页面导入和 `mail-manager` 分支。

### Rust 后端

删除：

- `shell-native/src/commands/mail.rs`
- `shell-native/src/mail_store.rs`
- `shell-native/src/mail_sync.rs`
- `shell-native/src/mail_runtime.rs`
- `shell-native/migrations/mail-manager/`

修改：

- 从 `shell-native/src/lib.rs` 移除邮件模块声明、命令注册和后台邮件监听启动。
- 从 `shell-native/src/commands/mod.rs` 移除邮件命令模块。
- 从 `shell-native/src/manifest.rs` 移除旧邮件内置 manifest 的编译期注册。
- 从 `shell-native/src/error.rs` 移除只由旧邮件使用的 `AppError::Mail`。
- 从 `shell-native/Cargo.toml` 和锁文件中移除仅由旧邮件使用的依赖；仍被其他模块使用的依赖保留。

### Manifest 与测试

删除：

- `apps/builtin/mail-manager.yaml`
- 只验证旧邮件存在的测试。
- 旧邮件后端命令和存储测试。

修改：

- 更新 manifest 相关测试，使其验证现有内置应用集合不再包含 `mail-manager`，或者删除已经失效的旧断言。
- 不新增专门的运行时清理测试，因为本次不新增运行时清理逻辑。

### 文档与版本

修改当前有效文档：

- `AGENTS.md`
- `docs/guide/aidea-builtin-app.md`
- `docs/guide/aidea-platform.md`
- `docs/guide/aidea-storage.md`
- `docs/guide/aidea-official-app.md`

文档调整为：

- 旧内置邮件已经删除，不再描述其待删除实现细节。
- `mail-center` 是独立官方应用，不依赖旧邮件 IPC、Rust 模块、前端组件或数据库。
- `app-data/mail-manager/`、`logs/mail-manager/`、`databases/mail-manager.db` 等是历史废弃路径；新版不读取、不写入，也不自动删除。

由于移除内置应用会改变用户可见功能，按仓库现有发布约定同步 aIdea 版本号和对应发布说明；不新增版本管理机制。

## 数据与运行时行为

删除后的 aIdea：

1. 不再编译或加载 `mail-manager` manifest。
2. 不再注册任何邮件 Tauri IPC 命令。
3. 不再启动邮件后台监听线程。
4. 不再创建或访问旧邮件数据库目录。
5. 不读取、不迁移、不复制旧邮件账户、邮件缓存或凭据。
6. 不删除当前机器用户目录中的历史邮件数据。

官方 `mail-center` 继续使用自己的应用 ID、数据目录和数据库，aIdea 不提供旧邮件数据兼容层。

## 错误处理

本次没有新增业务路径或运行时错误处理。删除邮件模块后，只有在确认没有其他模块引用时才移除 `AppError::Mail`；如果某个依赖仍被其他功能使用，则保留该依赖，不做无关清理。

## 验证

实现完成后执行：

```bash
git diff --check
rg -n "mail-manager|mail_manager|list_mail_|sync_mail_|open_mail_webmail|AppError::Mail" \
  apps shell-frontend shell-native
cd shell-frontend && npm run lint && npm test && npm run build
cd ../shell-native && cargo test
```

验证重点：

- `apps/`、`shell-frontend/` 和 `shell-native/` 当前代码不再保留旧内置邮件的注册、调用或实现引用。
- 当前有效文档不再要求启动时清理、迁移或兼容旧邮件数据。
- 前端类型检查、单元测试和构建通过。
- Rust 单元测试和集成测试通过。
- `mail-center` 的 App Bridge 示例仍然存在且未被误删。
- 本机用户数据目录未被本次代码变更触碰。
