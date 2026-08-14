# Binary-Only 官方应用实现计划

> **历史记录，禁止作为当前实现或发布步骤执行。** 本文件记录 2026-08-13 的 binary-only 收敛过程，其中的 Gitee-only、旧测试与步骤顺序不再是当前规则。当前契约以 [aidea-official-app.md](../../guide/aidea-official-app.md) 和 [aidea-platform.md](../../guide/aidea-platform.md) 为准。


**Goal:** 将 aIdea 官方应用收敛为只安装自包含 macOS arm64 binary 包，并删除源码安装、无效版本门槛和重复更新日志字段。

**Architecture:** `aidea.yaml` 只声明展示信息、版本、一个经过 SHA-256 校验的 Gitee、GitHub 或 GitLab Release `.tar.gz` 包及本地启动配置。市场仓库继续只保存应用仓库地址；aIdea 从仓库读取 manifest、下载包、校验、受限解压和健康检查，不再 clone 应用源码。更新日志唯一来自该仓库对应平台的 Release 正文。

**Tech Stack:** Rust、Tauri、React/TypeScript、serde_yaml、sh、三平台 Release API。

## Global Constraints

- 官方应用只支持 macOS Apple Silicon（arm64）单一自包含 binary `.tar.gz` 包。
- 用户不需要安装 Rust、Cargo、Node、npm、Python 或 SQLite；应用内部运行时和依赖必须随包提供。
- `aidea.yaml` 不再接受 `revision`、`runtime`、`install`、`update_notes`、`min_aidea_version`。
- `artifact.url` 必须为同仓库 Gitee、GitHub 或 GitLab Release HTTPS `.tar.gz`，`artifact.sha256` 必须为 64 位小写十六进制。
- 更新日志唯一来自对应平台 Release `body`；市场收录只在首次发布、仓库地址变化或启用状态变化时修改。
- 不创建官方应用源码安装兼容分支；不迁移旧邮件数据。
- 常规开发不自动 `git add`、commit、push 或创建 PR；只有直接调用 `$aidea-app-release` 时才由发布 Skill 处理发布事务。

---

### Task 1: 收敛 aIdea 官方应用 Manifest 模型与校验

**Files:**
- Modify: `shell-native/src/official_market.rs`
- Modify: `shell-native/src/process.rs`
- Modify: `shell-frontend/src/types/official-app.ts`
- Test: `shell-native/src/official_market.rs`
- Test: `shell-native/src/process.rs`

**Interfaces:**
- Consumes: 应用仓库根目录的 `aidea.yaml` 和市场收录项的 `repository`。
- Produces: `OfficialAppDefinition`、`OfficialApp` 和 IPC 序列化结果只含 `artifact: OfficialArtifact`，不含源码安装字段。

- [ ] **Step 1: 写入拒绝旧字段与接受最小 binary 定义的失败测试**

在 `official_market.rs` 测试模块中建立唯一的有效定义辅助函数。它必须包含 `schema_version`、`id`、`name`、`description`、`category`、`version`、`icon`、`artifact` 和 `process`；不包含 `revision`、`runtime`、`install`、`update_notes`、`min_aidea_version`。

加入下列断言：

```rust
assert!(validate_definition(&valid_definition()).is_ok());
assert!(serde_yaml::from_str::<OfficialAppDefinition>(
    "schema_version: 1\nid: demo-app\nname: Demo\ndescription: test\ncategory: test\nversion: 0.1.0\nicon: Box\nrevision: abc\nartifact:\n  url: https://gitee.com/aidea-org/demo/releases/download/v0.1.0/demo.tar.gz\n  sha256: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nprocess:\n  command: [demo]\n  ready_url: http://127.0.0.1:43120/health\n"
).is_err());
```

分别为缺少 artifact、无效 URL、非小写或长度错误 SHA-256、非法 `ready_url` 断言失败。

- [ ] **Step 2: 运行单元测试，确认当前实现不能满足新契约**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test official_market
```

Expected: FAIL，原因是 `OfficialAppDefinition` 仍要求旧字段，或旧字段尚未被 `deny_unknown_fields` 拒绝。

- [ ] **Step 3: 删除旧模型字段与源码安装校验**

在 `OfficialAppDefinition` 和 `OfficialApp` 删除：

```rust
revision: String
min_aidea_version: String
runtime: String
install: Vec<Vec<String>>
update_notes: String
```

将 artifact 改为必填：

```rust
pub artifact: OfficialArtifact,
```

删除 `validate_runtime` 和安装命令校验循环；在 `validate_definition` 中直接调用：

```rust
validate_binary_artifact(&app.artifact, &app.id)?;
```

保留 `#[serde(deny_unknown_fields)]`，使旧字段在读取时明确失败。`CachedOfficialApp::into_app` 只合并 `repository`、展示字段、`artifact` 和 `process`。

同步 `process.rs` 测试中 `OfficialApp` 构造值，删除旧字段；进程启动逻辑不再根据 `app.runtime` 判断 binary，所有官方应用均按当前 binary PATH 规则执行。

- [ ] **Step 4: 运行 Rust 测试验证新 manifest 边界**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test official_market && cargo test process
```

Expected: PASS；最小 binary manifest 可读，任何旧字段、缺失 artifact 或非法 artifact 被拒绝。

### Task 2: 删除源码安装路径与安装记录中的 revision

**Files:**
- Modify: `shell-native/src/official_app_installer.rs`
- Modify: `shell-native/src/process.rs`
- Test: `shell-native/src/official_app_installer.rs`

**Interfaces:**
- Consumes: `OfficialApp { artifact, process, ... }`。
- Produces: `InstalledApp { id, version, status, definition }`；安装时只下载、校验、解压和健康检查。

- [ ] **Step 1: 写入安装记录无 revision 的失败测试**

将安装记录断言改为不包含 `revision`：

```rust
assert_eq!(installed.id, "demo");
assert_eq!(installed.version, "0.1.1");
assert_eq!(installed.status, "installed");
assert!(installed.definition.is_some());
```

增加一个反序列化测试，确认 `install-state.yaml` 出现未知 `revision` 时失败，避免把旧字段静默带回新模型。

- [ ] **Step 2: 运行安装器测试，确认当前旧记录与源码分支仍存在**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test official_app_installer
```

Expected: FAIL，原因为测试和 `InstalledApp` 仍依赖 `revision`，且源码安装分支尚未删除。

- [ ] **Step 3: 收敛 `install_inner` 为唯一 binary 流程**

删除：

```rust
clone_args
is_http2_transport_error
run
```

以及 `install_inner` 中 clone、HTTP/1.1 重试、checkout 和 install command 的分支。保留并直接顺序执行：

```rust
download_artifact(&def.artifact.url, &archive_path, &mut log).await?;
verify_sha256(&archive_path, &def.artifact.sha256)?;
extract_artifact(&archive_path, &source)?;
check_official_source(def, &source).await?;
```

将 `InstalledApp` 改为：

```rust
pub struct InstalledApp {
    pub id: String,
    pub version: String,
    pub status: String,
    #[serde(default)]
    pub definition: Option<OfficialApp>,
}
```

同步安装、回滚、离线读取和测试 fixture。删除只覆盖 clone、checkout、安装命令和 revision 的测试；保留 SHA-256、归档路径安全、健康检查、原子替换和更新回滚测试。

- [ ] **Step 4: 运行安装器与全量 Rust 验证**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test && cargo fmt --check && cargo clippy -- -D warnings
```

Expected: PASS；代码库不再有官方应用 Git clone、checkout、运行时或 revision 依赖。

### Task 3: 同步前端类型与应用管理更新日志行为

**Files:**
- Modify: `shell-frontend/src/types/official-app.ts`
- Modify: `shell-frontend/tests/components/AppManagementPage.test.tsx`
- Test: `shell-frontend/tests/components/AppManagementPage.test.tsx`

**Interfaces:**
- Consumes: Rust `list_official_apps` 和 `list_installed_official_apps` 的序列化 JSON。
- Produces: 应用管理仅使用版本更新状态与 Release API 返回的更新日志。

- [ ] **Step 1: 删除测试夹具中的旧字段**

将测试中的 `OfficialApp` fixture 改为：

```ts
{
  id: 'official-mail',
  name: '邮件管理',
  description: '测试应用',
  category: '效率',
  version: '0.1.1',
  icon: 'Mail',
  repository: 'https://gitee.com/aidea-org/mail-manager.git',
  artifact: { url: 'https://gitee.com/.../mail.tar.gz', sha256: 'a'.repeat(64) },
  process: { command: ['mail-center'], working_directory: '.', ready_url: 'http://127.0.0.1:43130/health' },
  update_available: true,
}
```

删除 `revision`、`runtime`、`install`、`update_notes` 和 `InstalledApp.revision`。保留现有“点击更新日志调用 `listOfficialAppReleases` 且显示 Release body”的用例。

- [ ] **Step 2: 运行前端测试，确认类型在旧字段删除后通过**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-frontend && npm test -- AppManagementPage.test.tsx
```

Expected: PASS；更新按钮继续按市场 `version` 显示，更新日志仍显示 Release `body`。

- [ ] **Step 3: 删除前端类型旧字段并构建**

从 `OfficialApp` 和 `InstalledApp` TypeScript interface 删除 `revision`、`runtime`、`install`、`update_notes`。不改变 `OfficialRelease`，它仍是 Release API 的 `version`、`title`、`body`、`published_at`、`prerelease`、`url`。

- [ ] **Step 4: 运行前端完整验证**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-frontend && npm test && npm run build
```

Expected: PASS；前端与 Rust JSON 类型一致，应用管理仍能展示 Release 更新日志。

### Task 4: 同步正式 manifest、示例和平台规范

**Files:**
- Modify: `AGENTS.md`
- Modify: `docs/guide/aidea-official-app.md`
- Modify: `docs/guide/aidea-platform.md`
- Modify: `docs/superpowers/specs/2026-08-12-official-app-binary-install-design.md`
- Modify: `samples/official-app-reference/aidea.yaml`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/AGENTS.md`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/aidea.yaml`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/docs/修复清单.md`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/docs/superpowers/specs/2026-08-11-mail-center-design.md`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/docs/superpowers/specs/2026-08-13-aidea-ui-component-equivalence.md`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/docs/superpowers/plans/2026-08-11-mail-center.md`
- Modify: `/Users/fourli/Desktop/app/aidea-plugins/mail-manager/docs/superpowers/plans/2026-08-13-aidea-ui-component-equivalence.md`

**Interfaces:**
- Consumes: Task 1 的唯一 binary manifest schema 和 Task 2 的唯一安装流程。
- Produces: 当前规范、示例和 mail-center manifest 不再描述已经删除的字段或 C1/C2/C3 链路。

- [ ] **Step 1: 将 aIdea 官方应用规范改为最小 manifest**

在 `aidea-official-app.md`：

- 删除源码安装示例、`revision`、`runtime`、`install`、`update_notes`、`min_aidea_version` 的说明。
- 用 Task 1 的最小 binary manifest 替换示例。
- 将安装说明改为“读取 manifest -> 下载 -> SHA-256 -> 解压 -> health -> 替换”。
- 将发布说明改为“一次应用发布事务”，不出现 C1/C2/C3。
- 明确更新日志唯一来自 Gitee Release 正文，市场不参与普通版本发布。

- [ ] **Step 2: 同步平台、样例和设计规格**

在 `aidea-platform.md` 和根 `AGENTS.md` 删除“源码安装仅供开发验证”的描述，改为“官方市场和安装器只接受自包含 binary；源码调试在应用仓库直接运行”。

在 binary 安装设计规格中，将历史的 revision/C1/C2 发布描述替换为最终契约，保留 SHA-256、包结构限制、staging、回滚和 Release 更新日志行为。

在 `samples/official-app-reference/aidea.yaml` 仅保留最终 manifest 字段。确保 `deny_unknown_fields` 所允许的所有字段都有被说明。

- [ ] **Step 3: 同步 mail-center 的运行约定、manifest 与历史决策文件**

从 mail-center 的 `aidea.yaml` 删除：

```yaml
revision: ...
min_aidea_version: ...
runtime: binary
update_notes: ...
```

保留已发布 Release 的 URL 与 SHA-256，直到下一次真实发布更新。将 `AGENTS.md` 的 binary 发布约束改为“唯一支持形式”，删除“binary v1 尚未正式发布前”旧条件。

将 `修复清单.md`、仍会被阅读的设计和计划中的 C1/C2/C3、revision 自引用、未发布 binary 前提，改为最终 binary-only 规则。历史完成记录无需伪造为当时已采用新规则，但其“后续发布”指令必须删除或更新。

- [ ] **Step 4: 用全文扫描验证无旧契约残留**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea && rg -n "revision|runtime: binary|update_notes|min_aidea_version|C1|C2|C3|源码安装" AGENTS.md docs samples shell-native shell-frontend
cd /Users/fourli/Desktop/app/aidea-plugins/mail-manager && rg -n "revision|runtime: binary|update_notes|min_aidea_version|C1|C2|C3|源码安装" AGENTS.md aidea.yaml docs
```

Expected: 对官方应用最终规范、sample、mail-center manifest 和 active Skill 无匹配；只有明确标注为“历史实现记录”的完成资料可保留，并且不含可执行的旧指令。

### Task 5: 重写全局 `$aidea-app` 与 `$aidea-app-release` Skills

**Files:**
- Modify: `/Users/fourli/atlas/user-agents/skills/aidea-app/SKILL.md`
- Modify: `/Users/fourli/atlas/user-agents/skills/aidea-app-release/SKILL.md`
- Delete: `/Users/fourli/atlas/user-agents/skills/aidea-app-release/scripts/source-preflight.sh`
- Delete: `/Users/fourli/atlas/user-agents/skills/aidea-app-release/scripts/manifest-preflight.sh`
- Delete: `/Users/fourli/atlas/user-agents/skills/aidea-app-release/scripts/verify-release-chain.sh`
- Modify: `/Users/fourli/atlas/user-agents/skills/aidea-app-release/scripts/release-preflight.sh`
- Modify: `/Users/fourli/atlas/user-agents/skills/aidea-app-release/scripts/gitee-release.sh`
- Create: `/Users/fourli/atlas/user-agents/skills/aidea-app-release/scripts/publish.sh`
- Create: `/Users/fourli/atlas/user-agents/skills/aidea-app-release/references/first-market-release.md`
- Modify: `/Users/fourli/atlas/user-agents/skills/aidea-app-release/tests/test-release-scripts.sh`

**Interfaces:**
- Consumes: 应用仓库目录；应用提供的 `scripts/package-macos.sh aarch64-apple-darwin`；根 `aidea.yaml` 的最终 schema；`/Users/fourli/aidea-gitee-token`。
- Produces: 一个 `publish.sh <app-repo-dir>` 总入口；它在正常路径自动发布且只在确实的失败或冲突时停止。

- [ ] **Step 1: 写发布脚本的压力测试**

保留 `release-preflight.sh` 的包结构、安全路径、无链接、arm64 和 SHA-256 测试。改写 `tests/test-release-scripts.sh`，使它验证：

```text
1. 四份版本声明一致且每段为 0-9。
2. 版本不低于最近 tag，且目标 tag 不存在。
3. package 脚本输出的包只有一个顶层目录且含启动二进制。
4. manifest 版本、Release URL、SHA-256 与包一致。
5. Gitee 查询结果不确定时不发送 POST。
6. 既有正确 Release 可验证；空 Release 可上传唯一附件。
7. Release body 由发布脚本传入，脚本不读出或输出 token。
```

使用临时 Git 仓库、mock `curl` 和 `/bin/ls` 测试包结构；不访问真实网络、不读取真实 token。

- [ ] **Step 2: 将固定流程收敛进 `publish.sh`**

`publish.sh <app-repo-dir>` 只能接受一个仓库目录，且内部固定：

```text
记录工作区基线
-> 检查版本四件套、本地和远端 tag/Release 均未冲突
-> 递增应用版本并运行测试、构建约定
-> 调用应用 package-macos.sh
-> 调用 release-preflight.sh 获取 SHA-256
-> 更新 aidea.yaml 的 version、artifact.url、artifact.sha256
-> 生成 Release body
-> git add 本次变更、创建单个发布提交、push
-> 调用 gitee-release.sh 创建 vX.Y.Z tag、Release、上传唯一附件、下载复验 SHA-256
```

版本递增逻辑固定为三段单数字：`0.1.9 -> 0.2.0`。生成 Release body 时读取本次提交的变更摘要，不保留 manifest `update_notes`。

脚本不可使用 `revision`、C1/C2/C3 或市场仓库参数。市场操作移到 `references/first-market-release.md`，且 Skill 仅在用户明确表示首次发布、变更仓库地址或变更启用状态时读取。

- [ ] **Step 3: 保留必要的停止与权限规则**

重写 `SKILL.md`，只要求 Agent：

- 明确发布请求即授权本次发布事务内的 commit、push、tag、Release 和附件上传。
- Git 写操作、Gitee API、网络或 token 读取被沙箱拦截时，主动以提升权限重试，不再要求用户重复确认。
- 测试/预检失败、改动归属无法判断、远端结果不明、tag/Release/附件冲突、或需要覆盖/删除/force push 时停止并报告。
- 正常发布不读取市场引用、不创建市场提交、不暴露 C1/C2/C3。

同步 `$aidea-app` Skill，删除所有 runtime/revision/C1/C2 指令，改为“官方应用只以自包含 binary 包发布；本地源码调试不属于安装契约”。

- [ ] **Step 4: 运行 Skill 测试与结构检查**

Run:

```bash
sh /Users/fourli/atlas/user-agents/skills/aidea-app-release/tests/test-release-scripts.sh
rg -n "revision|runtime: binary|update_notes|min_aidea_version|C1|C2|C3|source-preflight|manifest-preflight|verify-release-chain" /Users/fourli/atlas/user-agents/skills/aidea-app /Users/fourli/atlas/user-agents/skills/aidea-app-release
```

Expected: 脚本安全测试 PASS；active Skill 与脚本不再包含旧发布链路术语；首次市场收录说明仅在 reference 文件中出现。

### Task 6: 全链路验证与交付边界

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-binary-only-official-app-design.md`（仅在验证发现规格矛盾时）
- Test: aIdea Rust 与前端测试、mail-center 既有验证、发布 Skill shell 测试。

**Interfaces:**
- Consumes: Tasks 1-5 的最终 schema、安装器和发布脚本。
- Produces: 明确的自动验证证据与需要人工执行的市场安装验收项。

- [ ] **Step 1: 运行 aIdea 自动验证**

Run:

```bash
cd /Users/fourli/Desktop/app/aIdea/shell-native && cargo test && cargo fmt --check && cargo clippy -- -D warnings
cd /Users/fourli/Desktop/app/aIdea/shell-frontend && npm test && npm run build
cd /Users/fourli/Desktop/app/aIdea && git diff --check
```

Expected: PASS。

- [ ] **Step 2: 运行 mail-center 验证与 manifest 静态检查**

Run:

```bash
cd /Users/fourli/Desktop/app/aidea-plugins/mail-manager && npm test && npm run build && cargo test && cargo fmt --check && cargo clippy -- -D warnings && git diff --check
```

使用 `ruby -e 'require "yaml"; YAML.load_file("aidea.yaml")'` 或项目现有可用 YAML 解析工具读取 manifest，确认字段只有最终 schema 所允许的键。

Expected: PASS；mail-center 仍可构建，manifest 不含已删除字段。

- [ ] **Step 3: 运行发布 Skill 回归测试和旧术语扫描**

Run:

```bash
sh /Users/fourli/atlas/user-agents/skills/aidea-app-release/tests/test-release-scripts.sh
rg -n "revision|runtime: binary|update_notes|min_aidea_version|C1|C2|C3" /Users/fourli/Desktop/app/aIdea/AGENTS.md /Users/fourli/Desktop/app/aIdea/docs /Users/fourli/Desktop/app/aidea-plugins/mail-manager/AGENTS.md /Users/fourli/Desktop/app/aidea-plugins/mail-manager/docs /Users/fourli/atlas/user-agents/skills/aidea-app /Users/fourli/atlas/user-agents/skills/aidea-app-release
```

Expected: 发布脚本测试 PASS；扫描结果仅可包含本次“历史完成记录”中的过去时描述，不得包含最终规范、active Skill、示例或可执行指令。

- [ ] **Step 4: 记录人工验收项，不虚报完成**

手工使用新 aIdea 验收：刷新市场、查看 mail-center Release 更新日志、安装、启动、更新、卸载。mail-center 的真实 IMAP、断网重连、IDLE 到信及浅色/深色 UI 继续按 `docs/acceptance-checklist.md` 验收。

自动测试无法覆盖实际 Gitee 登录权限、真实 Release 上传和真实安装环境；这些必须在下一次调用发布 Skill 和 aIdea 本机测试时明确报告为未验证或已验证。

## Self-Review

- Spec coverage: Tasks 1-3 覆盖 aIdea schema、安装器、安装记录、进程管理、前端类型和更新日志；Task 4 覆盖规范、样例和 mail-center；Task 5 覆盖全局发布 Skill；Task 6 覆盖自动与人工验收。
- Placeholder scan: 无 `TBD`、`TODO` 或“类似前一步”指令；每个测试、脚本职责和停止条件均明确。
- Type consistency: `OfficialAppDefinition` 与 `OfficialApp` 共同使用必填 `OfficialArtifact`，`InstalledApp` 不再有 revision，前端类型与 Rust 输出同步。
