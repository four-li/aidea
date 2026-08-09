# aIdea

本地桌面壳应用，统一管理内置应用和官方应用。

## 技术栈

- Tauri 2 + React 18 + TypeScript + Tailwind CSS 3 + Vite
- Rust 侧：serde / serde_yaml / tokio / rusqlite / reqwest
- Node.js 版本见 [.nvmrc](.nvmrc)

## 目录结构

```
aIdea/
├── apps/builtin/         # 随 aIdea 发布的内置应用 manifest
├── plugin-markets/       # 随 aIdea 发布的官方应用收录目录
├── shell-frontend/       # 壳前端（React）
├── shell-native/         # 壳 Rust 内核（Tauri）
├── docs/guide/           # aIdea 平台和应用开发规范
└── docs/                 # 文档
```

用户配置、安装状态、日志和业务数据保存在
`~/Library/Application Support/aIdea/`，详见 [数据与存储规范](docs/guide/aidea-storage.md)。

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
cd shell-native
PATH="../shell-frontend/node_modules/.bin:$PATH" tauri dev
```

这条命令会自动：
1. 启动 vite 前端开发服务器（5173 端口）
2. 编译 Rust 后端
3. 打开 aIdea 桌面窗口

### 测试

```bash
# Rust 测试
cd shell-native && cargo test

# 前端测试
cd shell-frontend && npm test
```

### 构建发布版

```bash
cd shell-native && CI=true ../shell-frontend/node_modules/.bin/tauri build --bundles dmg
ls -lh target/release/bundle/dmg/*.dmg
```

### GitHub 发布、下载与更新

aIdea 首版只发布 macOS Apple Silicon 未签名 `.dmg`，不依赖 Apple Developer 账号。发布步骤：

1. 修改 `shell-native/tauri.conf.json` 的 `version`，例如 `0.1.0`。
2. 提交并推送代码后创建同版本 tag，例如 `v0.1.0`。
3. GitHub Actions 自动构建 `.dmg` 并创建 GitHub Release。
4. 用户从 Release 的 Assets 下载 `.dmg`，打开后将 `aIdea.app` 拖入 Applications，首次打开时按 macOS 提示确认。

已安装的 aIdea 可在“设置 → 关于”检查 GitHub Release，并下载经过签名验证的更新；验证成功后重启应用即可完成替换，无需手动下载 DMG。未签名应用首次安装仍会触发 macOS 安全提示，应用内更新不会绕过该提示。发布者配置见 [签名更新发布说明](docs/release-updater.md)。

如果 macOS 在双击 `.dmg` 时显示“aIdea 已损坏，无法打开”，通常是 Gatekeeper（macOS 的应用安全检查）拦截了从浏览器下载的未签名应用，并不代表下载文件真的损坏。先关闭提示，在终端移除 DMG 的下载隔离标记，再重新打开 DMG：

```bash
xattr -d com.apple.quarantine ~/Desktop/aIdea_0.1.2_aarch64.dmg
open ~/Desktop/aIdea_0.1.2_aarch64.dmg
```

然后把 `aIdea.app` 拖入 `Applications`。如果仍被拦截，再在“系统设置 → 隐私与安全性”中点击“仍要打开”。

如果应用已经拖入 `Applications` 但仍无法打开，可以执行：

```bash
xattr -dr com.apple.quarantine /Applications/aIdea.app
```

当前 Release 未使用 Apple Developer 签名和公证，因此首次启动需要手动放行；要彻底去掉这一步，需要配置 Developer ID 证书和 Apple 公证账号。

## 添加子应用

当前只开发内置应用和官方应用，第三方市场、自定义安装、自动发现和插件 SDK 不属于现行能力。

- 内置应用：代码放在 `shell-frontend/src/builtin-apps/<app-id>/`，manifest 放在 `apps/builtin/`。
- 官方应用：独立仓库根目录提供 `aidea.yaml`，aIdea 仓库只在 `plugin-markets/official/` 收录仓库地址。
- 具体契约按任务读取 [AGENTS.md](AGENTS.md) 的文档路由表。

### 内置应用 Manifest 示例

```yaml
id: dev-tools
name: DevTools
version: 0.1.0
category: 开发
path: shell-frontend/src/builtin-apps/dev-tools
status: active

ui:
  mode: builtin
  icon: Wrench
```

## 设计文档

以 [AGENTS.md](AGENTS.md) 和 [docs/guide/](docs/guide/) 下的专项文档为准；历史方案保留在 `docs/superpowers/`。
