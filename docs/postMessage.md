# aIdea `postMessage` 使用清单

本文是当前 aIdea 壳与官方应用之间 `postMessage` 使用位置的索引，方便梳理调用链。通信协议的唯一权威仍是 [App Bridge](guide/aidea-app-bridge.md)；本文件不新增或修改协议。

## 已实现的调用链

| 消息 | 方向 | 壳端位置 | 应用端位置 | 用途 |
| --- | --- | --- | --- | --- |
| `ready` | 官方应用 -> 壳 | `shell-frontend/src/hooks/useAppBridge.ts` | 官方应用自己的 Bridge 初始化代码 | 应用完成加载并声明可选能力。 |
| `theme` | 壳 -> 官方应用 | `shell-frontend/src/hooks/useAppBridge.ts` | 官方应用自己的 Bridge 消息监听 | `ready` 后同步当前主题，以及运行期主题切换。 |
| `notify` | 官方应用 -> 壳 | `shell-frontend/src/hooks/useAppBridge.ts` | 官方应用自己的业务通知调用处 | 请求 macOS 原生通知。 |
| `notify:result` | 壳 -> 官方应用 | `shell-frontend/src/hooks/useAppBridge.ts` | 官方应用自己的通知请求回执处理 | 返回通知成功或失败。 |
| `navigate` | 壳 -> 官方应用 | `shell-frontend/src/hooks/useAppBridge.ts` | 官方应用自己的 Bridge 消息监听 | 用户点击带 action 的通知后，交给来源应用完成内部跳转。 |
| `protocol:error` | 壳 -> 官方应用 | `shell-frontend/src/hooks/useAppBridge.ts` | 官方应用自己的 Bridge 消息监听 | 返回不支持的协议版本。 |
| `directory:drop` | 壳 -> Worktrace | `shell-native/src/lib.rs`、`shell-frontend/src/App.tsx`、`shell-frontend/src/hooks/useAppBridge.ts` | `/Users/fourli/Desktop/app/aidea-plugins/worktrace/web/src/lib/aideaBridge.ts` | 传递 Finder 拖入的单个目录绝对路径。 |

### 壳端

- `shell-frontend/src/hooks/useAppBridge.ts`
  - `registerFrame()` 保存官方应用 iframe、主页面 origin 和连接状态。
  - `window.addEventListener('message', ...)` 接收官方应用消息，校验 `event.origin`、`event.source` 与 `appId` 后处理 `ready`、`notify`。
  - 私有 `send()` 使用 `iframe.contentWindow.postMessage(message, connection.origin)` 向指定 iframe 发送消息。
  - 原生通知 action 由 `listenNativeNotificationActions()` 接收，待来源应用重新 `ready` 后发送 `navigate`。
- `shell-frontend/src/App.tsx`
  - 调用 `useAppBridge()`，并在收到通知跳转请求时选中并按需启动来源应用。
  - 接收原生 `aidea:directory-dropped` 事件；只有当前激活应用是 Worktrace 时，才转交给 Bridge。
- `shell-frontend/src/components/WebviewFrame.tsx`
  - 通过 iframe ref 调用 `registerFrame()`，让壳能校验消息来源并定向发送。
- `shell-frontend/tests/useAppBridge.test.tsx`
  - 覆盖壳端消息来源校验、`ready` 握手、主题同步、通知与跳转行为。

### 官方应用示例与已接入应用

- `samples/official-app-reference/src/main.ts`：官方应用最小 Bridge 示例，包含 `ready`、`theme`、`notify`、`navigate` 的发送或接收。
- `samples/official-app-reference/README.md`：示例使用说明。
- `/Users/fourli/Desktop/app/aidea-plugins/worktrace/web/src/lib/aideaBridge.ts`：Worktrace 的接入实现；发送 `ready` 并声明 `directory-drop`，接收 `theme` 与 `directory:drop`。
- `/Users/fourli/Desktop/app/aidea-plugins/worktrace/web/src/main.tsx`：在应用根组件初始化一次 Worktrace Bridge，将目录路径传给应用界面。
- `/Users/fourli/Desktop/app/aidea-plugins/worktrace/web/src/App.tsx`：仅在添加项目弹窗已打开时，复用既有目录 Git 校验；嵌入 aIdea 时忽略浏览器原生 drop，避免重复校验或错误提示。

## 共用安全约束

所有消息使用 `aidea-app-bridge` v1 信封。壳只向登记的 iframe 使用该应用 HTTP origin 发送；官方应用只向从 `document.referrer` 解析且处于白名单的壳 origin 发送。两边都不得使用 `'*'` 作为 `targetOrigin`。

壳接收应用消息时，必须同时校验：

```text
event.origin == 登记的应用 origin
event.source == 登记 iframe.contentWindow
message.appId == 登记的应用 ID
```

应用接收壳消息时，必须同时校验：

```text
event.origin == 允许的壳 origin
event.source == window.parent
message.appId == 自己的应用 ID
```

详细消息信封、payload 和生命周期见 [App Bridge](guide/aidea-app-bridge.md)。

## 已实现：本地目录拖入 Worktrace

Finder 拖入到添加项目弹窗时的调用链：

```text
Finder 拖入目录
  -> aIdea 原生窗口获得绝对路径
  -> 壳前端仅在当前激活应用为 worktrace 时接收内部事件
  -> App Bridge 定向发送 directory:drop
  -> Worktrace 复用既有目录校验接口检查 Git 工作树
```

消息：

```json
{
  "type": "directory:drop",
  "payload": { "path": "/absolute/path/to/project" }
}
```

实现边界：

- Worktrace 在 `ready.payload.supported` 声明 `directory-drop` 能力；壳仅向已连接且声明该能力的 Worktrace iframe 发送。
- 壳仅接受一个存在的绝对目录，不验证 Git；Git 工作树验证、错误提示和项目保存仍由 Worktrace 后端负责。
- 目录绝对路径只在原生窗口、壳前端和目标 Worktrace iframe 间传递，不写入壳日志，不广播给其他应用。
- Worktrace 嵌入壳时，浏览器 `drop` 事件读不到路径不应单独报错，等待上述 Bridge 消息；独立浏览器运行时仍保留现有降级提示。

自动化测试已覆盖路径筛选、壳端能力门控、当前激活应用门控和 Worktrace Git 校验调用。真实 Finder 拖放需要在包含本次原生壳改动的 aIdea 桌面进程中人工验收。
