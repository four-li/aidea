# App Bridge 与应用搜索边界设计

> **历史设计记录**：本文件只记录 App Bridge v1 和搜索边界的设计过程，不是当前通信契约。当前规则以 [aidea-app-bridge.md](../../guide/aidea-app-bridge.md) 和 [aidea-search.md](../../guide/aidea-search.md) 为准；搜索不属于 App Bridge，历史 `find`、搜索 SDK、全局搜索和官方应用 `/settings` 契约均不得重新实现。

## 目标

建立 aIdea 壳与官方应用之间统一、可扩展的 `postMessage` 通信契约，首期实现主题同步和 macOS 原生通知；同时移除搜索与壳之间的通信，避免为了页面查找引入不必要的平台基础设施。

## 结论

- 官方应用与 aIdea 壳之间使用 App Bridge（`postMessage`）。
- 内置应用继续使用现有 Tauri IPC；不强行改成 `postMessage`。
- 两类应用可以统一能力语义、参数和错误含义，但底层传输按运行边界选择。
- 搜索属于应用自己的页面能力，不属于 App Bridge。
- 壳不拦截全局 `Cmd+F`，不遍历应用 DOM，不保存搜索状态。
- 内置应用和官方应用需要搜索时，各自在页面内实现。
- 搜索规范写入 `docs/guide/aidea-search.md`，作为行为规范，不提供运行时 SDK。
- App Bridge 不提供 SDK；官方应用按契约自行实现通信代码。

## 适用边界

### 官方应用

官方应用是独立进程，通过跨源 iframe 嵌入 aIdea。它使用 App Bridge 请求壳提供的平台能力，并接收壳下发的运行时信号。

官方应用不得依赖 Tauri IPC、`@tauri-apps/api`、`window.__TAURI__`、壳前端 IPC 封装或 Rust 命令名。

### 内置应用

内置应用运行在 aIdea 壳的前端中，继续通过 `shell-frontend/src/lib/ipc.ts` 使用 Tauri IPC。内置应用不接入官方应用 App Bridge。

内置应用和官方应用都遵守 `aidea-search.md`，但搜索实现完全由页面自己负责。

## 官方应用基础契约

### Manifest

官方应用使用以下字段：

```yaml
process:
  command: [node, server.js, --host, 127.0.0.1, --port, '43120']
  working_directory: .
  ready_url: http://127.0.0.1:43120/health
```

- `process.command` 是启动命令数组。
- `process.working_directory` 必须位于应用安装目录内。
- `process.ready_url` 是健康检查地址。
- 主页面固定使用同一服务的根路径 `/`；aIdea 从 `process.ready_url` 的 origin 派生主页面地址，不再要求应用定义额外的 `ui.url`。
- 页面地址和健康检查地址可以共用端口，但不能混为同一个字段。
- 应用服务监听 `127.0.0.1:43000-43999`，禁止监听 `0.0.0.0`。

### `/health`

所有官方应用必须提供 `GET /health`：

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok"}
```

健康检查只判断应用服务是否已经可以接收请求，应快速返回。邮件服务器、第三方 API 等外部依赖不属于壳的进程健康状态。健康检查失败时，aIdea 不展示 iframe。

### `/settings`

所有官方应用必须提供 `GET /settings`。没有业务配置时也提供空设置页。

aIdea 只负责打开该页面，不解析应用表单字段。业务配置由应用自己校验并保存到自己的数据库。`/settings` 与主页面一样接收首屏主题参数，但不参与 App Bridge 握手；App Bridge v1 只服务主页面。

## Bridge v1

### 传输

- 应用向壳发送：`window.parent.postMessage(message, shellOrigin)`。
- 壳向应用发送：对应 iframe 的 `contentWindow.postMessage(message, appOrigin)`。
- `targetOrigin` 必须是明确的 origin，禁止使用 `'*'`。

### 消息信封

```ts
interface AppBridgeMessage {
  protocol: 'aidea-app-bridge';
  version: 1;
  source: 'aidea-shell' | 'aidea-app';
  appId: string;
  id: string;
  type: string;
  payload: unknown;
  inReplyTo?: string;
}
```

- 所有消息都使用统一信封。
- 发送方为每条消息生成唯一 `id`。
- 回执使用 `inReplyTo` 关联原请求。
- 协议版本使用整数。v1 内只做向后兼容的新增字段或新增能力；破坏性变化升级到 v2。
- 不做语义化版本协商。

### 消息类型

首期实现：

| 类型 | 方向 | 说明 | 回执 |
| --- | --- | --- | --- |
| `ready` | 应用 -> 壳 | 建立或恢复连接 | 壳发送当前 `theme` |
| `theme` | 壳 -> 应用 | 同步 `light` / `dark` | 无 |
| `notify` | 应用 -> 壳 | 请求 macOS 原生通知 | `notify:result` |
| `navigate` | 壳 -> 应用 | 通知点击后传递应用内路径 | `navigate:result` |

`ready` 和 `theme` 是基础能力。`navigate` 是应用可选的壳命令。`notify` 是应用向壳发起的请求。

### 能力声明

应用在 `ready` 中声明自己支持的可选壳命令：

```json
{
  "type": "ready",
  "payload": {
    "appId": "mail-center",
    "supported": ["navigate"]
  }
}
```

- `theme` 是基础能力，不需要声明。
- `navigate` 必须显式声明。
- `notify` 是应用 -> 壳请求，不放入应用的 `supported`。
- `supported` 缺省时只表示支持基础能力，不表示支持未来全部能力。
- 壳发送可选命令前检查 `supported`；未声明时不发送。
- 应用请求壳能力时直接发起请求，由回执判断壳是否支持。

### 请求与回执

请求统一使用 `id`，回执使用 `inReplyTo`：

```json
{
  "protocol": "aidea-app-bridge",
  "version": 1,
  "source": "aidea-app",
  "appId": "mail-center",
  "id": "request-1",
  "type": "notify",
  "payload": {
    "title": "新邮件",
    "body": "收到一封新邮件"
  }
}
```

成功回执：

```json
{
  "type": "notify:result",
  "inReplyTo": "request-1",
  "payload": { "ok": true }
}
```

失败回执：

```json
{
  "type": "notify:result",
  "inReplyTo": "request-1",
  "payload": {
    "ok": false,
    "error": {
      "code": "permission_denied",
      "message": "用户未授予通知权限"
    }
  }
}
```

请求方负责超时。Bridge 不自动重试，也不做全局消息去重。`ready` 和 `theme` 可以重复发送；`notify` 等有副作用的请求只发送一次。

### 非法消息

- 信封格式非法：直接丢弃，不回复。
- 协议版本不支持：不处理，并返回协议版本错误。
- 合法但能力未实现：返回 `unsupported`。
- 未知事件：忽略。

### 来源校验

壳收到应用消息时同时校验：

```text
event.origin == 壳登记的主页面 origin（由 `process.ready_url` 的 origin 派生）
event.source == 对应 iframe.contentWindow
message.appId == 登记的 appId
```

应用收到壳消息时同时校验：

```text
event.origin == 允许的壳 origin
event.source == window.parent
message.appId == 自己的 appId
```

这套校验用于防止跨源串线、错误 iframe 和应用 ID 冒用，不承担防本机恶意进程的安全职责。官方应用是当前产品范围内的可信应用。

### 生命周期

1. 应用主页面加载后发送 `ready`。
2. 壳验证消息并登记连接。
3. 壳发送当前 `theme`。
4. 应用整页刷新后重新发送 `ready`。
5. iframe 销毁时，壳删除对应连接。
6. 应用进程重启后，通过 `/health` 和新的 `ready` 恢复连接。
7. 不实现心跳；应用存活由现有进程健康检查负责。
8. 未完成请求超时后返回失败，不永久挂起。

`/settings` 不建立第二条 Bridge 连接，只在打开时读取 `aidea_theme`。这样每个官方应用只有一个需要登记、校验和清理的主页面连接，设置页仍保持应用自有的普通 HTTP 页面。

## 主题

主题采用双阶段机制：

1. iframe 首次加载时给主页面地址追加 `?aidea_theme=light|dark`，用于首屏主题。
2. 应用主页面发送 `ready` 后，壳发送当前 `theme`。
3. aIdea 运行中切换主题时，只发送 `theme`，不重载 iframe。
4. 应用刷新后重新握手，壳再次发送当前主题。

`/settings` 只使用首屏 URL 参数，不接收运行期 `theme` 消息。

查询参数只负责首屏启动，Bridge 是运行时主题同步的权威来源。

## 原生通知

### 请求格式

```json
{
  "type": "notify",
  "payload": {
    "title": "新邮件",
    "body": "收到一封新邮件",
    "action": {
      "type": "navigate",
      "path": "/messages/123"
    }
  }
}
```

- `title` 和 `body` 必须是非空字符串。
- v1 不提供 `tag`，每次请求都是独立通知。
- `action` 可选。
- 带 `action` 时，应用必须声明 `navigate`。
- `path` 只能是应用内部路径，例如 `/messages/123`。
- 禁止外部 URL、文件 URL 和脚本地址。
- 通知正文和路径不得写入普通日志。

### 权限

第一次真正调用 `notify` 时，aIdea 按需申请 macOS 通知权限：

- 用户允许：发送通知并返回成功。
- 用户拒绝：返回 `permission_denied`。
- 平台能力未启用：返回 `unsupported`。
- 参数不合法：返回 `invalid_payload`。

官方应用不直接调用 Tauri 或 macOS 通知 API。

### 点击行为

- 没有 `action`：显示 aIdea 并切换到来源应用。
- 有 `action`：aIdea 确保来源应用运行，等待 `/health` 和 `ready`，再发送 `navigate`。
- 应用收到 `navigate` 后自行完成路由和业务数据加载。
- aIdea 不解析应用业务路由、不直接修改 iframe URL、不执行外部跳转。
- 应用未声明 `navigate` 时，带路径的通知请求直接失败，不创建通知。

## 搜索边界

搜索不是 App Bridge 能力：

- 壳不拦截全局 `Cmd+F`。
- 壳不遍历官方 iframe 或内置应用 DOM。
- 应用自己负责快捷键、搜索框、匹配、高亮、计数、翻页和关闭。
- 搜索只保证当前页面已渲染内容，不承诺搜索数据库或虚拟列表中未渲染的数据。
- 统一行为规范放在 `docs/guide/aidea-search.md`，不提供搜索 SDK。

## 落地范围

文档更新：

- 重写本文件，删除原有 `find`、搜索 SDK、搜索 session、搜索 Tier 和临时 demo 说明。
- 新增 `docs/guide/aidea-search.md`。
- 更新 `aidea-platform.md`、`aidea-official-app.md`、`aidea-builtin-app.md` 和根目录 `AGENTS.md` 的路由与边界说明。
- 更新外部 `aidea-app` Skill，要求官方应用提供 `/health`、`/settings`，引用 Manifest、Bridge 和搜索规范，不再要求复制 SDK。

代码更新：

- 删除壳侧 `GlobalSearch` 和全局 `Cmd+F` 拦截。
- 删除搜索相关测试、状态和通信处理。
- 壳侧保留并重写官方 iframe Bridge，实现 `ready`、`theme`、`notify`、`navigate`。
- 删除应用侧 SDK；官方应用范本改为手写通信示例。
- 接入 macOS 原生通知插件、Rust 注册和必要权限。
- 保留内置应用现有 IPC。

## 验证

前端和壳侧测试至少覆盖：

- 合法来源、错误来源和错误 iframe；
- 错误 `appId`；
- 协议版本不兼容；
- `ready` 后主题下发；
- 主题切换不重载 iframe；
- 应用刷新后重新握手；
- `notify` 参数校验；
- 通知权限允许和拒绝；
- 通知点击启动应用并发送 `navigate`；
- 非法外部路径被拒绝；
- `navigate` 未声明时拒绝；
- 请求超时和错误回执；
- 官方应用 `/health` 和 `/settings`；
- 浅色、深色主题。

由于 `postMessage` 的跨源行为不能只靠 jsdom 证明，至少保留一个真实浏览器端到端测试，覆盖“官方应用 iframe -> 壳 -> iframe”的完整链路。
