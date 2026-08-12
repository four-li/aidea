# 开搞

开搞是一个面向 AI 时代的本地创意工作台：把随时冒出的想法做成一个个创意或功能，再统一管理和使用。它负责承载内置应用与官方应用，让“想到”和“做成”之间的距离更短。

应用名称是“开搞”，内部 Cargo 包名仍为 `aidea-shell`，这是编译用的技术名称；用户数据目录和应用标识也保持不变，保证已有安装和更新继续有效。

## 技术栈

- Tauri 2 + React 18 + TypeScript + Tailwind CSS 3 + Vite
- Rust 侧：serde / serde_yaml / tokio / rusqlite / reqwest
- Node.js 版本见 [.nvmrc](.nvmrc)

## 目录结构

```
aIdea/
├── apps/builtin/         # 随开搞发布的内置应用 manifest
├── market-source.yaml    # 随开搞发布的官方市场仓库地址
├── shell-frontend/       # 壳前端（React）
├── shell-native/         # 壳 Rust 内核（Tauri）
├── docs/guide/           # 开搞平台和应用开发规范
└── docs/                 # 文档
```

用户配置、安装状态、日志和业务数据保存在
`~/Library/Application Support/aIdea/`，详见 [数据与存储规范](docs/guide/aidea-storage.md)。

## 官方应用与市场

开搞只内置市场入口，官方应用和市场收录都在独立 Git 仓库维护：

```text
开搞的 market-source.yaml
  -> https://gitee.com/aidea-org/aidea-market.git
  -> official/<app-id>.yaml
  -> https://gitee.com/aidea-org/<app-id>.git 的 aidea.yaml
```

当前本机开发目录约定为：

```text
/Users/fourli/Desktop/app/aidea-apps/
├── aidea-market/       # 官方市场配置仓库
├── stock-assistant/    # 股票助手官方应用仓库
└── <app-id>/           # 其他官方应用仓库
```

`aidea-apps/` 只用于本机开发和维护，不参与开搞的安装与运行。新增应用或变更仓库地址时，更新并发布 `aidea-market`；用户在开搞中刷新市场即可获取，无需发布开搞。

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
3. 打开开搞桌面窗口

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

### Gitee 发布、下载与更新

开搞仅发布 macOS Apple Silicon（arm64）未签名 `.dmg`，不支持 Intel Mac，也不依赖 Apple Developer 账号。

使用 `$aidea-release` 时，只在仓库根目录运行 `bash scripts/release.sh`。脚本会同步版本、运行测试、生成并提交 `updater/latest.json`，创建 Gitee tag 和 Release，再上传 `.dmg`、`.app.tar.gz`、`.app.tar.gz.sig` 和 `latest.json`。发布需要本机未提交的 `aidea-updater.key` 和 `/Users/fourli/aidea-gitee-token`；Token 文件不进入仓库。正常发布不需要补传；只有主脚本明确报告 main 和 tag 已推送、但 Release 上传中断时，才运行 `bash scripts/resume-release.sh X.Y.Z`，不要重新发布同一版本。

用户从 [Gitee Releases](https://gitee.com/aidea-org/aidea-app/releases) 下载 `.dmg`，打开后将开搞拖入 Applications，首次打开时按 macOS 提示确认。已安装的开搞可在“设置 → 关于”检查 Gitee Release，并下载经过签名验证的更新；验证成功后重启应用即可完成替换，无需手动下载 DMG。未签名应用首次安装仍会触发 macOS 安全提示，应用内更新不会绕过该提示。发布者配置见 [签名更新发布说明](docs/release-updater.md)。

如果 macOS 在双击 `.dmg` 时显示“开搞已损坏，无法打开”，通常是 Gatekeeper（macOS 的应用安全检查）拦截了从浏览器下载的未签名应用，并不代表下载文件真的损坏。先关闭提示，在终端移除 DMG 的下载隔离标记，再重新打开 DMG：

```bash
xattr -d com.apple.quarantine ~/Desktop/开搞_0.1.7_aarch64.dmg
open ~/Desktop/开搞_0.1.7_aarch64.dmg
```

然后把 `开搞.app` 拖入 `Applications`。如果仍被拦截，再在“系统设置 → 隐私与安全性”中点击“仍要打开”。

如果应用已经拖入 `Applications` 但仍无法打开，可以执行：

```bash
xattr -dr com.apple.quarantine /Applications/开搞.app
```

当前 Release 按项目约定不使用 Apple Developer、Developer ID 证书、Apple ID 公证或 stapling，因此首次启动需要手动放行；不要为此新增 Apple 账号、证书或 CI 配置。

## 添加子应用

当前只开发内置应用和官方应用，第三方市场、自定义安装和自动发现不属于现行能力。旧内置邮件已经从 aIdea 移除；新的邮件管理固定为独立官方应用 `mail-center`，使用自己的应用数据目录和数据库，不读取、不迁移旧邮件数据。

- 内置应用：代码放在 `shell-frontend/src/builtin-apps/<app-id>/`，manifest 放在 `apps/builtin/`。
- 官方应用：独立仓库根目录提供 `aidea.yaml`；官方市场仓库 `aidea-market` 的 `official/` 只收录仓库地址。修改市场仓库后，用户在开搞中刷新市场即可获取，无需发布开搞。
- 具体契约按任务读取 [AGENTS.md](AGENTS.md) 的文档路由表。

### 内置应用 Manifest 示例

```yaml
id: dev-tools
name: DevTools
version: 0.1.0
category: 开发
status: active

ui:
  mode: builtin
  icon: Wrench
```

## 设计文档

以 [AGENTS.md](AGENTS.md) 和 [docs/guide/](docs/guide/) 下的专项文档为准；历史方案保留在 `docs/superpowers/`。
