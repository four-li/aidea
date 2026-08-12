# 官方应用 Binary 安装 v1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** 让 aIdea 能安装、更新并运行 Gitee Release 提供的 macOS Apple Silicon 官方应用 binary 包。

**Architecture:** 保留现有官方应用的市场缓存、source 目录、staging 健康检查和安装记录。将当前工作区中未完成的 artifacts.darwin-arm64 半成品收敛为已确认的单 artifact 字段；安装器按 runtime 分支准备 staging，随后复用现有替换和记录逻辑。binary 启动时只把包根目录置于子进程 PATH 最前，不增加路径配置系统。

**Tech Stack:** Rust、Tokio、Reqwest、SHA-256（sha2）、flate2、tar、serde_yaml、现有 Tauri 命令与 ProcessManager。

> **当前状态（2026-08-12）：** Task 1-6 的实现、测试和正式契约文档已完成。步骤中的 RED/FAIL 文字保留为实施过程记录；aIdea 0.1.11 尚未发布，mail-center 尚未创建正式 `aidea.yaml`，因此真实 Gitee 下载链路仍待发布后验收。

## 全局约束

- 只支持 macOS Apple Silicon（arm64）的 runtime: binary；不做 Intel、多架构选择、arch 字段或回退。
- binary manifest 固定使用单个 artifact: { url, sha256 }；不使用 artifacts 数组或映射。
- artifact URL 只接受 HTTPS Gitee Release 固定附件，且必须以 .tar.gz 结尾。
- tar.gz 顶层只能有一个目录；拒绝绝对路径、..、符号链接和硬链接。
- binary 的 command[0] 允许裸命令；包根目录加入子进程 PATH 最前，不增加 process.path。
- SHA-256 不匹配、包不合法、staging 健康检查失败时清理 staging 并保留旧版本。
- 更新时，如果新版本启动失败，恢复旧 source、旧安装记录和原运行状态。
- 不改 source 目录名，不自动 git add、commit、push 或创建 PR。
- 所有代码新增注释使用中文；只修改本计划列出的文件及构建工具生成的 lockfile。

## 文件职责

- shell-native/Cargo.toml、Cargo.lock：声明 tar.gz 解压所需的直接依赖。
- shell-native/src/official_market.rs：定义单 artifact 结构，解析并校验 binary manifest。
- shell-native/src/official_app_installer.rs：下载、SHA-256、受限解压、runtime 分流、安装记录与更新回滚句柄。
- shell-native/src/process.rs：binary 子进程与 staging 健康检查的 PATH 注入。
- shell-native/src/commands/shell.rs：更新成功后启动失败时调用安装器回滚，再恢复旧进程。
- docs/guide/aidea-official-app.md、docs/guide/aidea-platform.md、AGENTS.md：能力落地后将 arm64 binary v1 字段、安装和运行规则转为正式契约。

---

### Task 1: 收敛 Binary Manifest 数据结构和校验

**Files:**
- Modify: shell-native/src/official_market.rs:1-110, 179-287, 620-652, 710-810

**Interfaces:**

    #[derive(Debug, Clone, Deserialize, Serialize)]
    #[serde(deny_unknown_fields)]
    pub struct OfficialArtifact {
        pub url: String,
        pub sha256: String,
    }

    // OfficialAppDefinition 与 OfficialApp 均使用：
    #[serde(default)]
    pub artifact: Option<OfficialArtifact>

- [ ] **Step 1: 写 manifest 的失败测试。**

在 official_market.rs tests 中用 YAML 构造 binary 定义，覆盖合法单 artifact、缺 artifact、同时有 install、非 Gitee HTTPS Release URL、SHA-256 非 64 位十六进制、runtime 非 binary 却有 artifact。合法 YAML 使用 artifact.url 为：

    https://gitee.com/aidea-org/mail-center/releases/download/v0.1.5/mail-center-0.1.5-darwin-arm64.tar.gz

增加断言：command: [mail-center] 与 command: [./mail-center] 都通过 binary 校验。

- [ ] **Step 2: 运行定向测试，确认当前实现不符合新契约。**

Run: cd shell-native && cargo test official_market::tests::binary定义可以声明_arm64_预编译产物

Expected: FAIL 或测试语义与本计划冲突，因为现有代码只接受 artifacts.darwin-arm64 并强制 ./。

- [ ] **Step 3: 用单 artifact 替换半成品的 artifacts 映射。**

删除 BTreeMap 和 artifacts 字段，在定义和运行时结构中使用 artifact: Option<OfficialArtifact>。更新 CachedOfficialApp::into_app 的字段转移及所有本地结构体构造。

validate_runtime 的行为：

    if app.runtime == "binary":
      - install 非空时报错
      - artifact 缺失时报错
      - 调用 validate_binary_artifact
    else if artifact 存在:
      - 报错“只有 runtime: binary 可以声明 artifact”

validate_binary_artifact 使用 reqwest::Url，要求 scheme 为 https、host 为 gitee.com、path 包含 /releases/download/、path 以 .tar.gz 结束、sha256 恰为 64 位十六进制。保留通用 validate_command，删除 binary 对 command[0] 的 ./、反斜杠和 .. 限制。

- [ ] **Step 4: 更新夹具和验证。**

所有 OfficialAppDefinition 和 OfficialApp 字面量增加 artifact: None。binary YAML 改为单 artifact，并使用 command: [mail-center]。

Run: cd shell-native && cargo test official_market::tests

Expected: PASS，合法单 artifact 与裸命令通过，旧 artifacts schema 不再被接受。

### Task 2: 实现下载校验和受限 tar.gz 解压

**Files:**
- Modify: shell-native/Cargo.toml
- Modify: shell-native/Cargo.lock
- Modify: shell-native/src/official_app_installer.rs:1-156, 420-690

**Interfaces:**

    async fn download_artifact(
        artifact: &OfficialArtifact,
        archive_path: &Path,
        log: &mut File,
    ) -> AppResult<()>;

    fn extract_artifact(archive_path: &Path, destination: &Path) -> AppResult<()>;
    fn sha256_file(path: &Path) -> AppResult<String>;

- [ ] **Step 1: 补 direct dependencies 并写失败测试。**

在 Cargo.toml 增加 flate2 = "1" 和 tar = "0.4"。安装器测试覆盖：

- 正常单顶层目录解压后，文件直接位于 destination，不保留外层目录。
- 两个顶层目录、../escape、/absolute、EntryType::Symlink、EntryType::Link 都拒绝。
- SHA-256 正确通过，错误失败。
- 用一次性本地 TcpListener 响应测试 download_artifact；helper 不重复校验 Gitee URL，URL 规则只属于 manifest 层。

- [ ] **Step 2: 运行新测试。**

Run: cd shell-native && cargo test official_app_installer::tests::binary包

Expected: FAIL，当前测试已引用但尚未实现 verify_sha256、sha256_file、extract_artifact。

- [ ] **Step 3: 实现下载与哈希。**

download_artifact 创建 reqwest client，检查 HTTP 成功状态，循环 response.chunk 写入 archive_path，同时更新 Sha256。下载结束后用标准库将 digest 格式化成小写十六进制并与 manifest hash 做 ASCII 忽略大小写比较。

出错时删除 archive_path，返回包含“下载失败”或“SHA-256 不匹配”的 AppError::Process。安装日志只写 URL 和失败原因。

sha256_file 只服务单元测试，使用 std::io::Read 分块计算。

- [ ] **Step 4: 实现受限解压。**

extract_artifact 用 flate2::read::GzDecoder 和 tar::Archive 遍历 entries，不调用 archive.unpack。

每个 entry 必须满足：

- path 非绝对路径；
- path.components 不含 ParentDir；
- header entry type 不是 symlink 或 hard link；
- 所有 entry 的首个 component 相同。

顶层之后为空时仅允许目录；其他 entry 用 entry.unpack(destination.join(relative_path)) 写入。结束时必须见到一个顶层目录和至少一个可解压 entry。

- [ ] **Step 5: 验证。**

Run: cd shell-native && cargo test official_app_installer::tests::binary包

Expected: PASS；正常包可解压，坏 SHA、路径穿越、链接和多顶层目录均被拒绝。

### Task 3: 按 runtime 准备 staging 并保存 binary 安装记录

**Files:**
- Modify: shell-native/src/official_app_installer.rs:15-245, 420-690

**Interfaces:**

    pub struct InstalledApp {
        // 现有 id、version、revision、status
        #[serde(default)]
        pub artifact: Option<OfficialArtifact>,
        #[serde(default)]
        pub definition: Option<OfficialApp>,
    }

    async fn prepare_staging(
        def: &OfficialApp,
        root: &Path,
        staging: &Path,
        log: &mut File,
        on_progress: &mut (dyn FnMut(AppInstallProgress) + Send),
    ) -> AppResult<()>;

- [ ] **Step 1: 写 staging 分流和记录测试。**

安装记录序列化往返后，artifact.sha256 保持不变。为 binary staging 使用 Task 2 构建的本地 tar.gz 和本地 HTTP server；断言 prepare_staging 最终把包根目录内容解压至 staging，下载临时文件不留在 source。

- [ ] **Step 2: 运行测试。**

Run: cd shell-native && cargo test official_app_installer::tests::binary

Expected: FAIL，当前 install_inner 无条件执行 git clone 与 git checkout。

- [ ] **Step 3: 抽出 runtime 分流的 staging 准备函数。**

binary 分支：

1. 从 def.artifact 取 artifact；
2. 上报 downloading / 正在下载预编译包…；
3. 下载到 root/artifact-<uuid>.tar.gz；
4. 上报 extracting / 正在解压预编译包…；
5. 调用 extract_artifact(archive, staging)；
6. 无论成功失败都删除 archive。

其他 runtime 保持原 clone、HTTP/1.1 重试、checkout 与 install 命令，不改变源码安装。

install_inner 在 prepare_staging 成功后，继续调用现有 check_official_source、目录替换和写记录。InstalledApp.artifact 只在 binary 时保存 Some(def.artifact.clone())，其他 runtime 为 None。

- [ ] **Step 4: 保持旧记录可读并验证。**

artifact 需要 serde(default)。确认旧 install-state.yaml 缺 artifact 与 definition 时仍按既有异常应用路径显示，不出现 YAML 解析错误。

Run: cd shell-native && cargo test official_app_installer::tests

Expected: PASS；源码安装不回归，binary staging、记录和失败清理通过。

### Task 4: Binary 运行时的 PATH 与 staging 健康检查

**Files:**
- Modify: shell-native/src/process.rs:145-237, 360-398, 632-740

**Interfaces:**

    fn command_for_official_app(
        app: &OfficialApp,
        source: &Path,
    ) -> AppResult<(PathBuf, Option<std::ffi::OsString>)>;

非 binary 返回 resolve_program(command[0]) 和 None。binary 返回 PathBuf::from(command[0]) 与包根目录前置后的 PATH。

- [ ] **Step 1: 写裸 binary 命令测试。**

创建临时 source 根目录和可执行 test-server 脚本，脚本启动本地 /health。构造 runtime: binary、artifact: Some、process.command: [test-server, <port>] 并调用 check_official_source。断言无需 ./test-server 也成功。保留现有 python3 staging 测试。

- [ ] **Step 2: 运行定向测试。**

Run: cd shell-native && cargo test process::tests::binary

Expected: FAIL，因为当前 resolve_program 不包含 source 根目录。

- [ ] **Step 3: 实现 PATH 注入并在两个启动点复用。**

binary PATH 用 std::env::join_paths，将 source 放在 inherited PATH 的前面。start_official 和 check_official_source 都调用 command_for_official_app；仅当返回 Some(path) 时执行 .env("PATH", path)。保留 current_dir、AIDEA_APP_ID、AIDEA_APP_DATA_DIR、AIDEA_APP_LOG_DIR、日志和健康检查逻辑。

- [ ] **Step 4: 验证。**

Run: cd shell-native && cargo test process::tests

Expected: PASS；binary 裸命令能从包根目录启动，系统运行时解析不回归。

### Task 5: 更新后启动失败的目录和记录回滚

**Files:**
- Modify: shell-native/src/official_app_installer.rs:157-260
- Modify: shell-native/src/commands/shell.rs:162-205
- Test: shell-native/src/official_app_installer.rs:420-690

**Interfaces:**

    pub struct UpdateRollback {
        backup_source: Option<PathBuf>,
        previous_record: Option<Vec<u8>>,
    }

    pub async fn install_update_with_progress(...) -> AppResult<(InstalledApp, UpdateRollback)>;
    pub fn commit_update(rollback: UpdateRollback) -> AppResult<()>;
    pub fn rollback_update(id: &str, rollback: UpdateRollback) -> AppResult<()>;

- [ ] **Step 1: 写启动失败后的回滚测试。**

用临时 AIDEA_DATA_DIR 创建 apps/installed/demo/source/old-marker 与 version 0.1.0 的安装记录。模拟“staging 健康检查通过、正式启动失败”。调用 rollback_update 后断言 source/old-marker 恢复、安装记录恢复到 0.1.0、backup 目录不存在。

- [ ] **Step 2: 运行测试。**

Run: cd shell-native && cargo test official_app_installer::tests::更新失败

Expected: FAIL；当前 install_inner 在写记录后立即删除 backup，update_official_app 只尝试重启旧 definition，没有恢复旧目录。

- [ ] **Step 3: 让更新安装暂存 backup，普通安装维持现有清理。**

将“替换 source + 写记录”改为接收 keep_backup:

- install_with_progress 传 false，成功后立即删除 backup；
- install_update_with_progress 传 true，返回 UpdateRollback，包含旧 source backup 路径和安装前 install-state.yaml 原始字节；
- 初次安装没有旧 source/record 时对应字段为 None；
- commit_update 删除 backup；
- rollback_update 删除新 source、改名恢复 backup，原子写回旧记录；原来没有记录时删除新记录。

不新建数据库表或通用恢复框架；回滚信息只在这次更新命令的内存中存在。

- [ ] **Step 4: 在 Tauri 更新命令接入回滚。**

update_official_app 只在应用原先运行时调用 install_update_with_progress。新版本启动成功后调用 commit_update；新版本启动失败时依次调用 rollback_update、用 previous_definition 调用 manager.start_official、记录最终错误。原先未运行时继续普通 install_with_progress。

- [ ] **Step 5: 验证。**

Run:

    cd shell-native && cargo test official_app_installer::tests
    cargo test commands::shell::tests

Expected: PASS；安装失败和新版本启动失败都不丢旧版本，成功更新才删除 backup。

### Task 6: 更新正式文档与完成仓库验证

**Files:**
- Modify: AGENTS.md
- Modify: docs/guide/aidea-platform.md
- Modify: docs/guide/aidea-official-app.md

- [ ] **Step 1: 将 binary v1 从待实现改为已发布契约。**

加入已确认的 manifest 示例：runtime: binary，单 artifact 的 Gitee Release URL 与 sha256，process.command 使用裸 app-command。明确仅 arm64、单 artifact、tar.gz 单顶层目录、包根目录前置 PATH；不支持 Intel、多架构和 process.path。删除 binary、SHA-256 尚未实现的旧表述。

- [ ] **Step 2: 同步安装与发布顺序。**

写明下载校验、受限解压、staging /health、替换 source、失败保留旧版本；更新时恢复原运行状态。保留“先发布源码 commit C1 与 Gitee Release 包，再在 C2 的 aidea.yaml 引用 C1”的规则。

- [ ] **Step 3: 全量验证。**

Run:

    cd shell-native && cargo fmt --check && cargo clippy -- -D warnings && cargo test
    cd ../shell-frontend && npm run lint && npm test && npm run build
    cd .. && git diff --check

Expected: 全部通过。若依赖未在本机缓存导致 Cargo 无法解析，记录准确的依赖下载失败原因，不把未运行写成通过。

- [ ] **Step 4: 人工审查变更范围。**

Run:

    git diff --check
    git diff -- shell-native/Cargo.toml shell-native/src/official_market.rs shell-native/src/official_app_installer.rs shell-native/src/process.rs shell-native/src/commands/shell.rs AGENTS.md docs/guide/aidea-platform.md docs/guide/aidea-official-app.md

Expected: 只包含 binary v1 契约、安装器、PATH、回滚、测试和文档变更；不包含 Intel、多架构、SDK、搜索、邮件业务或无关重构。

## 计划自检

- 单 artifact、arm64-only、Gitee Release、裸命令 PATH：Task 1 与 Task 4。
- 下载、SHA-256、tar 单顶层与最小解压保护：Task 2。
- staging、source 替换、记录和旧记录兼容：Task 3。
- 更新后新版本启动失败的旧版本恢复：Task 5。
- 正式文档与完整闭环测试：Task 6。
- 当前未提交的 artifacts.darwin-arm64 和强制 ./ 半成品在 Task 1 被替换，不会与新契约并存。
