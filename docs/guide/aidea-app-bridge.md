# aIdea 壳与官方应用通信契约（App Bridge）

本文档定义 aIdea 壳与官方应用之间的运行时双向通信。官方应用由独立进程提供 HTTP 页面，再通过跨源 iframe 嵌入 aIdea；通信使用浏览器标准的 `postMessage`，不依赖 Tauri IPC。

内置应用不使用本契约，继续通过 `shell-frontend/src/lib/ipc.ts` 调用自己的 Tauri IPC。搜索也不属于本契约，统一行为见 [应用内搜索规范](aidea-search.md)。

## 目标与边界

App Bridge v1 只解决平台级的四件事：

- `ready`：官方应用告诉壳页面已经加载并声明可选能力。
- `theme`：壳把当前浅色/深色主题同步给应用。
- `notify`：应用请求 aIdea 发送 macOS 原生通知。
- `navigate`：通知点击后，壳把应用内部路径交给来源应用。

本契约不提供搜索、数据共享、凭据共享、业务路由解析、全局快捷键或 SDK。官方应用按本文档手写所需的少量通信代码。

## 官方应用基础要求

官方应用的 `aidea.yaml` 至少包含主页面、启动命令和健康检查地址：

```yaml
process:
  command: [node, server.js, --host, 127.0.0.1, --port, '43120']
  working_directory: .
  ready_url: http://127.0.0.1:43120/health
```

- `process.command` 是程序和参数数组，不使用 `sh -c` 或 `bash -c`。
- `process.working_directory` 必须位于应用安装目录内。
- `process.ready_url` 必须是快速的 `GET /health` JSON 检查地址。
- 主页面固定使用同一服务的根路径 `/`；aIdea 从 `process.ready_url` 的 origin 派生主页面地址，不再要求应用定义额外的 `ui.url`。
- 官方应用服务只监听 `127.0.0.1`，端口从 `43000-43999` 中稳定分配。
- 所有官方应用都提供 `GET /settings`，即使暂时没有业务设置也要返回一个可访问的空设置页。
- App Bridge v1 只服务应用主页面。`/settings` 由 aIdea 设置页直接打开，只读取 `aidea_theme` 做首屏主题，不发送 `ready`，也不接收运行期 Bridge 消息。

`/health` 只表示应用服务可以接收请求，不检查邮件服务器或其他外部依赖：

```http
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"ok"}
```

aIdea 的设置入口固定打开同一应用的 `/settings`，不解析页面字段，也不保存业务配置。业务配置由应用自己校验并写入自己的 `app-data/<app-id>/app.db`。

## 传输

应用向壳发送：

```ts
window.parent.postMessage(message, shellOrigin);
```

壳向应用发送：

```ts
iframe.contentWindow?.postMessage(message, appOrigin);
```

两边都必须使用明确的 `targetOrigin`，禁止使用 `'*'`。应用直接在浏览器打开时应继续正常工作，但不启用 Bridge。

应用不能通过读取 `window.parent.origin` 获取壳来源：跨源 iframe 不允许可靠读取父窗口的 origin，实际 WebView 中可能抛出跨源访问错误。应用必须从 `document.referrer` 解析父页面 origin，只接受下面两个精确值：

```ts
const shellOrigins = new Set(['tauri://localhost', 'http://localhost:5173']);
const shellOrigin = (() => {
  if (window.parent === window) return null;
  try {
    const origin = new URL(document.referrer).origin;
    return shellOrigins.has(origin) ? origin : null;
  } catch {
    return null;
  }
})();
```

`document.referrer` 为空、解析失败或不在白名单时，应用必须安全地作为独立页面运行，不发送 `ready`，也不处理壳消息。禁止使用 `window.parent.origin`、`'*'`、前缀匹配或从未校验的 URL 推导 `targetOrigin`。在当前 macOS Tauri WebView 中，嵌入页面可以取得 `tauri://localhost`。

## 消息信封

所有消息使用统一信封：

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

- 每条消息都生成唯一 `id`。
- 回执使用 `inReplyTo` 关联原请求。
- `version` 是整数。破坏性变化升级到 v2，v1 不做语义化版本协商。
- Bridge 不自动重试，不做全局去重。请求方需要自己设置超时；有副作用的请求只发送一次。
- 信封格式非法时直接丢弃。版本不支持时返回 `protocol:error`；未知但格式合法的事件忽略。

版本错误回执的 payload：

```json
{
  "code": "unsupported_version",
  "message": "不支持的 App Bridge 版本"
}
```

## 来源校验

壳收到应用消息时必须同时满足：

```text
event.origin == 壳登记的主页面 origin（由 `process.ready_url` 的 origin 派生）
event.source == 对应 iframe.contentWindow
message.appId == 该 iframe 登记的 appId
```

应用收到壳消息时必须同时满足：

```text
event.origin == 允许的壳 origin
event.source == window.parent
message.appId == 自己的 appId
```

应用允许的壳 origin 必须由上面的 `document.referrer` 白名单确定：生产壳 origin 是 `tauri://localhost`，开发壳 origin 是 `http://localhost:5173`。这些校验用于防止跨源串线、错误 iframe 和应用 ID 冒用；当前官方应用是 aIdea 自己维护的可信应用，不额外防范本机恶意进程。

## 握手和能力声明

应用主页面加载后发送 `ready`；整页刷新或应用进程重启后重新发送：

```json
{
  "protocol": "aidea-app-bridge",
  "version": 1,
  "source": "aidea-app",
  "appId": "mail-center",
  "id": "ready-1",
  "type": "ready",
  "payload": {
    "appId": "mail-center",
    "supported": ["navigate"]
  }
}
```

`supported` 只列出应用支持的可选壳到应用命令。v1 中 `navigate` 是唯一可选命令；`theme` 是基础能力，不需要声明；`notify` 是应用到壳的请求，也不放入 `supported`。省略 `supported` 只表示支持基础能力，不表示支持未来能力。

壳验证 `ready` 后登记连接和能力，并立即发送当前 `theme`。应用未 `ready` 前，壳不发送 `navigate`。壳不实现心跳；进程是否存活由 `/health` 检查负责。

## 消息目录

| 类型 | 方向 | payload | 回执 |
| --- | --- | --- | --- |
| `ready` | 应用 -> 壳 | `{ appId, supported? }` | 壳发送 `theme` |
| `theme` | 壳 -> 应用 | `{ mode: 'light' | 'dark' }` | 无 |
| `notify` | 应用 -> 壳 | `{ title, body, action? }` | `notify:result` |
| `navigate` | 壳 -> 应用 | `{ path }` | `navigate:result` |

### notify 请求

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
- `action` 可省略；有 action 时应用必须在 `ready` 中声明 `navigate`。
- `path` 只能是来源应用的内部路径，例如 `/messages/123`。
- 禁止外部 URL、文件 URL、脚本地址、`//other-host` 和反斜杠路径。
- 通知正文和路径不得写入普通日志。

成功回执的 payload 是 `{ "ok": true }`。失败回执的 payload 是：

```json
{
  "ok": false,
  "error": {
    "code": "permission_denied",
    "message": "用户未授予通知权限"
  }
}
```

第一次真正调用 `notify` 时，aIdea 按需申请 macOS 通知权限。用户拒绝返回 `permission_denied`；平台能力未启用返回 `unsupported`；参数不合法返回 `invalid_payload`。

### navigate 命令

通知点击后，如果 action 存在，aIdea 先显示并启动来源应用，等待应用健康检查通过和新的 `ready` 握手，然后发送：

```json
{
  "type": "navigate",
  "payload": { "path": "/messages/123" }
}
```

应用收到后自行完成路由和业务数据加载，再返回 `navigate:result`。aIdea 不解析应用路由、不直接修改 iframe URL、不执行外部跳转。

没有 action 的通知只需要显示 aIdea 并切换到来源应用。

## 主题同步

主题分两个阶段：

1. iframe 第一次加载时，aIdea 给主页面地址追加 `?aidea_theme=light|dark`，用于首屏渲染。
2. 应用主页面发送 `ready` 后，壳发送当前 `theme`；运行中切换主题时只发送新的 `theme`，不重载主页面 iframe。

查询参数只负责首屏启动，Bridge 是运行时主题的权威来源。应用刷新后重新握手，壳再次发送当前主题。

## 生命周期和错误处理

1. 应用主页面加载后发送 `ready`。
2. 壳校验来源和 appId，登记 iframe 连接。
3. 壳发送当前 `theme`。
4. 应用刷新或进程重启后重新发送 `ready`。
5. iframe 销毁时，壳删除连接；旧 iframe 发来的消息不再处理。
6. 未完成请求由请求方超时并返回失败，不永久挂起。

`/settings` 不参与上述握手和生命周期。它只需要能被 aIdea 打开，并根据 URL 中的 `aidea_theme` 完成首屏渲染；设置表单、保存和校验全部由应用自己负责。

搜索、页面快捷键、业务消息和业务数据都由应用自己管理，不能借 App Bridge 偷渡成壳侧能力。
