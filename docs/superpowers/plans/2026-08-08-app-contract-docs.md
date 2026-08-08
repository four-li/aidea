# aIdea 应用契约文档迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 aIdea 的固定平台决策和应用开发契约归位到 `AGENTS.md` 与 `docs/app/`，消除旧文档中的冲突标准。

**Architecture:** `AGENTS.md` 只保留硬约束和必读文档路由。`docs/app/` 按平台、市场、包接入、数据目录、存储、平台命令和 UI 分开维护；旧文档只保留迁移链接。

**Tech Stack:** Markdown、仓库现有文档链接、`rg`、`git diff --check`。

## Global Constraints

- 只支持内置插件和官方插件；不实现第三方市场、自定义安装、自动发现、SDK 或多作者权限。
- 官方插件由 aIdea 仓库 `plugin-markets/official/` 预设定义；插件仓库不要求 `aidea.yaml`。
- aIdea 管理安装、更新、卸载、运行和状态；插件管理业务数据、配置、迁移、网络请求和 UI。
- 默认卸载保留业务数据；删除业务数据必须单独确认。
- 敏感值以密文保存在 aIdea 本地存储；后台读取不打断，查看明文时触发 Touch ID，认证有效期为 5 分钟。
- 本地加密存储不提供 Keychain 级保护，不防御能读取 aIdea 用户数据目录的本机攻击者。
- 本次只改文档，不改邮件业务代码、不实现 `aidea secret`，也不自动执行 Git 提交。

---

### Task 1: 建立平台、市场与包接入契约

**Files:**
- Create: `docs/app/platform.md`
- Create: `docs/app/marketplace.md`
- Create: `docs/app/package-spec.md`
- Modify: `docs/app-package-spec.md`

**Interfaces:**
- Consumes: `AGENTS.md` 的平台术语与硬约束、`docs/superpowers/specs/2026-08-08-aidea-platform-plugin-architecture-design.md`。
- Produces: 官方插件开发和后续安装器实现的正式规则。

- [ ] **Step 1: 写入 `platform.md`**

定义 aIdea 壳、内置插件、官方插件、官方插件市场、平台组件和业务数据；列出平台与插件职责边界、默认卸载保留数据，以及当前不做的第三方能力。

- [ ] **Step 2: 写入 `marketplace.md`**

固定目录：

```text
plugin-markets/
└── official/
    └── <app-id>.yaml
```

说明新增官方插件必须依次发布插件仓库、在 aIdea 增加定义、发布 aIdea；市场不是远程服务，aIdea 更新与单插件更新独立。

- [ ] **Step 3: 写入 `package-spec.md`**

限定官方定义必须有展示信息、仓库地址、固定 tag 或 commit、运行时、安装/启动命令、健康检查、兼容版本、数据目录与更新说明。命令使用参数数组，禁止 `sh -c`；WebView 只允许本机 `127.0.0.1`。

- [ ] **Step 4: 将旧 `app-package-spec.md` 改为迁移说明**

旧文档正文替换为指向 `docs/app/package-spec.md` 的说明，并明确 `owned` / `external` / 用户输入 GitHub 地址 / `aidea.json` 自动识别不再是现行契约。

- [ ] **Step 5: 验证边界**

运行：

```bash
rg -n '第三方|自定义插件|aidea\.json|用户在 aIdea 中输入 GitHub' docs/app docs/app-package-spec.md
```

预期：新文档只在“当前不做”或历史迁移说明中提及这些词。

### Task 2: 建立数据、存储与平台命令契约

**Files:**
- Create: `docs/app/data-layout.md`
- Create: `docs/app/storage.md`
- Create: `docs/app/platform-cli.md`
- Modify: `docs/app-data-layout.md`
- Modify: `docs/app-storage-spec.md`

**Interfaces:**
- Consumes: Task 1 的插件边界。
- Produces: 内置插件、官方插件和 Rust 后端共同遵守的数据、SQLite 与命令行规则。

- [ ] **Step 1: 写入 `data-layout.md`**

固定 `~/Library/Application Support/aIdea/`，并区分 `apps/installed/<app-id>/`（平台源码和安装记录）、`app-data/<app-id>/`（业务数据）、`logs/<app-id>/`（日志）、`databases/` 和 `backups/`。更新和默认卸载不得删除业务数据和日志。

- [ ] **Step 2: 写入 `storage.md`**

保留按所有者隔离、`foreign_keys` / WAL / `busy_timeout`、事务、列表不读大字段、时间/外键、独立迁移和迁移备份规则。敏感值改为由 aIdea 本地加密存储管理，普通配置和业务 SQLite 禁止保存明文，并写明本机安全边界。

- [ ] **Step 3: 写入 `platform-cli.md`**

定义环境变量：

```text
AIDEA_APP_ID
AIDEA_APP_DATA_DIR
AIDEA_APP_LOG_DIR
AIDEA_COMMAND
```

定义 `aidea secret set|get|delete|list`：插件进程由 `AIDEA_APP_ID` 限定命名空间，终端必须传 `--app <app-id>`；`set` 从标准输入读值，`list` 只列 key。`aidea notify` 只记录为未来接口，不在本次实现。

- [ ] **Step 4: 将旧数据与存储文档改为迁移说明**

`docs/app-data-layout.md` 指向 `docs/app/data-layout.md`，`docs/app-storage-spec.md` 指向 `docs/app/storage.md`；删除“敏感值统一放 macOS Keychain”的现行规则。

- [ ] **Step 5: 验证 Keychain 冲突消除**

运行：

```bash
rg -n '统一放 macOS Keychain|Keychain' AGENTS.md docs/app docs/app-data-layout.md docs/app-storage-spec.md docs/app-package-spec.md
```

预期：没有“统一放 macOS Keychain”；提到 Keychain 时只能解释本地加密存储的安全边界。

### Task 3: 迁移 UI 规范并更新开发前路由

**Files:**
- Create: `docs/app/ui.md`
- Modify: `docs/ui-spec.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: 当前 `docs/ui-spec.md` 的完整 UI 约定、Task 1 和 Task 2 的文档路径。
- Produces: 唯一的 UI 规范地址，以及准确的开发前文档路由。

- [ ] **Step 1: 迁移 UI 内容**

完整保留 `docs/ui-spec.md` 的视觉、组件、交互、配色与无障碍规则到 `docs/app/ui.md`，不借迁移调整设计标准。

- [ ] **Step 2: 建立旧 UI 文档迁移链接**

将 `docs/ui-spec.md` 改为指向 `docs/app/ui.md` 的简短说明，保留旧书签可达性。

- [ ] **Step 3: 更新 `AGENTS.md`**

将 UI 规则和“开发前文档路由”切换到 `docs/app/*.md`；将 Rust 路由中的“Keychain”调整为“本地加密存储 / Touch ID”；保留硬约束，不复制专项细节。

- [ ] **Step 4: 执行最终检查**

运行：

```bash
rg -n 'docs/(ui-spec|app-data-layout|app-storage-spec|app-package-spec)\.md' AGENTS.md docs --glob '*.md'
git diff --check
rg --files docs/app | sort
```

预期：旧路径只出现在迁移说明或历史设计、计划文档中；格式检查无输出；`docs/app/` 有七份正式契约文档。

- [ ] **Step 5: 交付说明**

明确新旧入口、已固定的本地加密存储边界，以及本次没有实现 `aidea secret`、官方插件安装器和 aIdea 自更新。
