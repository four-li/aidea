# aIdea AI 网关契约

本文定义 aIdea 内置应用 `ai-gateway` 为官方应用提供的本机 AI 能力。它只面向 aIdea 自己开发的子应用，不是面向第三方应用的通用插件接口。

## 定位

`ai-gateway` 是 aIdea 的内置应用，包含配置页面、模型测试页面和 Rust 后端。后端在 aIdea 进程内提供本机 HTTP 服务；它不是独立官方应用，也不使用 App Bridge。

AI 网关负责：

- 保存当前使用的 AI 提供方、模型、Base URL 和 API Key。
- 根据配置调用 OpenAI 兼容服务，或可选的本机 Codex app-server。
- 执行 Agent 循环和通用工具调用。
- 向子应用返回统一的 JSON 结果。

子应用负责：

- 编写自己的提示词模板。
- 将业务内容拼接进 `message`。
- 按自己的业务约定解析 `data`。

提示词、业务流程和结果含义不由 AI 网关解析。

## 服务地址

AI 网关只监听回环地址：

```text
http://127.0.0.1:43880
```

`43880` 是 aIdea 保留的固定端口。官方应用实际应使用 aIdea 注入的 `AIDEA_AI_GATEWAY_URL`，不得自行选择端口、扫描端口或从上游 AI 配置推导端口。

## 子应用接口

子应用只调用一个固定接口：

```http
POST /api
Content-Type: application/json
Authorization: Bearer <AIDEA_AI_GATEWAY_TOKEN>
```

请求体只有 `message` 字段：

```json
{
  "message": "读取 /Users/fourli/xxx-project 目录的代码变更，生成符合 Conventional Commits 规范的 commit message"
}
```

`message` 可以同时包含提示词模板、工作目录、业务输入和输出格式要求。子应用不得提交模型名、Base URL、API Key、供应商协议、工具列表或其他网关内部参数。

空消息应被拒绝。除 `message` 外的请求字段不属于当前契约，网关不保证兼容。

## 统一响应

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
- 当子应用需要 JSON 业务结果时，由提示词要求模型返回 JSON 文本，网关将这段文本原样放入 `data`，子应用自行解析。
- 网关不把上游响应直接暴露给子应用，也不根据业务猜测或转换 `data` 的结构。

例如邮件中心可以要求：

```text
请分析以下邮件，剔除广告和垃圾内容，筛选有价值的邮件，严格按照给定 JSON 格式返回，不要使用 Markdown 代码块。

邮件 1：...
邮件 2：...
```

网关仍返回：

```json
{
  "code": 0,
  "data": "{\"useful_emails\":[...],\"spam_emails\":[...]}"
}
```

## Agent 执行

AI 网关把 `message` 作为本次任务的用户指令，内部根据 AI 网关页面保存的配置选择模型和后端。子应用不感知内部协议。

当任务需要读取目录、修改文件或执行命令时，网关在 Agent 循环中向模型提供通用工具，并执行模型返回的工具调用：

```text
模型请求工具 -> AI 网关执行工具 -> 工具结果回传模型 -> 继续请求模型
```

首期通用工具只有：

- `read_file(path, start_line?, end_line?)`：读取文件的全部或指定行。
- `exec(command, cwd?)`：在指定目录或当前目录执行命令。

当前 Worktrace 和邮件中心都不需要 AI 网关直接写入文件，因此不提供
`write_file` 或 `edit_file`。当第一个明确的写文件业务需求确定后，再以
`edit_file(path, old_text, new_text)` 为起点扩展契约；`old_text` 必须恰好命中一次，
否则工具失败。

不提供 `list_dir`、`search`、MCP、RAG、Memory、多 Agent 或 `worktrace.git_status` 这类业务专用工具。Worktrace 可以在提示词中要求模型执行 `git status`、`git diff` 和 `git log`；邮件中心可以直接把邮件内容拼接到 `message` 中。

工具没有命令白名单或应用权限矩阵。aIdea 是受控的本机应用平台，子应用和提示词由同一团队维护；实现只负责设置单命令超时、整个 Agent 超时、工具输出上限和最大 Agent 轮次，避免任务无限运行或产生无界输出。首期固定为：整个任务 120 秒、单次 `exec` 30 秒、最多 12 轮、单次工具输出最多 100 KiB；这些值不是子应用接口的一部分。

Agent 结束后，模型的最终文本直接写入响应的 `data`。网关不向子应用暴露工具调用过程。

## 内部后端

AI 网关页面负责选择和保存当前 AI 配置。当前规划的内部后端包括：

- OpenAI 兼容服务：首期使用 Rig；由网关内部选择 Responses 或 Chat Completions 等上游协议。
- Codex app-server：后续作为可选增强后端，由网关内部通过稳定的 stdio JSONL 协议完成适配；不使用实验性的 WebSocket 协议，也不把其 Agent 循环混入 Rig。

两种后端对外都使用同一个 `/api` 接口。子应用不得直接访问上游服务或 Codex app-server。

## Rig 实现与升级

首期 Agent 使用 Rust 的 `rig-core` 和 `rig-agent`，不引入 Python、Node sidecar、Pi、Goose 或自建 Agent 框架：

```toml
rig-core = { version = "=0.41.0", default-features = false, features = ["rustls"] }
rig-agent = { version = "=0.41.0", default-features = false }
```

`rig-agent` 负责模型调用、工具调用和工具结果回传的循环；AI 网关只实现上文的通用工具、配置读取、超时、输出限制、错误转换和 `/api` 服务。壳内 HTTP 客户端统一使用与 Rig 兼容的 `reqwest 0.13`，避免同时维护两个不兼容的客户端版本。

Rig 允许较快的破坏性迭代，因此版本必须精确锁定。升级 Rig 时只改 aIdea：阅读 release notes、升级锁定版本、适配网关内部代码、完整回归四个工具和超时错误路径，然后检查本文是否仍准确。只要 `/api` 请求和响应契约不变，官方应用不需要改代码或重新发布。

## 运行环境

aIdea 启动官方应用时注入：

| 变量 | 用途 |
| --- | --- |
| `AIDEA_AI_GATEWAY_URL` | AI 网关基础地址。 |
| `AIDEA_AI_GATEWAY_TOKEN` | AI 网关保存的访问令牌，用于确认请求来自受管子应用。 |

AI 网关首次生成令牌后保存到自己的 `app-data/ai-gateway/app.db`，后续启动复用。这样 aIdea 异常恢复仍在运行的官方应用时，应用保留的环境变量不会失效。API Key 不注入子应用环境，也不得写入子应用日志。网关访问令牌不是上游 API Key。

## 当前范围

- 子应用只使用同步 JSON `/api` 接口。
- 当前不定义 SSE 响应格式；以后确有流式需求时另行增加协议。
- `/v1/responses` 和 `/v1/chat/completions` 只属于网关内部上游适配，不属于子应用契约。
- AI 网关的页面布局、配置交互和模型测试页面另行设计，不在本文定义。
