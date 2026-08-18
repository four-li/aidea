# aIdea 官方应用规范

本文定义独立维护的 aIdea 官方应用的市场、安装和运行契约；内置应用不适用。

## 市场

完整定义位于应用仓库根目录 `aidea.yaml`。官方市场仓库只维护一个
`market.yaml`，其中决定应用是否可见及其仓库地址：

```yaml
schema_version: 1
apps:
  example:
    schema_version: 1
    repository: https://gitee.com/aidea-org/example.git
    enabled: true
```

市场链路固定为 `market-source.yaml` -> 市场仓库 Raw `market.yaml` -> 应用仓库
`aidea.yaml`。刷新市场时，aIdea 通过 Gitee、GitHub 或 GitLab（包括自建实例）的 Raw 地址读取
单一市场索引和每个已启用应用默认分支的 manifest，绝不 clone 应用仓库；自建 GitLab 使用其仓库的 HTTP 或 HTTPS 地址。
市场索引读取失败时继续使用最近一次成功缓存；索引成功后逐个读取应用 manifest，单个应用失败不阻断其他应用，成功项整体替换本地缓存，失败项仅显示为不可安装的占位卡片。

新增应用、变更仓库地址或启用状态时才修改市场仓库。日常版本发布不修改市场收录。

## Manifest

官方应用只支持 macOS Apple Silicon（arm64）的自包含 binary 包。用户不需要安装
Rust、Cargo、Node、npm、Python 或 SQLite；应用需要的运行时和依赖必须包含在包中。
源码调试直接在应用仓库进行，不是市场安装方式。

```yaml
schema_version: 1
id: mail-center
name: 邮件中心
description: 本地多账户 IMAP 邮件管理
category: 效率
version: 0.2.0
icon: Mail
artifact:
  url: https://gitee.com/aidea-org/mail-manager/releases/download/v0.2.0/mail-center-0.2.0-darwin-arm64.tar.gz
  sha256: 359e4b637e76b4b21b9fd5c112911e4c21918a9818913f8dbec2beda487570b9
process:
  command: [mail-center]
  working_directory: .
  ready_url: http://127.0.0.1:43130/health
```

- 字段只能是上述定义中的字段；`revision`、`runtime`、`install`、`update_notes`、
  `min_aidea_version` 和 `settings` 都会被拒绝。
- `id` 是全局唯一 kebab-case，安装后不能更名。
- `version` 必须是三段单数字 `X.Y.Z`。补丁位到 `9` 后进位，例如
  `0.1.9 -> 0.2.0`；不使用 `0.1.10`。用户可见功能、界面、交互、设置、数据格式或
  业务行为变化时，正式发布流程必须升版本；开发阶段不自动改版本号。
- `artifact.url` 必须是 Gitee、GitHub 或 GitLab（包括自建实例）同仓库 Release 的 HTTP 或 HTTPS `.tar.gz` 附件地址，且与市场收录的
  `repository` 是同一协议、同一 host/port、同一仓库，Release tag 必须为 `v<version>`；`artifact.sha256` 必须是 64 位小写十六进制值。
- `process.command` 是参数数组，`command[0]` 必须是包根目录中实际存在的单架构 arm64 Mach-O 裸二进制文件名，禁止 shell、脚本、universal binary 和路径；
  aIdea 不会从用户本机 `PATH` 解析 Node、Python 或其他运行时。
  `working_directory` 必须在安装目录内，`ready_url` 必须是
  `http://127.0.0.1:<port>/health`。
- aIdea 直接执行解压后包根中的 `command[0]`，并将包根作为子进程唯一的 `PATH`；不支持 `process.path`、
  多架构选择或 Intel 回退。

包内所有条目必须共享同一个顶层路径分量，且不得有顶层直接文件、绝对路径、`..`、符号链接或硬链接。
不要求 tar 文件额外包含该目录的显式条目。例如：

```text
mail-center-0.2.0-darwin-arm64/
├── mail-center
└── public/
```

## 安装与运行

aIdea 下载附件后先校验 SHA-256，再受限解压到 staging，使用临时数据和日志目录执行
`/health` 检查。检查成功才替换已安装的 `source/`。下载、校验、解压或健康检查失败时
清理 staging 并保留旧版本；运行中的应用更新失败时恢复旧 `source/`、安装记录和运行状态。

安装记录只保存 `id`、`version`、`status` 与严格的 manifest 快照，用于离线启动、卸载和排查；它不是市场缓存。
官方应用服务只监听 `127.0.0.1`，且必须提供快速的 `GET /health` 响应。aIdea 对单次请求最多等待
1 秒，并在启动后的 15 秒内每 100ms 重试；任意 HTTP 2xx 响应即代表服务可用，不校验响应体或
`Content-Type`。健康检查不检查邮件服务器等外部依赖。

启动时 aIdea 注入：

| 变量 | 用途 |
| --- | --- |
| `AIDEA_APP_ID` | 当前应用 ID。 |
| `AIDEA_APP_DATA_DIR` | 应用数据目录；数据库固定为其中的 `app.db`。 |
| `AIDEA_APP_LOG_DIR` | 应用日志目录。 |
| `AIDEA_LOG_LEVEL` | 当前日志级别：`warn`、`info` 或 `debug`；应用应据此控制 stdout/stderr 和自身日志文件的详细程度。 |
| `AIDEA_AI_SERVICE_URL` | aIdea AI Service 基础地址；应用按 [AI Service 契约](aidea-ai-service.md) 调用当前服务路径 `/api/agent`。 |
| `AIDEA_AI_SERVICE_TOKEN` | AI Service 保存的访问令牌；它不是上游 API Key。 |
| `PATH` | 解压包根目录。 |

子进程环境会被清空，应用不得依赖上表以外的环境变量，包括 `HOME`、`LANG` 和 `TMPDIR`。临时文件、
配置和缓存都必须由应用在已注入的数据或日志目录中管理。应用不得读取 aIdea 或其他应用数据库，
也不得在日志中记录密码、授权码、邮件正文或通知正文。

应用及其派生子进程必须处理 `SIGTERM`，在收到信号后及时完成必要持久化并退出。停止时 aIdea 向整个
应用进程组发送 `SIGTERM`；5 秒内仍未退出时发送 `SIGKILL`，之后不保证继续执行清理逻辑。

壳会采集官方应用与 staging 健康检查进程的 stdout/stderr，分别作为运行和安装更新日志保留；每行可用 `DEBUG`、`INFO`、`WARN` 或 `ERROR` 前缀声明级别，未声明时按 INFO 处理。应用不得向 stdout、stderr 或 `AIDEA_APP_LOG_DIR` 输出密码、授权码、OAuth 令牌、API Key、邮件正文或通知正文。应用负责业务日志，aIdea 负责平台与生命周期日志；普通业务点击不记录，异常必须记录。

官方应用服务端日志必须按 `LEVEL event key=value` 的单行格式输出，并读取 `AIDEA_LOG_LEVEL`（缺省 `info`）。应用不直接写第二套日志文件；壳负责时间、来源、通道和最终过滤。运行期非预期异常（包括数据库/迁移、文件系统、进程、网络、远端服务、请求处理和后台任务失败）必须记录；启动、外部请求失败与重试、核心业务失败和退出异常也必须记录。API 返回的 5xx 和远端请求失败由后端在最终处理边界记录，前端不得重复记录已收到 HTTP 响应的 API 错误；未拿到 HTTP 响应的网络故障由前端补充记录。底层错误只在最终边界记录一次，不增加全量 access log。预期参数校验、用户取消、未配置和正常 404 不作为 `ERROR` 记录。不得记录完整 URL 查询参数、完整 Diff、完整响应体或任何业务正文。

官方应用前端的未处理异常不会自动进入壳日志。应用必须提供只监听 `127.0.0.1` 的受限 `POST /api/client-log`，由前端发送脱敏的级别、事件名和短消息，服务端校验长度和级别后输出 stdout/stderr；接口失败不得阻塞业务或循环重试。该接口是应用内部 HTTP 能力，不是 App Bridge 扩展。

## 壳通信与设置

官方应用不得使用 Tauri IPC、`@tauri-apps/api`、`window.__TAURI__`、`AIDEA_COMMAND`、
aIdea Rust 命令或壳前端封装。壳与官方应用的运行期通信只使用
[App Bridge](aidea-app-bridge.md) 的 `postMessage` 契约。

官方应用调用 AI 能力时，按 [AI Service 契约](aidea-ai-service.md) 使用注入的 AI Service 地址和令牌；不得直接访问上游 AI 服务或读取 API Key。

aIdea 首次加载时追加 `aidea_theme=light|dark`，页面 `ready` 后由 Bridge 的 `theme` 保持同步。
搜索是应用自身能力，不经 Bridge。账户、同步和其他业务设置由应用主页面进入、校验并保存；
aIdea 应用管理只管理显示与启动偏好，不提供官方应用业务设置页。

## 发布

调用 `$aidea-app-release` 即授权一次完整发布：预检版本四件套和远端冲突、自动递增版本、测试、构建包、
校验 arm64 包结构并计算 SHA-256、写入 manifest、创建并 push 唯一发布提交、创建 tag 与对应平台 Release、
上传附件、下载附件复验 SHA-256。流程正常时不重复请求授权；沙箱、网络或 Git 写入受限时应直接申请提升权限。

更新日志唯一来自应用仓库 Release 正文。Skill 根据本次改动生成简短更新摘要，不在 manifest
维护第二份更新说明。tag 或 Release 冲突、远端结果不明、测试失败、疑似密钥或无法确认改动归属
时停止并报告，绝不覆盖已有远端资源。

首次发布、仓库地址变化或启用状态变化时，Skill 才读取市场收录参考并更新市场仓库；正常发布不
触碰市场仓库。

## 邮件中心

邮件中心应用 ID 固定为 `mail-center`，数据库固定为
`AIDEA_APP_DATA_DIR/app.db`。它不迁移、不读取、不兼容旧内置邮件的账户、索引、凭据或数据库；
aIdea 也不提供旧邮件兼容层。邮件正文、富文本和第三方 HTML 必须在浅色与深色主题中独立验收。
