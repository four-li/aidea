# aIdea AI Service 契约

本文定义 aIdea 内置应用 AI Service 为官方应用提供的本机 AI 能力。它只面向 aIdea 自己开发的子应用，不是面向第三方应用的通用插件接口。

产品名称和内部应用 ID 统一使用 **AI Service** / `ai-service`。数据目录为 `app-data/ai-service`，官方应用使用 `AIDEA_AI_SERVICE_*` 环境变量；不保留旧的网关命名兼容层。

## 定位

AI Service 是独立的内置应用，包含模型配置、模型测试页面和 Rust 后端。后端在 aIdea 进程内提供本机 HTTP 服务；它不是独立官方应用，也不使用 App Bridge。

AI Service 负责：

- 保存多个 AI 提供方、模型、Base URL 和 API Key 配置，并维护默认排序。
- 根据服务类型调用 OpenAI 兼容服务，或可选的本机 Codex app-server。
- 使用 Rig 执行 Agent 循环和工具调用。
- 执行本机工具、超时、输出限制、错误转换和基础命令安全策略。
- 维护内部服务注册表，向 UI 展示当前已提供的服务。
- 记录调用过程的脱敏审计元数据、loop 耗时和提供方返回的 token 用量。

子应用负责：

- 编写自己的提示词模板。
- 将业务内容拼接进 `message`。
- 按自己的业务约定解析 `data`。

提示词、业务流程和结果含义不由 AI Service 解析。模型配置、上游 API Key、Agent 工具列表和安全策略都属于 AI Service 内部实现，不属于子应用契约。

## 服务地址

AI Service 只监听回环地址：

```text
http://127.0.0.1:43880
```

`43880` 是 aIdea 保留的固定端口。官方应用实际应使用 aIdea 注入的 `AIDEA_AI_SERVICE_URL`，不得自行选择端口、扫描端口或从上游 AI 配置推导端口。

## 模型配置

AI Service 可以保存多个模型配置。每项配置包含提供方、Base URL、API Key、模型名和稳定配置 ID；API Key 只保存于 `app-data/ai-service/app.db`，不进入子应用请求或 `exec` 子进程环境。

模型配置页面支持新增、编辑、删除和拖拽排序。服务未绑定具体模型时，使用排序第一的可用配置作为默认模型。

服务可以绑定某个已配置的模型，也可以选择“跟随默认”。绑定模型被删除或不可用时，服务显示未配置并拒绝新请求，不静默切换到其他模型。

## 服务接口

AI Service 使用 `/api` 作为本机服务命名空间。当前 Agent 服务的固定接口是：

```http
POST /api/agent
Content-Type: application/json
Authorization: Bearer <AIDEA_AI_SERVICE_TOKEN>
```

请求体只有 `message` 字段：

```json
{
  "message": "读取 /Users/fourli/xxx-project 目录的代码变更，生成符合 Conventional Commits 规范的 commit message"
}
```

`message` 可以同时包含提示词模板、目标目录、业务输入和输出格式要求。子应用不得提交模型名、Base URL、API Key、工作目录字段、工具列表、模型参数或流式参数。

空消息应被拒绝。除 `message` 外的请求字段不属于 Agent 服务契约，AI Service 不保证兼容。

当前没有 `/api` 的 Agent 兼容别名。图片、视频和流式能力以后按协议分别增加 `/api/image-gen`、`/api/video-gen` 和 `/api/agent/stream`，不把不同协议混在 Agent 请求中。

HTTP 层只负责传输和请求校验，任务结果仍以响应体中的 `code` 为准：

| HTTP 状态 | 用途 |
| --- | --- |
| `200` | 请求已通过校验并执行完成；模型成功时 `code` 为 `0`，模型失败、工具失败、用户拒绝授权或任务超时时仍返回统一错误体和非零 `code`。 |
| `400` | JSON 无效、请求不是对象、`message` 缺失或为空。 |
| `401` | Bearer Token 缺失或无效。 |
| `500` | AI Service 内部无法形成统一响应。 |
| `503` | AI Service 尚未就绪或没有可用模型配置。 |

能够形成统一响应时，`4xx` 和 `5xx` 也使用 `{ "code": 非零, "data": "", "message": "..." }`；子应用应优先读取响应体，无法取得响应体时再按网络错误处理。`message` 的最大请求体大小由 AI Service 内部限制，超过限制时按 `400` 处理；该限制不增加子应用请求字段。

## Agent 响应

成功响应：

```json
{
  "code": 0,
  "data": "feat(order): 完成订单对接功能 #1001"
}
```

失败响应：

```json
{
  "code": 1001,
  "data": "",
  "message": "AI 任务执行超时"
}
```

约定如下：

- `code: 0` 表示任务成功；非零值表示失败。
- `data` 始终是字符串。
- `message` 只在失败响应中提供，用于排查和展示错误。
- 当子应用需要 JSON 业务结果时，由提示词要求模型返回 JSON 文本，AI Service 将这段文本原样放入 `data`，子应用自行解析。
- AI Service 不把上游响应直接暴露给子应用，也不根据业务猜测或转换 `data` 的结构。

例如邮件中心可以要求：

```text
请分析以下邮件，剔除广告和垃圾内容，筛选有价值的邮件，严格按照给定 JSON 格式返回，不要使用 Markdown 代码块。

邮件 1：...
邮件 2：...
```

AI Service 仍返回：

```json
{
  "code": 0,
  "data": "{\"useful_emails\":[...],\"spam_emails\":[...]}"
}
```

不同服务可以拥有自己的成功响应结构，但共享认证、基础 HTTP 错误处理和审计入口。Agent 的 `data` 仍始终是字符串；邮件中心需要 JSON 时由提示词要求模型返回 JSON 文本，子应用自行解析。

## 服务列表

AI Service 内部维护服务注册表，页面展示当前真正启用的服务 ID、路径、协议、能力说明和状态。首期只展示 `agent`；图片、视频和 SSE 只有在实际实现后才加入列表。

服务列表不是给子应用运行时发现服务的 HTTP 接口。子应用按开发手册使用确定的服务路径，不需要查询或选择模型。

服务列表页面同时提供每个服务的模型选择：可以选择某个已配置模型，或恢复为“跟随默认”。

## Agent 与内部工具

AI Service 将 `message` 作为本次任务的用户指令，内部根据 AI Service 页面保存的配置选择模型和后端。子应用不感知内部协议。

当任务需要读取目录、修改文件或执行命令时，AI Service 在 Rig Agent 循环中向模型提供通用工具：

```text
模型请求工具 -> AI Service 执行工具 -> 工具结果回传模型 -> 继续请求模型
```

首期工具固定为：

- `read_file(path, start_line?, end_line?)`：读取绝对路径文件的全部或指定行。
- `write_file(path, content)`：写入绝对路径文件，使用原子替换；首期直接允许，不要求用户确认。
- `edit_file(path, old_text, new_text)`：`old_text` 必须在已有文件中恰好匹配一次，然后使用原子替换；不支持正则、模糊匹配或复杂 Patch。
- `exec(command, cwd)`：在绝对路径 `cwd` 中执行命令。AI Service 使用 `/bin/zsh -f -c`，保留管道、重定向、`git`、`curl` 和脚本能力，但不加载用户 Shell 启动脚本。
- `search(path, pattern, glob?, max_results?)`：使用 AI Service 自带的 ripgrep 执行内容搜索和文件 glob 搜索，不依赖用户 PATH 中是否安装 `rg`。
- `list_dir(path, depth?)`：列出目录结构，供 Agent 发现文件。

`cwd`、文件路径和工具参数是模型调用 AI Service 内部工具时使用的字段，不是子应用 `/api/agent` 请求字段。子应用只在 `message` 中说明目标目录和任务。工作目录由模型在调用 `exec` 时明确传入；AI Service 不从 `/api/agent` 请求字段读取工作目录，也不默认使用进程当前目录。

不提供 `git_status`、`http_request`、`run_test`、`copy_file`、`move_file` 等业务或命令专用工具。Git、测试、构建、Redmine 脚本和网络请求由 `exec` 处理；`http_request` 不重复建设，因为 Shell 中可以调用 `curl`。

### 工具运行限制

这些限制属于 AI Service 内部实现，不属于子应用契约：

- 整个任务最多运行 120 秒。
- 单次 `exec` 最多运行 30 秒。
- 单次任务最多 12 轮 Agent 调用。
- 单次工具输出最多 100 KiB；超限时工具主动截断或终止子进程。
- 支持取消正在运行的任务。
- 单个 `/api/agent` 请求独立运行，使用请求开始时的模型配置快照；请求之间不共享 Agent 状态或工具调用结果。
- 多个请求可以并行执行；同时写入同一文件时不保证顺序，最后一次成功的原子替换可能覆盖前一次结果，子应用应避免这种并发。

工具结果只回传给 Agent，不向子应用暴露工具调用过程；任务结束后，模型最终文本写入响应的 `data`。

### `exec` 基础安全策略

AI Service 采用“用户权限级可信自动化”，不是强隔离沙箱。所有命令先经过 AI Service 统一的 CommandGuard：

- `git status`、`git diff`、`git add`、普通 `git commit`、普通 `git push`、`curl`、构建和测试默认允许。
- `rm -r`、`rm -rf`、`git reset --hard`、`git clean`、`git push --force`、删除分支或标签、`curl -X DELETE` 等高风险命令需要 AI Service UI 授权。
- `sudo`、`su`、`doas`、`mkfs`、`diskutil erase`、`shutdown`、`reboot` 等命令直接拒绝。

需要授权的命令由 AI Service UI 在当前任务期限内处理：用户批准后继续当前工具调用，用户拒绝或任务超时则返回任务失败；不增加公开的任务查询或授权接口。没有 UI 可用时不会自动批准高风险命令。

CommandGuard 只拦截常见的高破坏力命令，不分析脚本内部逻辑，也不承诺对恶意脚本提供强隔离。`write_file` 和 `edit_file` 按已确认的本机可信自动化约定直接执行，并使用原子写入减少写入中断造成的数据损坏。

`exec` 子进程使用 AI Service 为其准备的最小运行环境，不继承 AI Service 的上游 API Key、`AIDEA_AI_SERVICE_TOKEN` 或其他内部凭据。AI Service 不记录完整 `message`、工具参数、工具输出或最终 `data`；日志只保留脱敏后的生命周期、错误和耗时信息。

邮件正文、Redmine 内容、代码注释和其他由 `message` 引入的外部文本都按不可信数据处理。AI Service 的系统提示词必须要求模型区分顶层任务指令与引用内容，不得仅依据引用内容中的指令执行命令或修改文件。该约定降低提示词注入风险，但不提供强隔离保证。

### 工具基本语义

- 文件工具只处理 UTF-8 普通文件；无法按 UTF-8 读取的文件返回工具错误。
- `read_file` 的行号从 `1` 开始且范围包含首尾行；未指定范围时读取全部内容，仍受工具输出上限限制。
- `write_file` 可以创建或覆盖文件，但不会自动创建父目录；目标必须是普通文件路径。
- `edit_file` 要求目标文件已经存在，`old_text` 按字节内容恰好匹配一次；匹配失败或多次匹配时不修改文件。
- `exec` 将退出码、标准输出和标准错误作为工具结果返回；非零退出码不会直接结束 Agent，由模型决定是否修正后重试。
- `search` 和 `list_dir` 的结果遵守相同的工具输出上限；截断时必须在结果中明确标记，避免模型把不完整结果当成完整结果。

## 审计记录

AI Service 单独记录 AI 调用审计，不把它混入 aIdea 普通运行日志。数据保存在 `app-data/ai-service/app.db`，页面通过内置应用 IPC 查看，不提供公开的审计查询 HTTP 接口。

一次调用记录一个 run；模型轮次、工具调用、授权等待和最终结果记录为有序 event。run 至少包含：

- 服务 ID、状态、开始时间、结束时间和总耗时。
- Agent loop 次数。
- 提供方返回的 input、output、total token；提供方未返回时显示“未提供”。
- 脱敏后的错误摘要。

event 至少包含：

- 顺序号、事件类型、事件名称和耗时。
- 当前模型轮次的 token 增量（如果有）。
- 可展示的短摘要。

审计日志提供全局开关，默认开启。关闭后只停止新调用的审计记录，不删除历史数据；已开始的调用按照开始时的开关状态完成记录。审计页在关闭状态显示明确提示，历史记录仍可查看。

AI Service 使用统一的 `AuditRecorder` 打点入口包裹请求开始、模型轮次、工具调用、授权等待和请求结束。关闭时先走无操作快路径：只读取一个内存中的开关，不创建数据库连接、不格式化摘要、不复制提示词或工具结果，也不向后台写入事件。打点失败只记录 AI Service 自身的脱敏告警，不得改变模型请求结果。

审计页展示调用列表和单次调用时间线，并区分总耗时、模型耗时、工具耗时和授权等待耗时。图片或视频服务以后可以记录自己的非 token 用量，不能假设所有服务都按 token 计费。

默认不保存完整 `message`、完整模型响应、邮件正文、完整 diff、完整命令输出或任何凭据。工具摘要需要做长度限制和常见凭据脱敏。首期不区分子应用 token，因此审计记录不保证显示可靠的调用来源；来源可以显示为“未知”。

## 内部后端

AI Service 页面负责保存模型配置，并为服务选择具体模型或“跟随默认”。内部后端包括：

- OpenAI 兼容服务：首期使用 Rig；由 AI Service 内部选择 Responses、Chat Completions 或其他上游协议。
- Codex app-server：后续作为代码处理、复杂编辑和代码诊断的可选增强后端，由 AI Service 内部适配。

不同服务路由可以使用不同的内部后端，但子应用不得直接访问上游服务、API Key 或 Codex app-server。

## Rig 实现与升级

Rig 只负责 Agent 运行时、模型适配、工具 Schema、工具调用循环和工具结果回传。`read_file`、`write_file`、`edit_file`、`exec`、`search`、`list_dir` 由 AI Service 自己实现并注册给 Rig；Rig 类型不得泄漏到子应用接口。

实现时使用 Rig 根 facade，并精确锁定实际采用的版本；不要让 Rig 的破坏性升级影响 `/api/agent` 契约。升级 Rig 时只改 AI Service：阅读 release notes、适配内部工具注册和运行时 API、回归六个工具及超时和错误路径。只要 `/api/agent` 请求和响应契约不变，官方应用不需要改代码或重新发布。

不引入 Pi、Goose、Node/Python sidecar 或自建第二套 Agent 循环。Codex、Grok Build 和 Pi 的工具边界、搜索限制、审批、取消和 Hook 设计可以作为实现参考，但不整体移植。

## 运行环境

aIdea 启动官方应用时注入：

| 变量 | 用途 |
| --- | --- |
| `AIDEA_AI_SERVICE_URL` | AI Service 基础地址。 |
| `AIDEA_AI_SERVICE_TOKEN` | AI Service 保存的受管应用访问令牌；它不是上游 API Key。 |

AI Service 首次生成令牌后保存到自己的 `app-data/ai-service/app.db`，后续启动复用。API Key 不注入子应用环境，也不得写入子应用日志。访问令牌和上游 API Key 是两种不同的凭据。

## 当前范围

- 子应用当前只使用同步 JSON `/api/agent` 接口。
- 当前不定义 SSE 响应格式；以后确有流式需求时增加独立的 `/api/agent/stream` 契约。
- 当前不提供图片和视频接口；真实需求出现后分别增加 `/api/image-gen` 和 `/api/video-gen` 契约。
- `/v1/responses` 和 `/v1/chat/completions` 只属于 AI Service 内部上游适配，不属于子应用契约。
- 图片、视频等模型能力以后按真实业务需求增加，不提前改变当前 `data` 字符串契约。
- AI Service 页面包含模型配置、服务列表、模型测试和审计记录；具体视觉实现遵循 UI 规范。
