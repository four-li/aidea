# aIdea 桌面壳应用 — 设计文档

- 文档日期：2026-07-30
- 状态：待实现
- 作者：用户 + TRAE 协作

---

## 1. 背景与目标

### 1.1 问题陈述

用户有多个独立项目（atlas cli、stock 助手、openwebui 部署、轻量 dev tools 等），分散在不同目录、各自维护。存在以下痛点：

- 想法多但容易遗忘，缺乏统一入口
- 子应用可能停止维护、或被另一子应用吸纳，需要可插拔机制
- 子应用类型差异大（CLI、纯前端、全栈 web、二开应用），整合方式要兼容差异
- 想要一个统一壳来管理子应用的展示、启停、状态

### 1.2 目标

构建一个 **macOS 本地桌面壳应用（aIdea）**，提供：

1. 统一入口：所有子应用通过侧边栏切换访问
2. 可插拔：增删子应用通过配置文件完成，不动子应用代码
3. 进程管理：对有后端的子应用提供启动/停止/自启/日志查看
4. UI 风格统一：0→1 子应用通过引用 ui-kit 保证风格一致，二开应用不强求
5. 紧凑布局：侧边栏极窄，舞台 100% 给子应用自由布局

### 1.3 非目标

- **不做多用户体系**：单机自用，无多用户概念
- **不管子应用内部业务**：布局、路由、状态、数据存储、用户系统都由子应用自管
- **不管子应用凭证**：第三方 API Token 等凭证由子应用自己的方式获取和存储，Aidea 不介入
- **不做跨平台**：仅 macOS
- **本期不做子应用开发**：只设计壳应用架构和契约，子应用后续按规范重构

---

## 2. 用户场景

### 2.1 使用场景

只给作者本人用，单机本地运行，无多机同步需求（换机时手动迁移配置）。

### 2.2 子应用分类

| 类型 | 例子 | 是否独立进程 | UI 接入方式 |
|---|---|---|---|
| 内置轻量工具（无后端） | dev-tools（JSON 格式化、时间戳等） | 否 | builtin（壳前端路由） |
| 0→1 全栈子应用 | atlas（重构后）、stock 助手 | 是 | webview |
| 二开全栈应用 | openwebui | 是（docker） | webview |
| 命令行工具 | atlas 现状（Python CLI） | 是 | webview（atlas 已有 web 模块） |

> 注：外部 0→1 子项目位于独立仓库；本仓库只维护壳、内置子应用和可供外部项目阅读的 UI 规范。

---

## 3. 技术架构

### 3.1 技术栈

- **壳本体**：Tauri 2（Rust 内核 + macOS WebView 渲染）
- **壳前端**：React + TypeScript + Tailwind CSS
- **UI 规范**：`docs/ui-spec.md`（0→1 子项目由 AI 阅读后按规范实现，不引用 aIdea 仓库代码）
- **子应用技术栈**：自由（Python / Node / 静态 HTML / Docker 都行）

### 3.2 技术选型理由

- **Tauri 2 而非 Electron**：内存占用小（30-80MB vs 200MB+）、包小（~10MB）、macOS 原生 WebView、符合「紧凑」诉求
- **Tauri 2 而非纯 Web/PWA**：需要原生能力（进程管理、托盘、全局快捷键、原生菜单），纯 Web 做不到
- **React + TS**：主流前端栈，适合壳和内置子应用
- **Tailwind**：紧凑布局用 utility-first 最直接

### 3.3 整体架构

```
┌─────────────────────────────────────────────────┐
│           aIdea Shell (Tauri 2 应用)             │
│                                                  │
│  ┌──────────────┐    ┌──────────────────────┐  │
│  │  前端 (React) │◄──►│  Rust 核心           │  │
│  │              │ IPC│                      │  │
│  │  · 极简侧边栏 │    │  · 子进程管理        │  │
│  │  · 路由       │    │  · Manifest 加载     │  │
│  │  · Webview    │    │  · 配置存储          │  │
│  │    容器       │    │  · 日志落盘          │  │
│  │  · 内置页面   │    │                      │  │
│  └──────────────┘    └──────────────────────┘  │
└─────────────────────────────────────────────────┘
                       │
                       │ spawn / docker compose / 无进程
                       ▼
┌─────────────────────────────────────────────────┐
│  子应用进程（壳管理，但彼此独立）                 │
│                                                  │
│  · atlas (Python web 模块)   ← 0->1 全栈         │
│  · stock 助手 (Python/Node)  ← 0->1 全栈         │
│  · openwebui (docker)        ← 二开全栈          │
│  · dev tools (静态前端)      ← 无进程            │
│  · API 工具 (轻量脚本)       ← 按需启动          │
└─────────────────────────────────────────────────┘
```

### 3.4 关键设计原则

1. **壳与子应用解耦**：壳只负责 UI 容器 + 进程编排，不入侵子应用代码
2. **外部子项目独立**：0→1 项目位于独立仓库，只读取 `docs/ui-spec.md`，不引用 aIdea 代码或配置
3. **配置全集中**：所有可插拔配置在 `aIdea/apps/` 目录内
4. **进程隔离**：每个子应用进程互不影响，一个崩了不拖垮壳和其他子应用
5. **子应用内部布局自由**：Aidea 只管「显示哪个子应用」，不管子应用内部怎么布局

---

## 4. 目录结构

```
aIdea/                          # 壳项目本体（紧凑）
├── apps/                       # ✅ 子应用注册表（进 git，Aidea 集中管理）
│   ├── atlas.yaml
│   ├── stock-assistant.yaml
│   ├── openwebui.yaml
│   └── dev-tools.yaml          # 内置工具也用同套配置，path 指向 builtin-apps
├── shell.config.json           # ✅ 壳全局设置（进 git）
├── shell-frontend/             # 壳 UI
│   └── src/
│       ├── shell/              # 壳框架：极简侧边栏、路由、webview 容器
│       └── builtin-apps/       # 内置轻量子应用（dev-tools、api-tools）
├── shell-native/               # Tauri Rust 内核：进程管理、Manifest 加载
├── packages/
│   └── ui-kit/                 # UI 规范包（契约的一部分，0->1 子应用引用）
├── .runtime/                   # ❌ 运行时文件（gitignore）
│   ├── logs/                   # 子应用日志
│   ├── cache/                  # 缓存
│   └── pids/                   # 子进程 PID
├── docs/                       # 文档
└── .gitignore
```

### 4.1 文件分类

| 文件类型 | 内容 | 进 git |
|---|---|---|
| 配置文件 | `apps/*.yaml`、`shell.config.json` | ✅ |
| 源代码 | `shell-frontend/`、`shell-native/`、`packages/` | ✅ |
| runtime 文件 | `.runtime/`（日志、缓存、PID） | ❌ |

### 4.2 配置文件位置说明

**所有配置放在 Aidea 项目仓库内**（不放 `~/.aidea/`），理由：

1. 跨机器同步零成本（git clone 即可）
2. 配置可读可改可追溯（git history）
3. 与「可插拔配置都在 Aidea 项目内完成」原则一致
4. runtime 文件不污染仓库（`.runtime/` gitignore）

---

## 5. 子应用 Manifest 契约

### 5.1 Manifest 文件位置

每个子应用一个 yaml 文件，放在 `aIdea/apps/<id>.yaml`。

### 5.2 Manifest 完整 Schema

```yaml
# apps/atlas.yaml
id: atlas                          # 必填，唯一标识
name: Atlas CLI                    # 必填，显示名
version: 0.1.0                     # 必填，版本
category: dev-workflow             # 必填，分类（侧边栏分组用，自由字符串）
path: /Users/me/atlas          # 必填，子应用根目录（绝对路径）
status: active                     # 必填，active | disabled | deprecated

ui:                                # 必填
  mode: webview                    # 必填，webview | builtin | none
  url: http://localhost:5317       # mode=webview 时必填，子应用 web server URL
  icon: /Users/me/atlas/assets/icon.png  # 可选，图标路径（绝对路径）

process:                           # 可选，无进程的子应用（如 dev-tools）不写此段
  start: "python -m engine.web.app"  # 必填，启动命令
  stop: SIGTERM                    # 必填，停止方式（SIGTERM | SIGKILL | custom command）
  autostart: false                 # 可选，默认 false，Aidea 启动时是否自动拉起
  working_dir: /Users/me/atlas # 可选，默认用 path
  log_file: /Users/me/atlas/logs/atlas.log  # 可选，日志落盘位置
```

### 5.2.1 path 字段规则

- `mode: webview` 或 `mode: none`：`path` 是子应用根目录，**绝对路径**（如 `/Users/me/atlas`）
- `mode: builtin`：`path` 是壳内置页面入口，**相对项目根**（如 `shell-frontend/src/builtin-apps/dev-tools`），指向内置页面的目录

### 5.3 status 字段语义

| 值 | 含义 | 壳行为 |
|---|---|---|
| `active` | 正常启用 | 显示在侧边栏 |
| `disabled` | 临时禁用 | 不显示在侧边栏（升级中、暂时不用） |
| `deprecated` | 永久废弃 | 不显示，但保留配置记录（被吸纳/不再维护） |

> 注：合并 `enabled` + `status` 为单一字段，简化配置。

### 5.4 ui.mode 字段语义

| mode | 含义 | 用法 | 示例子应用 |
|---|---|---|---|
| `webview` | 嵌入外部 web 应用 | URL 指向子应用自己的 web server | atlas、stock、openwebui |
| `builtin` | 壳内置页面 | path 指向 `shell-frontend/src/builtin-apps/<name>` | dev-tools、api-tools |
| `none` | 无 UI，纯后台进程 | 只在侧边栏显示状态点 | 暂无（预留） |

> 移除原设计的 `terminal` 模式。所有 CLI 调用走「前端按钮 → 子应用后端 API」模式，不内置终端模拟器。

### 5.5 内置工具与外部应用统一机制

内置轻量工具（dev-tools）使用与外部子应用相同的 manifest 机制：

```yaml
# apps/dev-tools.yaml
id: dev-tools
name: DevTools
version: 0.1.0
category: tools
path: shell-frontend/src/builtin-apps/dev-tools   # 指向壳内目录
status: active
ui:
  mode: builtin
  # builtin 模式下，path 即是页面入口
# 无 process 段（纯前端，无后端进程）
```

---

## 6. UI 设计

### 6.1 整体布局（极简）

```
┌──────────────────────────────────────────────────────┐
│ ┌────────┐ ┌─────────────────────────────────────┐  │
│ │ ● ● ●  │ │                                     │  │
│ │        │ │                                     │  │
│ │ ⚙      │ │                                     │  │
│ │ ──     │ │                                     │  │
│ │ 📋●    │ │   子应用内容区 100% 占满            │  │
│ │ 📈     │ │   （子应用内部布局完全自由）         │  │
│ │ 🔧     │ │                                     │  │
│ │ 🌐●    │ │                                     │  │
│ │ +      │ │                                     │  │
│ │ ──     │ │                                     │  │
│ │ 📁     │ │                                     │  │
│ └────────┘ └─────────────────────────────────────┘  │
│  48px          剩余 100%                            │
│  顶部 28px 是 macOS 拖拽区（红绿圆点）              │
└──────────────────────────────────────────────────────┘
```

### 6.2 布局规格

| 元素 | 尺寸 | 备注 |
|---|---|---|
| 侧边栏 | 48px | 仅图标，hover 200ms 延迟浮出应用名 tooltip |
| macOS 拖拽区 | 侧边栏顶部 28px | 红绿圆点（关闭/最小化/最大化） |
| Tab 栏 | 无 | 一次只看一个子应用，切换走侧边栏 |
| 状态栏 | 无 | 运行状态用侧边栏图标右下角小点表示 |
| 主区域 | 剩余 100% | 完全交给子应用布局 |

**主区域占比**：1440x900 屏幕下，主区域约 1372x872（**97%**），舞台基本完全给子应用。

### 6.3 侧边栏图标设计

```
┌────┐
│ ●●●│  ← macOS 红绿圆点（顶部 28px 拖拽区）
├────┤
│ ⚙  │  ← 壳设置
├────┤
│ 📋●│  ← Atlas（运行中，右下角绿点）
│ 📈 │  ← Stock（未运行，无点）
│ 🔧 │  ← DevTools（无进程，无点）
│ 🌐●│  ← OpenWebUI（运行中）
│ +  │  ← 添加子应用（扫 apps/*.yaml 自动出现）
├────┤
│ 📁 │  ← 文件浏览（后期）
└────┘
```

**运行状态点**：
- 绿色实心点 `#3fb950`：进程运行中
- 无点：未启动 / 无进程

> 健康检查不在本期范围，故无「灰色点 = 健康检查失败」状态。后期加入健康检查时再扩展状态。

### 6.4 hover tooltip

鼠标悬停图标 200ms 后，浮出应用名 tooltip：

```
┌────┐
│ 📋●│  →  ┌──────────┐
└────┘     │ Atlas    │
           └──────────┘
```

侧边栏始终 48px，不展开。

### 6.4.1 右键菜单

侧边栏图标右键弹出上下文菜单（仅对有 `process` 段的子应用生效）：

| 菜单项 | 触发条件 | 行为 |
|---|---|---|
| 启动 | 进程未运行 | 执行 `process.start` |
| 停止 | 进程运行中 | 发送 `process.stop` 信号 |
| 重启 | 进程运行中 | 停止 → 等待退出 → 启动 |
| 查看日志 | 任意状态 | 打开日志浮层面板，tail `process.log_file` |
| 打开日志文件 | 任意状态 | 用 macOS 默认应用打开日志文件 |
| 在 Finder 中显示 | 任意状态 | 打开 `path` 指向的子应用目录 |

无 `process` 段的子应用（如 dev-tools）右键菜单只显示「在 Finder 中显示」。

### 6.5 配色（深色，跟随系统主题切换）

| token | 深色值 | 浅色值（跟随系统切到 light 时） |
|---|---|---|
| 背景主 | `#0d1117` | `#ffffff` |
| 背景次 | `#0a0c10` | `#f6f8fa` |
| 边框 | `#21262d` | `#d0d7de` |
| 文字主 | `#e6edf3` | `#1f2328` |
| 文字次 | `#7d8590` | `#656d76` |
| 强调色 | `#58a6ff` | `#0969da` |
| 成功（运行中） | `#3fb950` | `#1a7f37` |
| 危险 | `#f85149` | `#cf222e` |

主题切换遵循 [docs/ui-spec.md](../../ui-spec.md) 中的 shadcn CSS 变量规范。外部独立项目由 AI 读取 UI 规范后自行实现主题适配，不引用 aIdea 的组件包。

### 6.6 子应用内容区布局自由

子应用内部布局完全由子应用自己设计，Aidea 不干预。已确认的示例：

| 子应用 | 内部布局 |
|---|---|
| Atlas | 左菜单树（项目管理/工作流/三方）+ 右列表 |
| DevTools | 一个内置开发工具箱，顶部 tab 按需扩展；当前包含数据格式化、时间戳、IP 查询、AI 模型测试 |
| Stock 助手 | 三栏（自选股列表 + K线主区 + 五档盘口） |
| OpenWebUI | 二开，原样式不强求统一 |

---

## 7. 进程管理

### 7.1 进程管理档位：中量

| 能力 | 是否支持 |
|---|---|
| 启动 / 停止按钮 | ✅ |
| 运行状态显示（侧边栏图标点） | ✅ |
| 自启动（Aidea 启动时拉起） | ✅ |
| 日志面板（查看 stdout/stderr） | ✅ |
| 健康检查 | ❌（预留，后期需要再加） |
| 崩溃自动重启 | ❌（手动重启即可） |
| 资源占用监控（CPU/内存） | ❌ |
| 启动顺序/依赖关系 | ❌ |

### 7.2 进程管理流程

**启动子应用**：
1. 用户点击侧边栏图标 → 子应用未运行
2. 壳读 `apps/<id>.yaml` 的 `process.start` 命令
3. Rust 侧 spawn 子进程，记录 PID 到 `.runtime/pids/<id>.pid`
4. stdout/stderr 实时写入 `process.log_file` 指定的日志文件
5. 前端通过 IPC 监听进程状态变化，更新侧边栏图标状态点

**停止子应用**：
1. 用户点击运行中图标 → 弹出菜单 → 停止
2. Rust 侧按 `process.stop` 配置发信号（SIGTERM）或执行命令
3. 等待 5 秒未退出则 SIGKILL
4. 清理 PID 文件，更新状态点

**自启动**：
- Aidea 启动时扫描所有 `apps/*.yaml`
- 对 `process.autostart: true` 的子应用按字母序并行启动
- 启动失败仅记录日志，不阻塞 Aidea 启动

**日志面板**：
- 点击侧边栏图标右键 → 查看日志
- 浮层面板，实时 tail 日志文件最后 200 行
- 支持暂停/继续/清空/打开日志文件

### 7.3 无进程子应用

`process` 段不写的子应用（如 dev-tools）：
- 无启动/停止按钮
- 侧边栏图标不显示状态点
- 点击直接进入内容区

---

## 8. 壳全局设置

### 8.1 配置文件

`aIdea/shell.config.json`：

```json
{
  "theme": "auto",                // 主题：强制 auto（跟随系统）
  "data_dir": ".runtime",         // runtime 目录（相对项目根）
  "log_dir": ".runtime/logs"      // 日志目录
}
```

### 8.2 设置项说明

| 设置项 | 默认值 | 说明 |
|---|---|---|
| `theme` | `auto` | 强制跟随系统主题，不可改为固定值 |
| `data_dir` | `.runtime` | runtime 文件目录，相对项目根 |
| `log_dir` | `.runtime/logs` | 日志目录，相对项目根 |

> 不做复杂设置页。单文件 JSON + 简单 UI 面板即可。

---

## 9. Aidea 不管的边界

明确边界，避免越界：

| 子应用的 | Aidea 不管 |
|---|---|
| 内部布局 | 子应用自己设计（左菜单/三栏/任意布局都行） |
| 业务逻辑 | 子应用自己实现 |
| 数据存储 | 子应用自己存（数据库/文件都行） |
| 自己的用户系统 | 如 openwebui 自己的登录系统，Aidea 不管 |
| 路由/状态管理 | 子应用前端自己管 |
| 内部依赖 | 子应用自己装 npm/pip 依赖 |
| UI 风格 | 0→1 子应用建议引用 ui-kit 但不强制；二开应用不强求 |
| **凭证管理** | **子应用自己获取和存储第三方 API Token，Aidea 不介入** |
| 环境配置 | 子应用自己管理 `.env` 等环境配置 |

---

## 10. 后续规范（不属于本期设计）

aIdea 规范文档将在实现阶段持续维护，包含：

1. **UI 规范**：由 `docs/ui-spec.md` 维护，外部独立项目由 AI 阅读后自行实现
2. **manifest 字段约定**：apps/*.yaml 完整 schema（本文档已定义核心字段）
3. **菜单/路由约定**：子应用前端如何组织路由、如何处理「返回壳」等场景
4. **Python SDK**（如有需要）：如 atlas 重构时需要走壳 IPC 获取某些信息
5. **进程状态上报**（可选）：子应用如何上报健康状态给壳

---

## 11. 已确认的关键决策汇总

| # | 决策点 | 决定 |
|---|---|---|
| 1 | 使用场景 | 单机自用，无多用户体系 |
| 2 | 集成模式 | 混合：内部页面 + 外部 webview 嵌入 |
| 3 | 目标 OS | 仅 macOS |
| 4 | 进程管理档位 | 中量（启停 + 状态 + 自启 + 日志） |
| 5 | 技术栈 | Tauri 2 + React/TS + Tailwind |
| 6 | 目录结构 | `shell-frontend` + `shell-native` + `apps/` + `docs/ui-spec.md` |
| 7 | 配置位置 | 全部在 Aidea 项目仓库内（不放 `~/.aidea`） |
| 8 | 子应用路径 | 绝对路径，换机器手动改 yaml |
| 9 | status 字段 | 合并 enabled/disabled 为单一 `status` 字段 |
| 10 | UI 风格 | 深色，跟随系统主题切换 |
| 11 | 侧边栏 | 48px，仅图标，hover 浮出 tooltip |
| 12 | 顶栏 | 无（红绿圆点放侧边栏顶部 28px） |
| 13 | Tab 栏 | 无（一次只看一个子应用） |
| 14 | 状态栏 | 无（运行状态用侧边栏图标点） |
| 15 | terminal 模式 | 移除，CLI 调用走「前端按钮 → 子应用后端 API」 |
| 16 | 凭证管理 | Aidea 不管，子应用自己处理 |
| 17 | 子应用环境配置 | Aidea 不管，子应用自己管理 |
| 18 | 壳全局设置 | 极简，`shell.config.json` 单文件 |
| 19 | SDK | 不在本期设计，后续按需补充 |
| 20 | UI 规范 | 后续单独产出（ui-kit 引用方式、菜单/路由约定等） |

---

## 12. 风险与未决项

### 12.1 已知风险

1. **Tauri Rust 学习成本**：壳的 Rust 代码主要在进程管理模块，复杂度可控。若用户完全不想碰 Rust，可退回 Electron（但内存代价大）
2. **Tauri webview 嵌入限制**：部分子应用（如 openwebui）可能依赖 cookie/localStorage，跨 webview 实例的会话隔离需要验证
3. **macOS Keychain 不在本期使用**：凭证由子应用自管，未来若需统一 Vault 是纯增量，不影响当前架构

### 12.2 未决项（实现阶段再决定）

1. 壳的命令面板（⌘K）是否做、做到什么程度
2. 全局快捷键的具体配置
3. 日志面板的具体交互（暂停/继续/过滤等）
4. 多 webview 实例的会话隔离策略
5. 子应用间通信需求（如有，再设计）

---

## 13. 实现路线图（概要，详细计划由 writing-plans 产出）

1. **Phase 1 - 壳骨架**：Tauri 项目初始化、极简侧边栏、webview 容器、配置加载
2. **Phase 2 - Manifest 系统**：apps/*.yaml 加载、子应用注册、侧边栏动态生成
3. **Phase 3 - 进程管理**：spawn/stop、状态显示、自启动、日志面板
4. **Phase 4 - 内置工具**：dev-tools 内置页面、ui-kit 基础组件
5. **Phase 5 - 主题系统**：跟随系统主题、ui-kit token 双套
6. **Phase 6 - 打磨**：设置页、快捷键、错误处理、文档

详细实现计划由后续 writing-plans skill 产出。
