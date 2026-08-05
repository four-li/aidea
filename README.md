# aIdea

本地桌面壳应用，统一管理多个子应用（atlas、stock 助手、openwebui 等）。

## 技术栈

- Tauri 2 + React 18 + TypeScript + Tailwind CSS 3 + Vite
- Rust 侧：serde / serde_yaml / tokio / libc
- Node.js 24.14.0、Python 3.14.4（仅第三方 Python 子应用需要）

## 目录结构

```
aIdea/
├── apps/builtin/         # 随 aIdea 发布的内置应用 manifest
├── shell-frontend/       # 壳前端（React）
├── shell-native/         # 壳 Rust 内核（Tauri）
├── docs/ui-spec.md       # UI 规范（外部项目由 AI 阅读后遵守）
├── .runtime/             # 运行时文件（gitignore）
└── docs/                 # 文档
```

用户配置和第三方应用 manifest 保存在
`~/Library/Application Support/aIdea/`，详见 [数据目录规范](docs/app-data-layout.md)。

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
cd shell-native && ../shell-frontend/node_modules/.bin/tauri build --bundles app
ditto -c -k --sequesterRsrc --keepParent \
  target/release/bundle/macos/aIdea.app \
  /tmp/aIdea_0.1.0_aarch64.app.zip
```

### GitHub 发布、下载与更新

aIdea 首版只发布 macOS Apple Silicon 未签名 `.app.zip`，不依赖 Apple Developer 账号。发布步骤：

1. 修改 `shell-native/tauri.conf.json` 的 `version`，例如 `0.1.0`。
2. 提交并推送代码后创建同版本 tag，例如 `v0.1.0`。
3. GitHub Actions 自动构建 `.app.zip` 并创建 GitHub Release。
4. 用户从 Release 的 Assets 下载 `.app.zip`，解压后将 `aIdea.app` 拖入 Applications，首次打开时按 macOS 提示确认。

更新采用手动方式：下载新版本 `.app.zip`，退出旧版 aIdea，用新版本替换旧应用。未签名应用暂不启用应用内静默更新，避免绕过 macOS 安全提示或留下半更新状态。

## 添加子应用

1. 在 aIdea 设置页添加本地目录，manifest 会保存到用户数据目录的 `apps/local/`
2. 按 spec 文档填写 manifest 字段
3. 重启 aIdea，子应用自动出现在侧边栏

### Manifest 示例

```yaml
id: atlas
name: Atlas CLI
version: 0.1.0
category: dev-workflow
path: /Users/me/atlas        # 绝对路径
status: active                   # active | disabled | deprecated

ui:
  mode: webview                  # webview | builtin | none
  url: http://127.0.0.1:51130
  icon: /Users/me/atlas/assets/icon.png   # 可选，加载失败回退首字母

process:                         # 可选，纯前端子应用不写此段
  start: "python3 /Users/me/atlas/bin/atlas web"
  stop: SIGTERM
  autostart: false
  working_dir: /Users/me/atlas
  log_file: /Users/me/atlas/logs/atlas.log
```

## 设计文档

详见 [docs/superpowers/specs/2026-07-30-aidea-shell-design.md](docs/superpowers/specs/2026-07-30-aidea-shell-design.md)

## 当前版本

Phase 1-3：壳骨架 + Manifest 系统 + 进程管理（最小可运行版本）

Phase 4-6 待实现：内置工具 / 主题双套 / 设置页 / 快捷键 / 打磨
