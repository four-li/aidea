# aIdea 开发手册

`docs/guide/` 是 aIdea 当前开发契约的唯一 Markdown 来源。aIdea 内置的“开发手册”页面直接渲染本目录内容；页面不另存一份文案。本文是阅读入口和目录，不重复各专题的具体规则。

## 开发前必读

1. 先读仓库根目录的 `AGENTS.md`，了解协作、修改和验证约束。
2. 再读本文，根据任务进入对应专题文档。
3. 一项任务同时涉及多个专题时，全部阅读；专题文档之间冲突时，以更具体的专题为准。
4. `docs/superpowers/specs/` 与 `docs/superpowers/plans/` 只保留历史设计和实施过程，不是当前契约。

独立官方应用仓库还必须先读自己的 `AGENTS.md`，再读取 aIdea 仓库中本文和下表要求的文档。不得根据旧实现、历史计划或猜测使用尚未实现的平台能力。

## 核心概念

| 概念 | 定义 | 开发入口 |
| --- | --- | --- |
| aIdea 壳 | 本机桌面应用平台，负责应用生命周期、展示、运行记录和自身更新。 | [平台规范](aidea-platform.md) |
| 内置应用 | 位于本仓库、随 aIdea 一起构建和发布的独立应用；前端通过 Tauri IPC 调用自身 Rust 业务代码。 | [内置应用规范](aidea-builtin-app.md) |
| 官方应用 | 位于独立仓库、独立进程、独立发布的自研应用；由 aIdea 安装、启动和展示。 | [官方应用规范](aidea-official-app.md) |
| App Bridge | 壳与官方应用 Web 页面之间的 `postMessage` 通信契约。 | [App Bridge](aidea-app-bridge.md) |
| AI Service | aIdea 的独立内置应用，为官方应用提供统一本机 AI Agent 接口；不向子应用暴露模型配置或 API Key。 | [AI Service 契约](aidea-ai-service.md) |

“开搞中心”是 aIdea 壳提供的统一入口和窄图标栏，不是一个内置应用，不拥有 manifest、数据库或业务设置。DevTools、AI Service 以及后续内置应用仍然各自独立维护页面、IPC、数据和设置；开发手册是从右上角设置菜单打开的壳内文档页面，不属于开搞中心应用栏。

## 阅读路由

| 当前任务 | 必读文档 |
| --- | --- |
| 理解平台边界、应用生命周期、端口、运行环境 | [平台规范](aidea-platform.md) |
| 新增或修改内置应用、manifest、Tauri IPC | [内置应用规范](aidea-builtin-app.md)、[UI 规范](aidea-ui.md) |
| 新增或修改官方应用、`aidea.yaml`、安装、启动、更新 | [官方应用规范](aidea-official-app.md)、[平台规范](aidea-platform.md) |
| 官方应用与壳通信、主题、通知、应用内跳转 | [App Bridge](aidea-app-bridge.md) |
| 子应用调用 AI、模型配置、Agent 工具、Rig 升级 | [AI Service 契约](aidea-ai-service.md) |
| 数据库、迁移、备份、缓存、敏感信息 | [数据与存储规范](aidea-storage.md) |
| 页面视觉、组件、交互、主题、无障碍 | [UI 规范](aidea-ui.md) |
| 应用内搜索 | [应用内搜索规范](aidea-search.md) |
| 发布 aIdea、改版本、构建 DMG、更新清单 | [aIdea 发布规范](aidea-release.md)，并调用 `$aidea-release` Skill |
| 发布独立官方应用 | [官方应用规范](aidea-official-app.md)，并调用 `$aidea-app-release` Skill |

## 文档职责

| 文档 | 唯一职责 |
| --- | --- |
| [平台规范](aidea-platform.md) | 平台边界、两类应用职责、生命周期和壳提供的运行环境。 |
| [内置应用规范](aidea-builtin-app.md) | 内置应用目录、注册、IPC、设置和测试约定。 |
| [官方应用规范](aidea-official-app.md) | 官方应用 manifest、包结构、安装运行和官方应用发布。 |
| [App Bridge](aidea-app-bridge.md) | 官方应用 WebView 运行时通信协议。 |
| [AI Service 契约](aidea-ai-service.md) | 子应用 AI 接口、AI Service Agent、内部 Rig 依赖和升级纪律。 |
| [数据与存储规范](aidea-storage.md) | 数据目录、SQLite、迁移、缓存、备份和敏感数据。 |
| [UI 规范](aidea-ui.md) | 视觉与交互基线、主题、shadcn/ui 和无障碍。 |
| [应用内搜索规范](aidea-search.md) | 搜索交互的统一行为。 |
| [aIdea 发布规范](aidea-release.md) | aIdea 自身版本、产物、更新与发布边界。 |

## 文档治理

长期规则应写入对应专题文档，而不是复制到多个文件、Skill 或页面文案中。一次决策只保留一个权威位置，其他文档只链接过去。

- 改变平台边界、应用生命周期、跨应用通信、数据格式、发布方式或子应用接口时，先更新对应专题文档，再改实现；实现完成后检查受影响文档是否仍准确。
- 需要保留决策原因时，在对应专题文档的“关键决策”小节说明原因和不采用的方案；不要为每个小决定新建 ADR 或历史记录。
- 未确认的设想不写成契约。先在讨论或设计记录中澄清，确认后再归入唯一专题文档。
- Skill 可以要求 Agent 阅读和更新文档，但不得复制或自动追加规则。修改长期规则时，应先判断其唯一归属，再更新该文档和必要的交叉链接。
- 文档改动至少执行 `git diff --check`，并检查新增或修改的 Markdown 链接。

当前不提供“输出全部 Guide”的 CLI。开发环境中的 Agent 直接读取本目录 Markdown；额外 CLI 会形成第二个维护入口。只有官方应用开发不再能访问 aIdea 源码仓库时，才重新评估提供只读文档包或查询命令。
