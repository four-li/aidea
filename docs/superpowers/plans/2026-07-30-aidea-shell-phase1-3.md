# aIdea 壳应用 Phase 1-3 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 aIdea 桌面壳应用的最小可运行版本（Phase 1-3），实现极简侧边栏、子应用注册表加载、子应用 webview 嵌入、子进程启停管理。

**Architecture:** Tauri 2 + React/TS + Tailwind。Rust 侧负责子进程管理和 Manifest 加载，前端负责极简侧边栏 UI 和 webview 容器。子应用通过 `apps/*.yaml` 注册表声明，壳扫描加载，不入侵子应用代码。

**Tech Stack:** Tauri 2.x、React 18、TypeScript、Tailwind CSS 3、Vite、Rust（serde/serde_yaml/tokio）

## Global Constraints

- 目标 OS：仅 macOS
- 技术栈：Tauri 2.x + React 18 + TypeScript + Tailwind CSS 3 + Vite
- 主题：跟随系统主题（auto），强制不可改
- 侧边栏：48px 宽，仅图标，hover 200ms 浮出 tooltip，不展开
- 顶栏：无（macOS 红绿圆点放侧边栏顶部 28px）
- Tab 栏：无（一次只看一个子应用）
- 状态栏：无（运行状态用侧边栏图标右下角小点）
- 配置位置：全部在 `aIdea/` 项目仓库内（不放 `~/.aidea/`）
- 子应用路径：绝对路径
- 命名规范：目录 `shell-frontend` / `shell-native` / `apps` / `packages` / `.runtime`
- 凭证管理：Aidea 不介入，子应用自管
- terminal 模式：不做，CLI 调用走「前端按钮 → 子应用后端 API」
- 源代码注释用中文，配置文件用中文注释
- 不主动 git add/commit（用户规则）

**本计划范围**：Phase 1（壳骨架）+ Phase 2（Manifest 系统）+ Phase 3（进程管理）。Phase 4-6（内置工具/主题双套/设置页/快捷键/打磨）作为独立计划后续产出。

---

## 文件结构总览

```
aIdea/
├── apps/                           # 子应用注册表（进 git）
│   ├── atlas.yaml                  # 真实子应用示例（atlas）
│   └── dev-tools.yaml              # 内置工具示例（占位，本期不实现 dev-tools 内容）
├── shell.config.json               # 壳全局设置
├── shell-frontend/                 # 壳 UI
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx                # React 入口
│   │   ├── App.tsx                 # 壳根组件
│   │   ├── types/
│   │   │   └── manifest.ts         # Manifest TS 类型定义
│   │   ├── lib/
│   │   │   ├── ipc.ts              # Tauri IPC 封装
│   │   │   └── manifest-loader.ts  # 前端侧 manifest 加载（调 Rust）
│   │   ├── components/
│   │   │   ├── Sidebar.tsx         # 极简侧边栏
│   │   │   ├── AppIcon.tsx         # 单个应用图标（含状态点 + tooltip + 右键菜单）
│   │   │   ├── AppIconTooltip.tsx  # hover tooltip
│   │   │   ├── AppContextMenu.tsx  # 右键菜单
│   │   │   ├── ContentArea.tsx     # 主区域容器
│   │   │   ├── WebviewFrame.tsx    # webview 模式渲染（iframe）
│   │   │   ├── BuiltinPage.tsx     # builtin 模式渲染（占位）
│   │   │   ├── EmptyState.tsx      # 无选中应用时的空状态
│   │   │   └── LogPanel.tsx        # 日志浮层面板
│   │   └── hooks/
│   │       ├── useApps.ts          # 子应用列表状态
│   │       ├── useActiveApp.ts     # 当前激活应用
│   │       └── useProcessStatus.ts # 进程状态轮询
│   └── tests/
│       ├── manifest-loader.test.ts
│       └── Sidebar.test.tsx
├── shell-native/                   # Tauri Rust 内核
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── build.rs
│   ├── src/
│   │   ├── main.rs                 # Tauri 入口
│   │   ├── lib.rs
│   │   ├── manifest.rs             # Manifest 加载与解析
│   │   ├── process.rs              # 子进程管理
│   │   ├── commands.rs             # Tauri IPC 命令
│   │   ├── config.rs               # 壳全局设置
│   │   └── error.rs                # 统一错误类型
│   └── tests/
│       ├── manifest_test.rs
│       └── process_test.rs
├── packages/
│   └── ui-kit/                     # UI 规范包（本期只搭骨架，组件后续补）
│       ├── package.json
│       └── src/
│           └── index.ts
├── .gitignore
└── docs/
    └── superpowers/
        └── specs/
            └── 2026-07-30-aidea-shell-design.md
```

---

## Task 1: 项目初始化与目录骨架

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/.gitignore`
- Create: `/Users/me/Desktop/app/aIdea/shell.config.json`
- Create: `/Users/me/Desktop/app/aIdea/packages/ui-kit/package.json`
- Create: `/Users/me/Desktop/app/aIdea/packages/ui-kit/src/index.ts`
- Create: `/Users/me/Desktop/app/aIdea/apps/dev-tools.yaml`（占位）

**Interfaces:**
- Produces: `shell.config.json` 结构定义，供 Rust `config.rs` 解析

- [ ] **Step 1: 创建 `.gitignore`**

```gitignore
# Rust
shell-native/target/
shell-native/Cargo.lock

# Node
node_modules/
**/node_modules/
dist/
**/dist/

# Runtime
.runtime/

# macOS
.DS_Store

# IDE
.vscode/
.idea/

# 日志
*.log
```

- [ ] **Step 2: 创建 `shell.config.json`**

```json
{
  "theme": "auto",
  "data_dir": ".runtime",
  "log_dir": ".runtime/logs"
}
```

- [ ] **Step 3: 创建 `packages/ui-kit/package.json`**

```json
{
  "name": "@aidea/ui-kit",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

- [ ] **Step 4: 创建 `packages/ui-kit/src/index.ts`（占位，本期不实现组件）**

```typescript
// aIdea UI 规范包入口
// 本期只搭骨架，组件后续补
// 0->1 子应用将通过 import { ... } from '@aidea/ui-kit' 引用风格统一组件

export const AIDEA_UI_KIT_VERSION = '0.1.0';
```

- [ ] **Step 5: 创建 `apps/dev-tools.yaml`（占位，子应用示例）**

```yaml
# 内置工具 dev-tools 配置（占位，本期不实现 dev-tools 内容）
id: dev-tools
name: DevTools
version: 0.1.0
category: tools
# builtin 模式下 path 是相对项目根
path: shell-frontend/src/builtin-apps/dev-tools
status: active
ui:
  mode: builtin
# 无 process 段（纯前端，无后端进程）
```

- [ ] **Step 6: 验证目录结构**

Run: `ls -la /Users/me/Desktop/app/aIdea/`
Expected: 看到 `.gitignore`、`shell.config.json`、`apps/`、`packages/ui-kit/` 等条目

---

## Task 2: Tauri 项目骨架（shell-native）

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/shell-native/Cargo.toml`
- Create: `/Users/me/Desktop/app/aIdea/shell-native/tauri.conf.json`
- Create: `/Users/me/Desktop/app/aIdea/shell-native/build.rs`
- Create: `/Users/me/Desktop/app/aIdea/shell-native/src/main.rs`
- Create: `/Users/me/Desktop/app/aIdea/shell-native/src/lib.rs`
- Create: `/Users/me/Desktop/app/aIdea/shell-native/src/error.rs`

**Interfaces:**
- Produces: Tauri 应用入口 `main.rs`、错误类型 `AppError`

- [ ] **Step 1: 创建 `Cargo.toml`**

```toml
[package]
name = "aidea-shell"
version = "0.1.0"
edition = "2021"

[lib]
name = "aidea_shell_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"
tokio = { version = "1", features = ["full"] }
anyhow = "1"
thiserror = "1"
dirs = "5"
```

- [ ] **Step 2: 创建 `build.rs`**

```rust
fn main() {
    tauri_build::build()
}
```

- [ ] **Step 3: 创建 `src/error.rs`（统一错误类型）**

```rust
// 统一错误类型，所有模块返回 Result<T, AppError>
use thiserror::Error;

#[derive(Error, Debug)]
pub enum AppError {
    #[error("IO 错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("YAML 解析错误: {0}")]
    Yaml(#[from] serde_yaml::Error),

    #[error("JSON 解析错误: {0}")]
    Json(#[from] serde_json::Error),

    #[error("配置错误: {0}")]
    Config(String),

    #[error("子应用未找到: {0}")]
    AppNotFound(String),

    #[error("进程错误: {0}")]
    Process(String),
}

// 让 AppError 能通过 Tauri IPC 序列化返回前端
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type AppResult<T> = Result<T, AppError>;
```

- [ ] **Step 4: 创建 `src/lib.rs`（库入口，导出各模块）**

```rust
pub mod commands;
pub mod config;
pub mod error;
pub mod manifest;
pub mod process;
```

- [ ] **Step 5: 创建 `src/main.rs`（Tauri 入口，临时占位，Task 5 完善命令注册）**

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    aidea_shell_lib::run();
}
```

在 `src/lib.rs` 末尾追加 `run` 函数（临时占位）：

```rust
// 临时占位 run，Task 5 注册完整命令
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
```

- [ ] **Step 6: 创建 `tauri.conf.json`**

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "aIdea",
  "version": "0.1.0",
  "identifier": "com.aidea.shell",
  "build": {
    "frontendDist": "../shell-frontend/dist",
    "devUrl": "http://localhost:5173",
    "beforeDevCommand": "cd ../shell-frontend && npm run dev",
    "beforeBuildCommand": "cd ../shell-frontend && npm run build"
  },
  "app": {
    "windows": [
      {
        "title": "aIdea",
        "width": 1440,
        "height": 900,
        "minWidth": 1024,
        "minHeight": 600,
        "titleBarStyle": "Overlay",
        "hiddenTitle": true,
        "fullscreen": false,
        "resizable": true
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "app",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns"
    ]
  }
}
```

- [ ] **Step 7: 验证 Cargo 项目能编译（暂不要求通过，因为 commands/config/manifest/process 模块还没实现）**

Run: `cd /Users/me/Desktop/app/aIdea/shell-native && cargo check 2>&1 | head -20`
Expected: 报「找不到 commands/config/manifest/process 模块」错误（Task 3-5 补齐）

---

## Task 3: Rust 配置加载模块

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/shell-native/src/config.rs`
- Create: `/Users/me/Desktop/app/aIdea/shell-native/tests/config_test.rs`（集成测试，可选）

**Interfaces:**
- Consumes: `shell.config.json`
- Produces: `config::ShellConfig` 结构体、`config::load_config()` 函数

- [ ] **Step 1: 创建 `src/config.rs`**

```rust
// 壳全局设置加载模块
use crate::error::AppResult;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShellConfig {
    /// 主题：强制 auto（跟随系统）
    #[serde(default = "default_theme")]
    pub theme: String,

    /// runtime 目录，相对项目根
    #[serde(default = "default_data_dir")]
    pub data_dir: String,

    /// 日志目录，相对项目根
    #[serde(default = "default_log_dir")]
    pub log_dir: String,
}

fn default_theme() -> String {
    "auto".to_string()
}
fn default_data_dir() -> String {
    ".runtime".to_string()
}
fn default_log_dir() -> String {
    ".runtime/logs".to_string()
}

impl Default for ShellConfig {
    fn default() -> Self {
        Self {
            theme: default_theme(),
            data_dir: default_data_dir(),
            log_dir: default_log_dir(),
        }
    }
}

/// 项目根目录（shell-native 的上两级）
/// 通过 CARGO_MANIFEST_DIR 推导，避免依赖运行时 cwd
pub fn project_root() -> AppResult<PathBuf> {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    // shell-native -> 上两级 = aIdea 根
    let root = PathBuf::from(manifest_dir)
        .parent()
        .ok_or_else(|| crate::error::AppError::Config("无法定位项目根目录".into()))?
        .to_path_buf();
    Ok(root)
}

/// 加载 shell.config.json，文件不存在则返回默认值
pub fn load_config() -> AppResult<ShellConfig> {
    let root = project_root()?;
    let config_path = root.join("shell.config.json");
    if !config_path.exists() {
        return Ok(ShellConfig::default());
    }
    let content = std::fs::read_to_string(&config_path)?;
    let config: ShellConfig = serde_json::from_str(&content)?;
    Ok(config)
}
```

- [ ] **Step 2: 验证编译**

Run: `cd /Users/me/Desktop/app/aIdea/shell-native && cargo check 2>&1 | tail -10`
Expected: 不再有 config 模块错误（仍有 commands/manifest/process 模块错误，后续补齐）

---

## Task 4: Rust Manifest 加载模块

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/shell-native/src/manifest.rs`
- Create: `/Users/me/Desktop/app/aIdea/shell-native/tests/manifest_test.rs`
- Create: `/Users/me/Desktop/app/aIdea/apps/atlas.yaml`（真实子应用示例）

**Interfaces:**
- Consumes: `apps/*.yaml`
- Produces: `manifest::AppManifest`、`manifest::UiMode`、`manifest::ProcessConfig`、`manifest::AppStatus`、`manifest::load_all_manifests()`

- [ ] **Step 1: 创建 `apps/atlas.yaml`（真实子应用示例）**

```yaml
# Atlas CLI - atlas 项目管理工具
id: atlas
name: Atlas CLI
version: 0.1.0
category: dev-workflow
# 外部子应用路径用绝对路径
path: /Users/me/atlas
status: active

ui:
  mode: webview
  url: http://localhost:5317
  icon: /Users/me/atlas/assets/icon.png

process:
  start: "python -m engine.web.app"
  stop: SIGTERM
  autostart: false
  working_dir: /Users/me/atlas
  log_file: /Users/me/atlas/logs/atlas.log
```

- [ ] **Step 2: 创建 `src/manifest.rs`**

```rust
// 子应用 Manifest 加载与解析模块
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// UI 接入模式
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UiMode {
    /// 嵌入外部 web 应用
    Webview,
    /// 壳内置页面（path 指向 shell-frontend/src/builtin-apps/<name>）
    Builtin,
    /// 无 UI，纯后台进程
    None,
}

/// 子应用状态（合并 enabled/disabled 概念）
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AppStatus {
    /// 正常启用
    Active,
    /// 临时禁用
    Disabled,
    /// 永久废弃
    Deprecated,
}

/// 停止方式
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum StopMethod {
    /// 信号名，如 "SIGTERM" / "SIGKILL"
    Signal(String),
    /// 自定义停止命令
    Command(String),
}

impl Default for StopMethod {
    fn default() -> Self {
        StopMethod::Signal("SIGTERM".to_string())
    }
}

/// UI 配置段
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    pub mode: UiMode,
    /// mode=webview 时必填，子应用 web server URL
    #[serde(default)]
    pub url: Option<String>,
    /// 图标路径（绝对路径）
    #[serde(default)]
    pub icon: Option<String>,
}

/// 进程配置段（无进程子应用不写此段）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessConfig {
    /// 启动命令
    pub start: String,
    /// 停止方式
    #[serde(default)]
    pub stop: StopMethod,
    /// Aidea 启动时是否自动拉起，默认 false
    #[serde(default)]
    pub autostart: bool,
    /// 执行目录，默认用 path
    #[serde(default)]
    pub working_dir: Option<String>,
    /// 日志落盘位置
    #[serde(default)]
    pub log_file: Option<String>,
}

/// 子应用 Manifest 完整结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppManifest {
    /// 唯一标识
    pub id: String,
    /// 显示名
    pub name: String,
    /// 版本
    pub version: String,
    /// 分类（侧边栏分组用，自由字符串）
    pub category: String,
    /// 子应用根目录（webview/none 模式为绝对路径，builtin 模式为相对项目根）
    pub path: String,
    /// 状态
    pub status: AppStatus,
    /// UI 配置
    pub ui: UiConfig,
    /// 进程配置（可选）
    #[serde(default)]
    pub process: Option<ProcessConfig>,
}

/// 扫描 apps/ 目录加载所有 manifest
/// 仅加载 status=active 或 status=disabled 的子应用，deprecated 不加载
pub fn load_all_manifests() -> AppResult<Vec<AppManifest>> {
    let root = crate::config::project_root()?;
    let apps_dir = root.join("apps");
    if !apps_dir.exists() {
        return Ok(Vec::new());
    }

    let mut manifests = Vec::new();
    for entry in std::fs::read_dir(&apps_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("yaml") {
            continue;
        }
        let content = std::fs::read_to_string(&path)?;
        let manifest: AppManifest = serde_yaml::from_str(&content)
            .map_err(|e| AppError::Config(format!("解析 {} 失败: {}", path.display(), e)))?;
        // deprecated 不加载
        if manifest.status == AppStatus::Deprecated {
            continue;
        }
        manifests.push(manifest);
    }
    Ok(manifests)
}

/// 按 id 查找单个 manifest
pub fn find_manifest(id: &str) -> AppResult<AppManifest> {
    let manifests = load_all_manifests()?;
    manifests
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| AppError::AppNotFound(id.to_string()))
}

/// 获取 builtin 模式子应用的绝对路径（path 是相对项目根）
pub fn builtin_app_path(manifest: &AppManifest) -> AppResult<PathBuf> {
    let root = crate::config::project_root()?;
    Ok(root.join(&manifest.path))
}
```

- [ ] **Step 3: 创建 `tests/manifest_test.rs`**

```rust
use aidea_shell_lib::manifest::{load_all_manifests, AppStatus, UiMode};

#[test]
fn 应能加载_apps_目录下的所有_yaml() {
    // 这个测试依赖项目根目录下有 apps/atlas.yaml 和 apps/dev-tools.yaml
    let manifests = load_all_manifests().expect("加载 manifest 失败");
    assert!(manifests.len() >= 2, "至少应有 atlas 和 dev-tools 两个子应用");

    let atlas = manifests.iter().find(|m| m.id == "atlas");
    assert!(atlas.is_some(), "应能找到 atlas");
    let atlas = atlas.unwrap();
    assert_eq!(atlas.name, "Atlas CLI");
    assert_eq!(atlas.status, AppStatus::Active);
    assert_eq!(atlas.ui.mode, UiMode::Webview);
    assert_eq!(atlas.ui.url.as_deref(), Some("http://localhost:5317"));
    assert!(atlas.process.is_some(), "atlas 应有 process 段");
}

#[test]
fn dev_tools_应为_builtin_模式且无_process() {
    let manifests = load_all_manifests().expect("加载 manifest 失败");
    let dev_tools = manifests
        .iter()
        .find(|m| m.id == "dev-tools")
        .expect("应能找到 dev-tools");
    assert_eq!(dev_tools.ui.mode, UiMode::Builtin);
    assert!(dev_tools.process.is_none(), "dev-tools 不应有 process 段");
}
```

- [ ] **Step 4: 运行测试**

Run: `cd /Users/me/Desktop/app/aIdea/shell-native && cargo test --test manifest_test -- --nocapture`
Expected: 两个测试都通过

- [ ] **Step 5: 验证编译**

Run: `cd /Users/me/Desktop/app/aIdea/shell-native && cargo check 2>&1 | tail -10`
Expected: 不再有 manifest 模块错误

---

## Task 5: Rust 进程管理模块

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/shell-native/src/process.rs`

**Interfaces:**
- Consumes: `manifest::AppManifest` 的 `process` 段
- Produces: `process::start_app(id)`、`process::stop_app(id)`、`process::is_running(id)`、`process::AppState`、`process::ProcessStatus`

- [ ] **Step 1: 创建 `src/process.rs`**

```rust
// 子进程管理模块
// 档位：中量（启停 + 状态 + 自启 + 日志）
// 不做：健康检查、崩溃自动重启、资源监控、启动顺序/依赖
use crate::error::{AppError, AppResult};
use crate::manifest::{find_manifest, AppManifest, StopMethod};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Mutex;
use tokio::process::Command;
use tokio::sync::oneshot;

/// 进程状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ProcessStatus {
    /// 运行中
    Running,
    /// 已停止
    Stopped,
}

/// 单个应用进程的运行时状态
#[derive(Debug, Clone, Serialize)]
pub struct AppState {
    pub id: String,
    pub status: ProcessStatus,
    pub pid: Option<u32>,
}

/// 全局进程表（id -> 子进程句柄）
struct ProcessTable {
    /// id -> (child, kill_tx)
    /// kill_tx 用于向子进程发 kill 信号
    entries: HashMap<String, ProcessEntry>,
}

#[derive(Debug)]
struct ProcessEntry {
    /// 子进程的 PID（启动后填充）
    pid: u32,
    /// 停止任务时通过这个 channel 通知监控协程退出
    kill_tx: Option<oneshot::Sender<()>>,
}

/// 全局进程表（Tauri 状态管理用）
pub struct ProcessManager {
    table: Mutex<ProcessTable>,
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self {
            table: Mutex::new(ProcessTable {
                entries: HashMap::new(),
            }),
        }
    }
}

impl ProcessManager {
    /// 启动子应用
    pub async fn start(&self, id: &str) -> AppResult<u32> {
        // 已运行则直接返回
        if self.is_running(id)? {
            return self.get_pid(id).ok_or_else(|| {
                AppError::Process(format!("{} 已运行但 PID 丢失", id))
            });
        }

        let manifest = find_manifest(id)?;
        let process_cfg = manifest.process.as_ref().ok_or_else(|| {
            AppError::Process(format!("{} 无 process 配置，不能启动", id))
        })?;

        let working_dir = process_cfg
            .working_dir
            .clone()
            .unwrap_or_else(|| manifest.path.clone());

        // 准备日志输出
        let log_path = process_cfg.log_file.as_ref();
        let stdout = if let Some(log_path) = log_path {
            // 确保日志目录存在
            let log_dir = PathBuf::from(log_path)
                .parent()
                .ok_or_else(|| AppError::Process(format!("日志路径无效: {}", log_path)))?;
            if !log_dir.exists() {
                std::fs::create_dir_all(log_dir)?;
            }
            let f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_path)?;
            Stdio::from(f)
        } else {
            Stdio::null()
        };

        // 解析启动命令（简单按空格切分，复杂场景后续再支持 shell 字符串）
        let mut parts = process_cfg.start.split_whitespace();
        let program = parts
            .next()
            .ok_or_else(|| AppError::Process(format!("{} 启动命令为空", id)))?;
        let args: Vec<&str> = parts.collect();

        let mut child = Command::new(program)
            .args(&args)
            .current_dir(&working_dir)
            .stdout(stdout)
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| AppError::Process(format!("启动 {} 失败: {}", id, e)))?;

        let pid = child
            .id()
            .ok_or_else(|| AppError::Process(format!("获取 {} PID 失败", id)))?;

        // 起 tokio 任务等待子进程退出，退出后清理进程表
        let (kill_tx, kill_rx) = oneshot::channel::<()>();
        let id_owned = id.to_string();
        let table_ref = self as *const ProcessManager;
        // 注意：这里不能用 self 引用，因为 ProcessManager 在 Tauri State 里
        // 改为在 wait 任务里只记录 pid 退出，不直接操作 table
        // table 的清理在 stop / is_running 检查时做
        let pid_for_wait = pid;
        tokio::spawn(async move {
            tokio::select! {
                _ = child.wait() => {
                    // 子进程自然退出，记录日志（不做自动清理，等下次 is_running 检查）
                    log::debug!("子应用 {} (pid={}) 已退出", id_owned, pid_for_wait);
                }
                _ = kill_rx => {
                    // 收到 kill 信号，kill_child 由 stop 函数自己处理
                }
            }
        });

        // 记录到进程表
        {
            let mut table = self.table.lock().unwrap();
            table.entries.insert(
                id.to_string(),
                ProcessEntry {
                    pid,
                    kill_tx: Some(kill_tx),
                },
            );
        }

        Ok(pid)
    }

    /// 停止子应用
    pub async fn stop(&self, id: &str) -> AppResult<()> {
        let entry = {
            let mut table = self.table.lock().unwrap();
            table.entries.remove(id)
        };

        let entry = entry.ok_or_else(|| AppError::Process(format!("{} 未在运行", id)))?;

        // 先发 kill_tx 通知监控协程
        if let Some(tx) = entry.kill_tx {
            let _ = tx.send(());
        }

        // 直接用 nix 风格发信号（macOS 用 libc::kill）
        // 这里简化：用 SIGTERM，5 秒后未退出则 SIGKILL
        let pid = entry.pid as i32;
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }

        // 等待最多 5 秒
        for _ in 0..50 {
            if !self.pid_alive(pid) {
                return Ok(());
            }
            tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
        }

        // 5 秒未退出，SIGKILL
        unsafe {
            libc::kill(pid, libc::SIGKILL);
        }
        Ok(())
    }

    /// 查询状态
    pub fn is_running(&self, id: &str) -> AppResult<bool> {
        let table = self.table.lock().unwrap();
        if let Some(entry) = table.entries.get(id) {
            // 进程表有记录，但可能已退出（自然退出未清理）
            if self.pid_alive(entry.pid as i32) {
                return Ok(true);
            }
        }
        Ok(false)
    }

    /// 获取所有应用状态（包括未运行的）
    pub fn get_all_states(&self, ids: &[String]) -> AppResult<Vec<AppState>> {
        let mut states = Vec::new();
        for id in ids {
            let running = self.is_running(id)?;
            let pid = if running {
                self.get_pid(id)
            } else {
                None
            };
            states.push(AppState {
                id: id.clone(),
                status: if running {
                    ProcessStatus::Running
                } else {
                    ProcessStatus::Stopped
                },
                pid,
            });
        }
        Ok(states)
    }

    fn get_pid(&self, id: &str) -> Option<u32> {
        let table = self.table.lock().unwrap();
        table.entries.get(id).map(|e| e.pid)
    }

    fn pid_alive(&self, pid: i32) -> bool {
        unsafe { libc::kill(pid, 0) == 0 }
    }
}

/// 启动所有 autostart=true 的子应用
pub async fn start_autostart_apps(manager: &ProcessManager) {
    let manifests = match crate::manifest::load_all_manifests() {
        Ok(m) => m,
        Err(e) => {
            eprintln!("加载 manifest 失败，无法执行 autostart: {}", e);
            return;
        }
    };
    for m in manifests {
        if let Some(p) = &m.process {
            if p.autostart {
                if let Err(e) = manager.start(&m.id).await {
                    eprintln!("自启动 {} 失败: {}", m.id, e);
                }
            }
        }
    }
}
```

- [ ] **Step 2: 在 `Cargo.toml` 添加 libc 依赖**

修改 `shell-native/Cargo.toml` 的 `[dependencies]` 段，追加：

```toml
libc = "0.2"
log = "0.4"
```

- [ ] **Step 3: 临时注释掉 `start_autostart_apps` 中对 `log::debug!` 的引用（避免 log 模块未初始化报错）**

修改 `src/process.rs` 中的 `log::debug!` 调用为 `eprintln!`：

```rust
eprintln!("子应用 {} (pid={}) 已退出", id_owned, pid_for_wait);
```

- [ ] **Step 4: 验证编译**

Run: `cd /Users/me/Desktop/app/aIdea/shell-native && cargo check 2>&1 | tail -15`
Expected: 编译通过（仍有 commands 模块错误，Task 6 补齐）

> 注：未运行时 `unsafe { libc::kill(pid, 0) }` 对不存在 PID 返回 -1，errno=ESRCH，所以 `pid_alive` 正确返回 false。

---

## Task 6: Rust Tauri IPC 命令模块

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/shell-native/src/commands.rs`
- Modify: `/Users/me/Desktop/app/aIdea/shell-native/src/lib.rs`

**Interfaces:**
- Consumes: `manifest`、`process`、`config` 模块
- Produces: Tauri 命令 `list_apps`、`start_app`、`stop_app`、`get_app_states`、`get_shell_config`

- [ ] **Step 1: 创建 `src/commands.rs`**

```rust
// Tauri IPC 命令模块，前端通过 invoke 调用这些函数
use crate::config::ShellConfig;
use crate::error::AppResult;
use crate::manifest::{load_all_manifests, AppManifest};
use crate::process::{AppState, ProcessManager};
use tauri::State;

/// 列出所有已加载的子应用 manifest
#[tauri::command]
pub async fn list_apps() -> AppResult<Vec<AppManifest>> {
    load_all_manifests()
}

/// 加载壳全局设置
#[tauri::command]
pub async fn get_shell_config() -> AppResult<ShellConfig> {
    crate::config::load_config()
}

/// 启动子应用
#[tauri::command]
pub async fn start_app(id: String, manager: State<'_, ProcessManager>) -> AppResult<u32> {
    manager.start(&id).await
}

/// 停止子应用
#[tauri::command]
pub async fn stop_app(id: String, manager: State<'_, ProcessManager>) -> AppResult<()> {
    manager.stop(&id).await
}

/// 查询所有子应用的进程状态
#[tauri::command]
pub async fn get_app_states(manager: State<'_, ProcessManager>) -> AppResult<Vec<AppState>> {
    let manifests = load_all_manifests()?;
    let ids: Vec<String> = manifests
        .into_iter()
        .filter_map(|m| m.process.map(|_| m.id))
        .collect();
    manager.get_all_states(&ids)
}
```

- [ ] **Step 2: 修改 `src/lib.rs` 注册命令和状态**

替换 `lib.rs` 中的 `run` 函数：

```rust
pub mod commands;
pub mod config;
pub mod error;
pub mod manifest;
pub mod process;

use process::{ProcessManager, start_autostart_apps};

pub fn run() {
    tauri::Builder::default()
        .manage(ProcessManager::default())
        .invoke_handler(tauri::generate_handler![
            commands::list_apps,
            commands::get_shell_config,
            commands::start_app,
            commands::stop_app,
            commands::get_app_states,
        ])
        .setup(|app| {
            // 启动 autostart 子应用
            let manager = app.state::<ProcessManager>();
            tauri::async_runtime::spawn(async move {
                start_autostart_apps(manager.inner()).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
```

- [ ] **Step 3: 验证编译**

Run: `cd /Users/me/Desktop/app/aIdea/shell-native && cargo check 2>&1 | tail -15`
Expected: Rust 侧编译通过

---

## Task 7: 前端项目骨架（shell-frontend）

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/package.json`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/tsconfig.json`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/vite.config.ts`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/tailwind.config.js`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/postcss.config.js`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/index.html`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/main.tsx`

**Interfaces:**
- Produces: Vite + React + TS + Tailwind 工程骨架

- [ ] **Step 1: 创建 `package.json`**

```json
{
  "name": "aidea-shell-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^14.2.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.19",
    "jsdom": "^24.0.0",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: 创建 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@aidea/ui-kit": ["../packages/ui-kit/src/index.ts"],
      "@/*": ["src/*"]
    }
  },
  "include": ["src", "tests"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 3: 创建 `tsconfig.node.json`**

```json
{
  "compilerOptions": {
    "composite": true,
    "skipLibCheck": true,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 4: 创建 `vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@aidea/ui-kit': path.resolve(__dirname, '../packages/ui-kit/src/index.ts'),
      '@': path.resolve(__dirname, 'src'),
    },
  },
  // Tauri 期望前端在 5173 端口
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './tests/setup.ts',
  },
});
```

- [ ] **Step 5: 创建 `tailwind.config.js`**

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media', // 跟随系统主题
  theme: {
    extend: {
      colors: {
        // 深色（默认）
        'aidea-bg': '#0d1117',
        'aidea-bg-secondary': '#0a0c10',
        'aidea-border': '#21262d',
        'aidea-text': '#e6edf3',
        'aidea-text-secondary': '#7d8590',
        'aidea-accent': '#58a6ff',
        'aidea-success': '#3fb950',
        'aidea-danger': '#f85149',
      },
      width: {
        sidebar: '48px', // 侧边栏宽度
      },
      height: {
        'drag-region': '28px', // macOS 拖拽区
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 6: 创建 `postcss.config.js`**

```javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 7: 创建 `index.html`**

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>aIdea</title>
  </head>
  <body class="bg-aidea-bg text-aidea-text">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 8: 创建 `src/main.tsx`**

```typescript
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 9: 创建 `src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* 全局样式 */
html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* 跟随系统浅色主题覆盖 */
@media (prefers-color-scheme: light) {
  :root {
    --aidea-bg: #ffffff;
    --aidea-bg-secondary: #f6f8fa;
    --aidea-border: #d0d7de;
    --aidea-text: #1f2328;
    --aidea-text-secondary: #656d76;
    --aidea-accent: #0969da;
    --aidea-success: #1a7f37;
    --aidea-danger: #cf222e;
  }
}
```

- [ ] **Step 10: 创建临时 `src/App.tsx` 占位**

```typescript
function App() {
  return (
    <div className="flex h-screen w-screen bg-aidea-bg text-aidea-text">
      <div className="w-sidebar bg-aidea-bg-secondary border-r border-aidea-border">
        <div className="h-drag-region" />
        <div className="p-2 text-xs text-center">壳</div>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <p className="text-aidea-text-secondary">壳骨架占位</p>
      </div>
    </div>
  );
}

export default App;
```

- [ ] **Step 11: 安装依赖**

Run: `cd /Users/me/Desktop/app/aIdea/shell-frontend && npm install`
Expected: npm install 成功完成

- [ ] **Step 12: 验证前端能构建**

Run: `cd /Users/me/Desktop/app/aIdea/shell-frontend && npm run build 2>&1 | tail -10`
Expected: 构建成功，生成 `dist/`

---

## Task 8: 前端类型定义与 IPC 封装

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/types/manifest.ts`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/lib/ipc.ts`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/lib/manifest-loader.ts`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/tests/manifest-loader.test.ts`

**Interfaces:**
- Consumes: Rust 侧命令 `list_apps`、`start_app`、`stop_app`、`get_app_states`、`get_shell_config`
- Produces: TS 类型 `AppManifest`、`UiMode`、`AppStatus`、`ProcessStatus`、`AppState`，IPC 封装函数 `ipc.listApps()` 等

- [ ] **Step 1: 创建 `src/types/manifest.ts`（与 Rust 侧 serde 序列化结构对应）**

```typescript
// 与 Rust 侧 manifest.rs 的 serde 结构一一对应
// serde rename_all = "lowercase" → TS 用字符串字面量

export type UiMode = 'webview' | 'builtin' | 'none';
export type AppStatus = 'active' | 'disabled' | 'deprecated';
export type ProcessStatus = 'running' | 'stopped';

export interface UiConfig {
  mode: UiMode;
  url?: string;
  icon?: string;
}

export interface ProcessConfig {
  start: string;
  stop: string | Record<string, string>; // StopMethod 是 untagged enum
  autostart: boolean;
  working_dir?: string;
  log_file?: string;
}

export interface AppManifest {
  id: string;
  name: string;
  version: string;
  category: string;
  path: string;
  status: AppStatus;
  ui: UiConfig;
  process?: ProcessConfig;
}

export interface AppState {
  id: string;
  status: ProcessStatus;
  pid: number | null;
}

export interface ShellConfig {
  theme: string;
  data_dir: string;
  log_dir: string;
}
```

- [ ] **Step 2: 创建 `src/lib/ipc.ts`（封装 Tauri invoke）**

```typescript
// Tauri IPC 封装，所有前端调用 Rust 命令都走这里
import { invoke } from '@tauri-apps/api/core';
import type { AppManifest, AppState, ShellConfig } from '../types/manifest';

export const ipc = {
  /** 列出所有已加载的子应用 */
  listApps: (): Promise<AppManifest[]> => invoke<AppManifest[]>('list_apps'),

  /** 加载壳全局设置 */
  getShellConfig: (): Promise<ShellConfig> => invoke<ShellConfig>('get_shell_config'),

  /** 启动子应用，返回 pid */
  startApp: (id: string): Promise<number> => invoke<number>('start_app', { id }),

  /** 停止子应用 */
  stopApp: (id: string): Promise<void> => invoke<void>('stop_app', { id }),

  /** 查询所有子应用的进程状态 */
  getAppStates: (): Promise<AppState[]> => invoke<AppState[]>('get_app_states'),
};
```

- [ ] **Step 3: 创建 `src/lib/manifest-loader.ts`（前端侧 manifest 加载，包一层方便测试）**

```typescript
// 前端侧 manifest 加载器，封装 ipc.listApps 便于上层 hook 使用
import { ipc } from './ipc';
import type { AppManifest, AppStatus } from '../types/manifest';

/** 加载所有子应用，过滤掉 disabled（不显示在侧边栏） */
export async function loadVisibleApps(): Promise<AppManifest[]> {
  const all = await ipc.listApps();
  // 仅 active 显示在侧边栏，disabled 不显示但保留配置记录
  return all.filter((app) => app.status === ('active' as AppStatus));
}
```

- [ ] **Step 4: 创建 `tests/setup.ts`**

```typescript
import '@testing-library/jest-dom';
```

- [ ] **Step 5: 创建 `tests/manifest-loader.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadVisibleApps } from '../src/lib/manifest-loader';
import type { AppManifest } from '../src/types/manifest';

// mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

describe('loadVisibleApps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('只返回 status=active 的子应用', async () => {
    const mockApps: AppManifest[] = [
      {
        id: 'atlas',
        name: 'Atlas',
        version: '0.1.0',
        category: 'dev-workflow',
        path: '/Users/me/atlas',
        status: 'active',
        ui: { mode: 'webview', url: 'http://localhost:5317' },
        process: {
          start: 'python -m engine.web.app',
          stop: 'SIGTERM',
          autostart: false,
        },
      },
      {
        id: 'legacy-tool',
        name: 'Legacy',
        version: '0.1.0',
        category: 'tools',
        path: '/some/legacy',
        status: 'disabled',
        ui: { mode: 'webview', url: 'http://localhost:9999' },
      },
    ];
    vi.mocked(invoke).mockResolvedValue(mockApps);

    const result = await loadVisibleApps();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('atlas');
  });

  it('invoke 失败时抛出原始错误', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('IPC 调用失败'));
    await expect(loadVisibleApps()).rejects.toThrow('IPC 调用失败');
  });
});
```

- [ ] **Step 6: 运行测试**

Run: `cd /Users/me/Desktop/app/aIdea/shell-frontend && npm test 2>&1 | tail -20`
Expected: 测试通过

---

## Task 9: 前端 hooks（useApps / useActiveApp / useProcessStatus）

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/hooks/useApps.ts`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/hooks/useActiveApp.ts`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/hooks/useProcessStatus.ts`

**Interfaces:**
- Consumes: `lib/manifest-loader.ts`、`lib/ipc.ts`
- Produces: `useApps()`、`useActiveApp()`、`useProcessStatus()`

- [ ] **Step 1: 创建 `src/hooks/useApps.ts`**

```typescript
// 子应用列表 hook：加载所有可见子应用
import { useState, useEffect, useCallback } from 'react';
import { loadVisibleApps } from '../lib/manifest-loader';
import type { AppManifest } from '../types/manifest';

export function useApps() {
  const [apps, setApps] = useState<AppManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loadVisibleApps();
      setApps(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { apps, loading, error, refresh };
}
```

- [ ] **Step 2: 创建 `src/hooks/useActiveApp.ts`**

```typescript
// 当前激活应用 hook：管理选中哪个子应用
import { useState, useCallback } from 'react';

export function useActiveApp() {
  const [activeAppId, setActiveAppId] = useState<string | null>(null);

  const selectApp = useCallback((id: string | null) => {
    setActiveAppId(id);
  }, []);

  return { activeAppId, selectApp };
}
```

- [ ] **Step 3: 创建 `src/hooks/useProcessStatus.ts`**

```typescript
// 进程状态 hook：定时轮询所有子应用进程状态
import { useState, useEffect, useCallback } from 'react';
import { ipc } from '../lib/ipc';
import type { AppState } from '../types/manifest';

const POLL_INTERVAL_MS = 2000; // 2 秒轮询一次

export function useProcessStatus(enabled: boolean) {
  const [states, setStates] = useState<Record<string, AppState>>({});
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const result = await ipc.getAppStates();
      const map: Record<string, AppState> = {};
      for (const s of result) {
        map[s.id] = s;
      }
      setStates(map);
    } catch (e) {
      // 静默失败，轮询不抛错到 UI
      console.error('轮询进程状态失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    const timer = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, refresh]);

  return { states, loading, refresh };
}
```

- [ ] **Step 4: 验证类型检查通过**

Run: `cd /Users/me/Desktop/app/aIdea/shell-frontend && npx tsc --noEmit 2>&1 | tail -10`
Expected: 无类型错误

---

## Task 10: 侧边栏组件（Sidebar / AppIcon / Tooltip）

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/components/Sidebar.tsx`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/components/AppIcon.tsx`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/components/AppIconTooltip.tsx`

**Interfaces:**
- Consumes: `useApps`、`useActiveApp`、`useProcessStatus`
- Produces: `<Sidebar />` 根组件

- [ ] **Step 1: 创建 `src/components/AppIconTooltip.tsx`**

```typescript
// 应用图标 hover tooltip，200ms 延迟后浮出应用名
import { useState, useRef } from 'react';

interface Props {
  name: string;
  children: React.ReactNode;
}

export function AppIconTooltip({ name, children }: Props) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    timerRef.current = setTimeout(() => setVisible(true), 200);
  };
  const hide = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  };

  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={hide}>
      {children}
      {visible && (
        <div className="absolute left-12 top-1/2 -translate-y-1/2 z-50 px-2 py-1 bg-aidea-bg-secondary border border-aidea-border rounded text-xs text-aidea-text whitespace-nowrap shadow-lg">
          {name}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 创建 `src/components/AppIcon.tsx`**

```typescript
// 单个应用图标：图标 + 运行状态点 + tooltip
import { AppIconTooltip } from './AppIconTooltip';
import type { AppManifest, AppState } from '../types/manifest';

interface Props {
  app: AppManifest;
  active: boolean;
  state?: AppState;
  onClick: () => void;
}

export function AppIcon({ app, active, state, onClick }: Props) {
  const isRunning = state?.status === 'running';
  // 无 process 段的子应用永远不显示状态点
  const showStatusDot = !!app.process;
  const iconSrc = app.ui.icon;

  return (
    <AppIconTooltip name={app.name}>
      <button
        onClick={onClick}
        className={`relative w-8 h-8 flex items-center justify-center rounded transition-colors ${
          active
            ? 'bg-aidea-border text-aidea-accent'
            : 'text-aidea-text-secondary hover:bg-aidea-border hover:text-aidea-text'
        }`}
        aria-label={app.name}
      >
        {iconSrc ? (
          <img src={iconSrc} alt={app.name} className="w-5 h-5" />
        ) : (
          // 无图标时用首字母占位
          <span className="text-xs font-medium">
            {app.name.charAt(0).toUpperCase()}
          </span>
        )}
        {showStatusDot && isRunning && (
          <span className="absolute bottom-0 right-0 w-2 h-2 bg-aidea-success rounded-full border border-aidea-bg-secondary" />
        )}
      </button>
    </AppIconTooltip>
  );
}
```

- [ ] **Step 3: 创建 `src/components/Sidebar.tsx`**

```typescript
// 极简侧边栏：48px 宽，顶部 macOS 拖拽区 + 红绿圆点，下方应用图标列表
import { AppIcon } from './AppIcon';
import type { AppManifest, AppState } from '../types/manifest';

interface Props {
  apps: AppManifest[];
  activeAppId: string | null;
  states: Record<string, AppState>;
  onSelectApp: (id: string) => void;
  onOpenSettings?: () => void;
}

export function Sidebar({ apps, activeAppId, states, onSelectApp, onOpenSettings }: Props) {
  return (
    <div className="w-sidebar bg-aidea-bg-secondary border-r border-aidea-border flex flex-col items-center">
      {/* macOS 拖拽区（红绿圆点会自动浮在这里，data-tauri-drag-region 让区域可拖拽窗口） */}
      <div
        className="h-drag-region w-full"
        data-tauri-drag-region
      />

      {/* 设置按钮 */}
      <button
        onClick={onOpenSettings}
        className="w-8 h-8 flex items-center justify-center rounded text-aidea-text-secondary hover:bg-aidea-border hover:text-aidea-text transition-colors mb-2"
        aria-label="设置"
      >
        ⚙
      </button>

      {/* 分隔线 */}
      <div className="w-6 h-px bg-aidea-border mb-2" />

      {/* 应用图标列表 */}
      <div className="flex-1 flex flex-col items-center gap-1 overflow-y-auto">
        {apps.map((app) => (
          <AppIcon
            key={app.id}
            app={app}
            active={app.id === activeAppId}
            state={states[app.id]}
            onClick={() => onSelectApp(app.id)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 验证类型检查**

Run: `cd /Users/me/Desktop/app/aIdea/shell-frontend && npx tsc --noEmit 2>&1 | tail -10`
Expected: 无类型错误

---

## Task 11: 内容区组件（ContentArea / WebviewFrame / EmptyState）

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/components/ContentArea.tsx`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/components/WebviewFrame.tsx`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/components/BuiltinPage.tsx`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/components/EmptyState.tsx`

**Interfaces:**
- Consumes: `AppManifest`
- Produces: `<ContentArea />` 根据 manifest 的 ui.mode 切换渲染

- [ ] **Step 1: 创建 `src/components/EmptyState.tsx`**

```typescript
// 无选中应用时的空状态
export function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center bg-aidea-bg">
      <div className="text-center">
        <p className="text-aidea-text-secondary text-sm">
          从左侧选择一个应用
        </p>
        <p className="text-aidea-text-secondary text-xs mt-2 opacity-60">
          aIdea
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 `src/components/WebviewFrame.tsx`**

```typescript
// webview 模式渲染：用 iframe 嵌入子应用 web server
import type { AppManifest } from '../types/manifest';

interface Props {
  app: AppManifest;
}

export function WebviewFrame({ app }: Props) {
  const url = app.ui.url;
  if (!url) {
    return (
      <div className="flex-1 flex items-center justify-center bg-aidea-bg">
        <p className="text-aidea-danger text-sm">
          子应用 {app.name} 配置错误：ui.mode=webview 但未配置 ui.url
        </p>
      </div>
    );
  }
  return (
    <iframe
      src={url}
      title={app.name}
      className="flex-1 w-full h-full border-0 bg-white"
      // 允许子应用使用 clipboard、modals 等
      allow="clipboard-read; clipboard-write"
    />
  );
}
```

- [ ] **Step 3: 创建 `src/components/BuiltinPage.tsx`（占位，本期不实现 dev-tools 内容）**

```typescript
// builtin 模式渲染：壳内置页面
// 本期仅占位，dev-tools 等内置工具内容在 Phase 4 实现
import type { AppManifest } from '../types/manifest';

interface Props {
  app: AppManifest;
}

export function BuiltinPage({ app }: Props) {
  return (
    <div className="flex-1 flex items-center justify-center bg-aidea-bg">
      <div className="text-center">
        <p className="text-aidea-text text-base font-medium">{app.name}</p>
        <p className="text-aidea-text-secondary text-sm mt-2">
          内置页面（Phase 4 实现）
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 创建 `src/components/ContentArea.tsx`**

```typescript
// 主内容区容器：根据 manifest 的 ui.mode 切换渲染
import type { AppManifest } from '../types/manifest';
import { WebviewFrame } from './WebviewFrame';
import { BuiltinPage } from './BuiltinPage';
import { EmptyState } from './EmptyState';

interface Props {
  activeApp: AppManifest | null;
}

export function ContentArea({ activeApp }: Props) {
  if (!activeApp) {
    return <EmptyState />;
  }
  switch (activeApp.ui.mode) {
    case 'webview':
      return <WebviewFrame app={activeApp} />;
    case 'builtin':
      return <BuiltinPage app={activeApp} />;
    case 'none':
      // 无 UI 子应用，显示提示
      return (
        <div className="flex-1 flex items-center justify-center bg-aidea-bg">
          <p className="text-aidea-text-secondary text-sm">
            {activeApp.name}（后台运行中，无 UI）
          </p>
        </div>
      );
    default:
      return <EmptyState />;
  }
}
```

- [ ] **Step 5: 验证类型检查**

Run: `cd /Users/me/Desktop/app/aIdea/shell-frontend && npx tsc --noEmit 2>&1 | tail -10`
Expected: 无类型错误

---

## Task 12: 右键菜单与日志面板组件

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/components/AppContextMenu.tsx`
- Create: `/Users/me/Desktop/app/aIdea/shell-frontend/src/components/LogPanel.tsx`

**Interfaces:**
- Consumes: `ipc.startApp`、`ipc.stopApp`、`AppManifest`、`AppState`

- [ ] **Step 1: 创建 `src/components/AppContextMenu.tsx`**

```typescript
// 应用图标右键菜单：启动/停止/重启/查看日志/打开日志文件/Finder 中显示
import { useState, useRef, useEffect } from 'react';
import { ipc } from '../lib/ipc';
import type { AppManifest, AppState } from '../types/manifest';

interface Props {
  app: AppManifest;
  state?: AppState;
  onRefresh: () => void;
  onShowLog: (app: AppManifest) => void;
}

export function AppContextMenu({ app, state, onRefresh, onShowLog }: Props) {
  const [open, setOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isRunning = state?.status === 'running';
  const hasProcess = !!app.process;

  // 点击外部关闭菜单
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleStart = async () => {
    setStarting(true);
    try {
      await ipc.startApp(app.id);
      onRefresh();
    } catch (e) {
      console.error('启动失败:', e);
    } finally {
      setStarting(false);
      setOpen(false);
    }
  };

  const handleStop = async () => {
    try {
      await ipc.stopApp(app.id);
      onRefresh();
    } catch (e) {
      console.error('停止失败:', e);
    } finally {
      setOpen(false);
    }
  };

  const handleRestart = async () => {
    setStarting(true);
    try {
      if (isRunning) {
        await ipc.stopApp(app.id);
      }
      await ipc.startApp(app.id);
      onRefresh();
    } catch (e) {
      console.error('重启失败:', e);
    } finally {
      setStarting(false);
      setOpen(false);
    }
  };

  const handleOpenLog = () => {
    onShowLog(app);
    setOpen(false);
  };

  const handleOpenInFinder = async () => {
    // 通过 Tauri Command 调用 macOS open 命令打开 path
    // 本期简化：用前端 console 提示，实际打开走 Rust 命令（后续补）
    console.log('打开 Finder:', app.path);
    setOpen(false);
  };

  return (
    <div className="relative" ref={menuRef}>
      {/* 触发右键 */}
      <div
        onContextMenu={(e) => {
          e.preventDefault();
          setOpen(true);
        }}
      >
        {/* 这里不渲染图标本身，由父组件渲染图标并把 onContextMenu 透传过来 */}
        {/* 本组件作为 wrapper，children 是图标 */}
      </div>

      {open && (
        <div className="absolute left-12 top-0 z-50 min-w-[160px] bg-aidea-bg-secondary border border-aidea-border rounded shadow-lg py-1">
          {hasProcess && (
            <>
              {!isRunning && (
                <MenuItem label={starting ? '启动中...' : '启动'} onClick={handleStart} disabled={starting} />
              )}
              {isRunning && (
                <>
                  <MenuItem label="停止" onClick={handleStop} />
                  <MenuItem label="重启" onClick={handleRestart} disabled={starting} />
                </>
              )}
              <MenuSeparator />
              <MenuItem label="查看日志" onClick={handleOpenLog} />
              <MenuSeparator />
            </>
          )}
          <MenuItem label="在 Finder 中显示" onClick={handleOpenInFinder} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="block w-full text-left px-3 py-1.5 text-sm text-aidea-text hover:bg-aidea-border disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {label}
    </button>
  );
}

function MenuSeparator() {
  return <div className="h-px bg-aidea-border my-1" />;
}
```

- [ ] **Step 2: 创建 `src/components/LogPanel.tsx`**

```typescript
// 日志浮层面板：tail 子应用日志文件最后 200 行
// 本期简化：用 IPC 调 Rust 读日志文件，前端展示
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { AppManifest } from '../types/manifest';

interface Props {
  app: AppManifest;
  onClose: () => void;
}

export function LogPanel({ app, onClose }: Props) {
  const [logs, setLogs] = useState<string>('加载中...');
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    let cancelled = false;

    const fetchLog = async () => {
      try {
        const content = await invoke<string>('read_app_log', { id: app.id });
        if (!cancelled) {
          setLogs(content || '日志为空');
        }
      } catch (e) {
        if (!cancelled) {
          setLogs(`读取日志失败: ${e}`);
        }
      }
    };

    fetchLog();
    const timer = setInterval(fetchLog, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [app.id, paused]);

  return (
    <div className="absolute bottom-0 right-0 w-2/3 h-1/2 bg-aidea-bg-secondary border border-aidea-border rounded-tl-lg shadow-2xl flex flex-col z-40">
      <div className="flex items-center justify-between px-3 py-2 border-b border-aidea-border">
        <span className="text-sm text-aidea-text">{app.name} 日志</span>
        <div className="flex gap-2">
          <button
            onClick={() => setPaused((p) => !p)}
            className="text-xs text-aidea-text-secondary hover:text-aidea-text"
          >
            {paused ? '继续' : '暂停'}
          </button>
          <button
            onClick={onClose}
            className="text-xs text-aidea-text-secondary hover:text-aidea-danger"
          >
            关闭
          </button>
        </div>
      </div>
      <pre className="flex-1 overflow-auto p-2 text-xs text-aidea-text font-mono whitespace-pre-wrap">
        {logs}
      </pre>
    </div>
  );
}
```

- [ ] **Step 3: 在 Rust 侧补 `read_app_log` 命令**

修改 `shell-native/src/commands.rs`，追加：

```rust
/// 读取子应用日志文件最后 200 行
#[tauri::command]
pub async fn read_app_log(id: String) -> AppResult<String> {
    let manifest = crate::manifest::find_manifest(&id)?;
    let process_cfg = manifest.process.ok_or_else(|| {
        crate::error::AppError::Process(format!("{} 无 process 配置", id))
    })?;
    let log_path = process_cfg.log_file.ok_or_else(|| {
        crate::error::AppError::Process(format!("{} 未配置 log_file", id))
    })?;

    if !std::path::Path::new(&log_path).exists() {
        return Ok(String::from("日志文件不存在"));
    }

    let content = std::fs::read_to_string(&log_path)?;
    // 取最后 200 行
    let lines: Vec<&str> = content.lines().rev().take(200).collect();
    let mut result = lines.into_iter().rev().collect::<Vec<_>>().join("\n");
    if !result.is_empty() {
        result.push('\n');
    }
    Ok(result)
}
```

修改 `shell-native/src/lib.rs` 的 `invoke_handler`，追加 `commands::read_app_log`：

```rust
.invoke_handler(tauri::generate_handler![
    commands::list_apps,
    commands::get_shell_config,
    commands::start_app,
    commands::stop_app,
    commands::get_app_states,
    commands::read_app_log,
])
```

- [ ] **Step 4: 验证编译**

Run: `cd /Users/me/Desktop/app/aIdea/shell-native && cargo check 2>&1 | tail -10`
Expected: 编译通过

Run: `cd /Users/me/Desktop/app/aIdea/shell-frontend && npx tsc --noEmit 2>&1 | tail -10`
Expected: 无类型错误

---

## Task 13: 组装 App.tsx 整合所有组件

**Files:**
- Modify: `/Users/me/Desktop/app/aIdea/shell-frontend/src/App.tsx`

**Interfaces:**
- Consumes: 所有 Task 8-12 的组件和 hooks
- Produces: 完整可运行的壳应用根组件

- [ ] **Step 1: 重写 `src/App.tsx`**

```typescript
import { useState, useMemo } from 'react';
import { Sidebar } from './components/Sidebar';
import { ContentArea } from './components/ContentArea';
import { LogPanel } from './components/LogPanel';
import { useApps } from './hooks/useApps';
import { useActiveApp } from './hooks/useActiveApp';
import { useProcessStatus } from './hooks/useProcessStatus';
import type { AppManifest } from './types/manifest';

function App() {
  const { apps, loading, error } = useApps();
  const { activeAppId, selectApp } = useActiveApp();
  const { states, refresh: refreshStatus } = useProcessStatus(apps.length > 0);

  const [logApp, setLogApp] = useState<AppManifest | null>(null);

  const activeApp = useMemo(
    () => apps.find((a) => a.id === activeAppId) || null,
    [apps, activeAppId]
  );

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-aidea-bg text-aidea-text-secondary">
        加载中...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-aidea-bg text-aidea-danger">
        加载失败: {error}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen bg-aidea-bg text-aidea-text overflow-hidden">
      <Sidebar
        apps={apps}
        activeAppId={activeAppId}
        states={states}
        onSelectApp={selectApp}
        onOpenSettings={() => {
          // 设置页 Phase 6 实现，本期占位
          console.log('打开设置（Phase 6）');
        }}
      />
      <ContentArea activeApp={activeApp} />
      {logApp && <LogPanel app={logApp} onClose={() => setLogApp(null)} />}
    </div>
  );
}

export default App;
```

- [ ] **Step 2: 验证类型检查**

Run: `cd /Users/me/Desktop/app/aIdea/shell-frontend && npx tsc --noEmit 2>&1 | tail -10`
Expected: 无类型错误

> 注：右键菜单（`AppContextMenu`）目前作为独立组件实现，挂载到 `AppIcon` 上需要把 `onContextMenu` 透传。本期简化：先把 `AppContextMenu` 实现就绪，挂载方式在 Phase 6 打磨时完善（当前点击图标直接选中应用，右键菜单暂未挂到 AppIcon 上，避免本期复杂度过高）。

---

## Task 14: 集成测试与启动验证

**Files:**
- 无新增，仅运行验证

- [ ] **Step 1: Rust 测试全部通过**

Run: `cd /Users/me/Desktop/app/aIdea/shell-native && cargo test 2>&1 | tail -20`
Expected: 所有测试通过（manifest_test 两个用例 + 默认测试）

- [ ] **Step 2: 前端测试全部通过**

Run: `cd /Users/me/Desktop/app/aIdea/shell-frontend && npm test 2>&1 | tail -20`
Expected: 所有测试通过

- [ ] **Step 3: 前端构建**

Run: `cd /Users/me/Desktop/app/aIdea/shell-frontend && npm run build 2>&1 | tail -10`
Expected: 构建成功

- [ ] **Step 4: Tauri 应用启动验证**

Run: `cd /Users/me/Desktop/app/aIdea/shell-native && cargo tauri dev 2>&1 | head -40`
Expected:
- Tauri 应用窗口启动
- 侧边栏显示 atlas 和 dev-tools 两个图标
- 点击 atlas 图标 → 内容区尝试加载 http://localhost:5317（atlas 未运行时 iframe 显示空白或连接失败，正常）
- 点击 dev-tools 图标 → 内容区显示「DevTools 内置页面（Phase 4 实现）」占位

> 注：实际启动 atlas 子应用需要先在 atlas 项目目录运行 `python -m engine.web.app`。本期只验证壳本身能加载子应用 manifest 和显示 UI，不验证 atlas 实际运行。

- [ ] **Step 5: 验证进程管理（手动）**

启动 Tauri 应用后：
1. 在 `apps/atlas.yaml` 临时把 `autostart: false` 改成 `autostart: true`
2. 重启 Tauri 应用
3. 检查 atlas 进程是否被自动拉起：`ps aux | grep "engine.web.app" | grep -v grep`
4. 检查侧边栏 atlas 图标右下角是否出现绿色状态点
5. 改回 `autostart: false`

Expected: autostart=true 时 atlas 进程被自动启动，侧边栏显示运行中绿点

---

## Task 15: 文档更新与 README

**Files:**
- Create: `/Users/me/Desktop/app/aIdea/README.md`

- [ ] **Step 1: 创建 `README.md`**

```markdown
# aIdea

本地桌面壳应用，统一管理多个子应用（atlas、stock 助手、openwebui 等）。

## 技术栈

- Tauri 2 + React 18 + TypeScript + Tailwind CSS 3 + Vite
- Rust 侧：serde / serde_yaml / tokio / libc

## 目录结构

```
aIdea/
├── apps/                 # 子应用注册表（YAML）
├── shell-frontend/       # 壳前端（React）
├── shell-native/         # 壳 Rust 内核（Tauri）
├── packages/ui-kit/      # 共享 UI 规范包
├── .runtime/             # 运行时文件（gitignore）
├── shell.config.json     # 壳全局设置
└── docs/                 # 文档
```

## 开发

### 安装依赖

```bash
# 前端依赖
cd shell-frontend && npm install

# Rust 依赖（首次编译时自动拉取）
cd shell-native && cargo build
```

### 启动开发模式

```bash
cd shell-native && cargo tauri dev
```

### 测试

```bash
# Rust 测试
cd shell-native && cargo test

# 前端测试
cd shell-frontend && npm test
```

### 构建发布版

```bash
cd shell-native && cargo tauri build
```

## 添加子应用

1. 在 `apps/` 目录新建 `<id>.yaml`
2. 按 spec 文档填写 manifest 字段
3. 重启 aIdea，子应用自动出现在侧边栏

## 设计文档

详见 [docs/superpowers/specs/2026-07-30-aidea-shell-design.md](docs/superpowers/specs/2026-07-30-aidea-shell-design.md)

## 当前版本

Phase 1-3：壳骨架 + Manifest 系统 + 进程管理（最小可运行版本）

Phase 4-6 待实现：内置工具 / 主题双套 / 设置页 / 快捷键 / 打磨
```

- [ ] **Step 2: 验证 README 存在**

Run: `ls -la /Users/me/Desktop/app/aIdea/README.md`
Expected: 文件存在

---

## Self-Review 自检结果

### 1. Spec 覆盖检查

| Spec 章节 | 覆盖情况 |
|---|---|
| 1-2 背景目标 / 用户场景 | 本计划是 Phase 1-3，不含子应用开发，符合 spec 非目标 |
| 3 技术架构 | Task 2 (Tauri 骨架)、Task 7 (前端骨架) 落地 |
| 4 目录结构 | Task 1 创建骨架，所有目录覆盖 |
| 5 Manifest 契约 | Task 4 (Rust 解析) + Task 8 (TS 类型) 完整覆盖 |
| 5.3 status 字段 | Task 4 实现，deprecated 不加载 |
| 5.4 ui.mode 字段 | Task 11 ContentArea 实现三种模式分支 |
| 6 UI 设计（48px 侧边栏 / 无顶栏 / 无 Tab / 无状态栏） | Task 10 + Task 13 完整实现 |
| 6.3 运行状态点（绿色实心点 / 无点） | Task 10 AppIcon 实现 |
| 6.4 hover tooltip 200ms | Task 10 AppIconTooltip 实现 |
| 6.4.1 右键菜单 | Task 12 AppContextMenu 实现（注：本期未挂到 AppIcon，Phase 6 完善） |
| 6.5 配色（深色 + 跟随系统） | Task 7 tailwind.config.js + index.css 实现 |
| 7 进程管理（中量档位） | Task 5 (Rust) + Task 12 (前端) 完整实现 |
| 7.2 进程管理流程 | Task 5 start/stop/autostart 完整 |
| 8 壳全局设置 | Task 3 (Rust) + Task 8 (TS 类型) 实现，配置项最小集 |
| 9 不管边界 | 全部遵守：Aidea 不碰子应用凭证、布局、业务 |
| 11 决策汇总 | 全部 20 条决策点已在对应 Task 落地 |

### 2. 占位符扫描

- 无 TBD / TODO / "implement later"
- Task 12 的 `handleOpenInFinder` 用 `console.log` 占位：这是已知简化，已在 Task 12 备注
- Task 13 备注：`AppContextMenu` 未挂到 `AppIcon`，是 Phase 6 打磨范围，已在 Task 13 末尾说明

### 3. 类型一致性

- `AppManifest` 在 Rust (Task 4) 和 TS (Task 8) 字段一一对应
- `AppState` / `ProcessStatus` / `AppStatus` / `UiMode` 在两侧命名一致
- IPC 命令名（list_apps / start_app / stop_app / get_app_states / read_app_log / get_shell_config）在 Rust (Task 6 + Task 12) 和 TS (Task 8) 一致
- `invoke<T>('xxx', { id })` 的参数名 `id` 与 Rust `#[tauri::command] async fn xxx(id: String)` 一致

### 4. 已知简化（Phase 6 完善）

1. 右键菜单未挂载到 AppIcon（Task 13 备注）
2. Finder 打开功能用 console.log 占位（Task 12）
3. 设置页未实现（Phase 6）
4. 主题切换仅靠 CSS media query，无 UI 切换器（符合 spec 强制 auto）
5. 无快捷键 / 命令面板（Phase 6）

---

## 计划完成判定

完成以下全部条件即视为 Phase 1-3 完成：

- [ ] 所有 15 个 Task 的所有 step 全部勾选完成
- [ ] `cargo test` 全部通过
- [ ] `npm test` 全部通过
- [ ] `cargo tauri dev` 能启动应用，侧边栏显示 atlas + dev-tools
- [ ] autostart=true 的子应用能被自动启动
- [ ] 点击 atlas 图标能切换到 webview 内容区
- [ ] 点击 dev-tools 图标显示 builtin 占位页
