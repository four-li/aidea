# GitHub 源码应用安装 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 允许用户通过公开 GitHub HTTPS 仓库安装本地 Web 应用；有 `aidea.json` 时读取默认配置，没有时生成并确认配置草稿，然后由 aIdea 启动并嵌入 WebView。

**Architecture:** 复用现有 `apps/*.yaml` 作为 aIdea 的唯一应用注册表，安装完成后将最终本机配置保存为 `apps/<id>.yaml`。外部仓库的 `aidea.json` 只提供默认值，不会被回写；新的 Rust 模块负责 Git 检出、只读识别、安装命令执行和 staging 到 source 的切换，现有 `ProcessManager` 继续负责启停。

**Tech Stack:** Tauri 2、Rust、serde/serde_json、tokio、现有 React + TypeScript + shadcn/ui、Vitest、Cargo test。

## Global Constraints

- 仅支持 macOS Apple Silicon 和公开 GitHub HTTPS 仓库。
- 支持 `builtin`、`owned`、`external` 三层接入；首期只新增 `owned` / `external` 的 GitHub 安装。
- 子应用数据目录、数据库和配置由子应用自己管理；aIdea 不迁移或改写。
- 第三方仓库的安装与启动命令必须在 UI 明确展示并由用户确认后执行。
- 命令必须使用程序与参数数组，禁止 `sh -c`。
- 不新增市场、账户、后台自动更新、Docker、SDK 或插件 API。
- 不自动 git add 或 git commit。

---

### Task 1: 扩展本机应用配置并保持旧 YAML 兼容

**Files:**
- Modify: `shell-native/src/manifest.rs`
- Modify: `shell-native/src/config.rs`
- Modify: `shell-native/tests/manifest_test.rs`
- Modify: `shell-frontend/src/types/manifest.ts`
- Test: `shell-frontend/tests/manifest-loader.test.ts`

**Interfaces:**
- Produces Rust `AppSource { repository: String, reference: String, commit: String, integration: AppIntegration }`。
- Produces Rust `CommandSpec { program: String, args: Vec<String> }`，供安装与启动使用。
- Extends `AppManifest` with optional `source` and optional `install_commands`，旧 YAML 不填时反序列化行为不变。

- [ ] **Step 1: 写 Rust 失败测试**

```rust
#[test]
fn external_source_requires_public_github_https_url() {
    let source = AppSource {
        repository: "git@github.com:owner/app.git".into(),
        reference: "main".into(),
        commit: "abc".into(),
        integration: AppIntegration::External,
    };

    assert!(source.validate().is_err());
}
```

- [ ] **Step 2: 运行失败测试**

Run: `cd shell-native && cargo test external_source_requires_public_github_https_url -- --nocapture`

Expected: FAIL，因为 `AppSource` 尚未定义。

- [ ] **Step 3: 最小实现可序列化来源与数组命令**

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AppIntegration {
    Owned,
    External,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandSpec {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
}
```

实现 `AppSource::validate()`：仅接受 `https://github.com/<owner>/<repo>` 或 `.git` 结尾，`reference` 非空，`commit` 为 40 位十六进制 SHA。

- [ ] **Step 4: 运行 Rust 与前端类型测试**

Run: `cd shell-native && cargo test --test manifest_test -- --nocapture`

Expected: PASS。

Run: `cd shell-frontend && npm test -- --run tests/manifest-loader.test.ts`

Expected: PASS。

### Task 2: 实现 `aidea.json` 读取和无契约仓库识别

**Files:**
- Create: `shell-native/src/app_discovery.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-native/Cargo.toml`
- Test: `shell-native/src/app_discovery.rs`

**Interfaces:**
- Produces `discover_app(root: &Path, repository: &str) -> AppResult<DiscoveredApp>`。
- `DiscoveredApp` 包含 `manifest: AppManifest`、`install_commands: Vec<CommandSpec>`、`confidence: DiscoveryConfidence` 和 `warnings: Vec<String>`。
- Consumes Task 1 的 `AppManifest`、`AppSource` 与 `CommandSpec`。

- [ ] **Step 1: 写 `aidea.json` 优先和 Python 草稿的失败测试**

```rust
#[test]
fn pyproject_without_aidea_json_produces_python_draft() {
    let dir = tempdir().unwrap();
    std::fs::write(
        dir.path().join("pyproject.toml"),
        "[project]\nname='akm'\nrequires-python='>=3.12'\n[project.scripts]\nakm='akm.cli:main'",
    )
    .unwrap();

    let result = discover_app(dir.path(), "https://github.com/nkHub/akm").unwrap();
    assert_eq!(result.manifest.id, "akm");
    assert_eq!(result.confidence, DiscoveryConfidence::Medium);
    assert_eq!(result.install_commands[0].program, "python");
}
```

- [ ] **Step 2: 运行失败测试**

Run: `cd shell-native && cargo test pyproject_without_aidea_json_produces_python_draft -- --nocapture`

Expected: FAIL，因为 `app_discovery` 模块尚未定义。

- [ ] **Step 3: 使用 `toml` 解析 `pyproject.toml`，不手写字符串解析**

新增最小依赖：`toml = "0.8"`。识别顺序固定为：`aidea.json`、`pyproject.toml`、`package.json`、其他文件仅产生 warning。Python 草稿默认生成：

```rust
CommandSpec {
    program: "python".into(),
    args: vec!["-m".into(), "pip".into(), "install".into(), ".".into()],
}
```

不从 README 自动执行命令；README 提取出的 `serve`、localhost、health 字样只能作为 `warnings` 中的候选提示。

- [ ] **Step 4: 运行模块测试**

Run: `cd shell-native && cargo test app_discovery -- --nocapture`

Expected: PASS，覆盖 `aidea.json`、Python、Node 与无法识别四种输入。

### Task 3: 在 staging 目录安装 GitHub 源码应用

**Files:**
- Create: `shell-native/src/app_installer.rs`
- Modify: `shell-native/src/error.rs`
- Modify: `shell-native/src/lib.rs`
- Test: `shell-native/src/app_installer.rs`

**Interfaces:**
- Produces `install_from_repository(request: InstallRequest) -> AppResult<InstalledApp>`。
- `InstallRequest` 包含已经由前端确认的 repository、reference、编辑后的 `AppManifest` 与安装命令。
- Consumes Task 2 的 `discover_app` 与 Task 1 的 `CommandSpec`。

- [ ] **Step 1: 写拒绝未确认命令和失败不覆盖 source 的测试**

```rust
#[tokio::test]
async fn install_requires_explicit_confirmation() {
    let request = InstallRequest::draft("https://github.com/owner/app", "main");
    assert!(install_from_repository(request).await.is_err());
}
```

- [ ] **Step 2: 运行失败测试**

Run: `cd shell-native && cargo test install_requires_explicit_confirmation -- --nocapture`

Expected: FAIL，因为安装器尚未定义。

- [ ] **Step 3: 最小安装流程**

1. 使用 `/usr/bin/git clone --depth 1 --branch <reference>` 检出到 `installed-apps/<id>/staging`。
2. 读取完整 commit SHA，校验来源 URL 与配置 ID。
3. 对 Python 应用使用 aIdea 托管 Python 在 staging 创建 `.venv`；对 Node 应用使用托管 Node。
4. 仅执行用户确认过的 `CommandSpec` 数组，stdout/stderr 写入 `logs/<id>/install.log`。
5. 成功后将旧 `source` 重命名为 `previous`，staging 原子改名为 `source`；失败则删除 staging 并保留 source。
6. 成功后调用现有 `save_manifest` 写入最终本机 YAML。

启动外部命令时不调用 shell；使用 `tokio::process::Command::new(program).args(args)`。

- [ ] **Step 4: 运行安装器测试**

Run: `cd shell-native && cargo test app_installer -- --nocapture`

Expected: PASS，覆盖未确认拒绝、安装失败保留旧 source、成功切换 source。

### Task 4: 暴露安装与识别 IPC，并在设置页完成确认流程

**Files:**
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Modify: `shell-frontend/src/types/manifest.ts`
- Modify: `shell-frontend/src/components/SettingsPanel.tsx`
- Create: `shell-frontend/tests/AppsManagement.test.tsx`

**Interfaces:**
- Produces IPC：`discover_github_app(repository, reference)`、`install_github_app(request)`。
- `discover_github_app` 不执行安装命令；`install_github_app` 必须要求 `confirmed: true`。
- Consumes Task 3 的 `InstallRequest`。

- [ ] **Step 1: 写设置页失败测试**

```tsx
it('识别到第三方仓库后展示命令并要求确认', async () => {
  vi.mocked(ipc.discoverGithubApp).mockResolvedValue(draft);
  render(<AppsManagement apps={[]} onAppsChanged={vi.fn()} />);
  await userEvent.type(screen.getByLabelText('GitHub 仓库地址'), 'https://github.com/nkHub/akm');
  await userEvent.click(screen.getByRole('button', { name: '识别配置' }));
  expect(await screen.findByText('python -m pip install .')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认安装' })).toBeDisabled();
});
```

- [ ] **Step 2: 运行失败测试**

Run: `cd shell-frontend && npm test -- --run tests/AppsManagement.test.tsx`

Expected: FAIL，因为 GitHub 安装 UI 和 IPC 尚未存在。

- [ ] **Step 3: 最小 UI**

在现有“应用管理”中新增一个 GitHub 图标按钮，打开 Dialog：仓库 URL、ref 输入、识别配置、可编辑的名称/分类/图标/命令/URL/健康检查、命令确认 Checkbox 和“确认安装”按钮。复用已有 shadcn Dialog、Input、Button、Checkbox 与 sonner；不新增页面或组件库。识别状态、安装中状态、错误日志与成功提示必须可见。

- [ ] **Step 4: 运行前端测试和质量检查**

Run: `cd shell-frontend && npm test -- --run tests/AppsManagement.test.tsx`

Expected: PASS。

Run: `cd shell-frontend && npm run lint && npm run build`

Expected: PASS。

### Task 5: 复用现有进程管理器启动受管应用

**Files:**
- Modify: `shell-native/src/process.rs`
- Modify: `shell-native/src/manifest.rs`
- Test: `shell-native/src/process.rs`

**Interfaces:**
- Consumes Task 1 的数组命令与外部应用 `source` 路径。
- Existing `ProcessManager::start(id)` continues to start legacy string-command manifests unchanged.

- [ ] **Step 1: 写受管 Python 路径替换失败测试**

```rust
#[test]
fn managed_python_uses_app_virtualenv() {
    let command = resolve_start_command(&manifest, Path::new("/tmp/app/source")).unwrap();
    assert_eq!(command.program, PathBuf::from("/tmp/app/source/.venv/bin/python"));
    assert_eq!(command.args, vec!["-m", "akm.cli", "serve", "--no-open"]);
}
```

- [ ] **Step 2: 运行失败测试**

Run: `cd shell-native && cargo test managed_python_uses_app_virtualenv -- --nocapture`

Expected: FAIL，因为数组命令解析尚未接入进程管理器。

- [ ] **Step 3: 最小启动兼容实现**

旧 `process.start` 保持原有行为。外部 `managed` Python 应用的 `program: "python"` 固定替换为 `source/.venv/bin/python`；Node 替换为 aIdea 托管 Node 路径。以 `working_dir=source` 启动，日志仍复用现有 `log_file` 和 `wait_until_ready`。

- [ ] **Step 4: 运行 Rust 闭环测试**

Run: `cd shell-native && cargo test`

Expected: PASS。

## 验证闭环

1. `cd shell-native && cargo test`
2. `cd shell-frontend && npm test`
3. `cd shell-frontend && npm run lint`
4. `cd shell-frontend && npm run build`
5. 手工验收：输入 `https://github.com/nkHub/akm`，确认草稿展示 Python 安装命令、`8800/admin` 与 `health/ready` 候选；未勾选命令确认时不能安装。

## 计划自检

- 覆盖范围：GitHub 安装、可选 `aidea.json`、自动识别、人工编辑确认、第三方信任提示、staging 回滚、现有应用兼容、WebView 启动和前后端验证均有对应任务。
- 有意不覆盖：aIdea 内置 Node/Python 二进制的下载与签名，必须先作为独立发布工程验证；本计划仅定义其在安装器和启动器中的调用位置。
- 未自动提交：遵守仓库 `AGENTS.md` 的“不要主动 git add/commit”约束。
