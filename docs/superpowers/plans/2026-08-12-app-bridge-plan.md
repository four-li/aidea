# aIdea App Bridge v1 与应用内搜索边界实施计划

> **历史实施记录**：本文件只记录 App Bridge v1 和搜索边界的实施过程，不是当前通信契约。当前规则以 [aidea-app-bridge.md](../../guide/aidea-app-bridge.md) 和 [aidea-search.md](../../guide/aidea-search.md) 为准；搜索不属于 App Bridge，历史 `find`、搜索 SDK、全局搜索和官方应用 `/settings` 契约均不得重新实现。

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` 在当前会话按任务执行；每完成一个任务先运行该任务的最小验证，再继续下一任务。

**目标：** 建立官方应用与 aIdea 壳之间最小可用的 `postMessage App Bridge`，并彻底移除壳侧全局搜索及搜索通信。

**架构：** 官方应用通过跨源 iframe 使用 `postMessage`，首期只实现 `ready`、`theme`、`notify`、`navigate`。内置应用继续通过现有 `shell-frontend/src/lib/ipc.ts` 使用 Tauri IPC。搜索完全属于应用页面自身能力，只保留一份行为规范，不提供 SDK 或壳侧搜索状态。

**技术栈：** React 18、TypeScript strict、Vite、Vitest、Tauri 2、Rust、`tauri-plugin-notification`、macOS 原生通知。

## 全局约束

- 官方应用不得依赖 `@tauri-apps/api`、`window.__TAURI__`、壳前端 IPC 封装或 Rust 命令名。
- 内置应用继续使用 `shell-frontend/src/lib/ipc.ts`；不把内置应用改成 `postMessage`。
- Bridge v1 只有 `ready`、`theme`、`notify`、`navigate`；不得恢复 `find`、`find:next`、`find:prev`、`find:clear` 或任何搜索 SDK。
- 所有消息使用 `protocol: 'aidea-app-bridge'`、整数 `version: 1`、唯一 `id`、可选 `inReplyTo` 和明确 `payload`。
- `postMessage` 的 `targetOrigin` 必须是明确 origin，壳同时校验 `event.origin`、`event.source` 和 `appId`。
- 不做自动重试和全局去重；请求方负责超时；`ready` 可重复发送以恢复连接。
- 官方应用必须提供 `GET /health` 和 `GET /settings`，服务只监听 `127.0.0.1:43000-43999`。
- 主页面和 `/settings` 首次加载带 `aidea_theme=light|dark`；只有主页面发送 `ready` 后才通过 Bridge 接收运行期 `theme`，不得重载主页面 iframe；`/settings` 不参与 Bridge。
- 通知标题和正文必须非空；v1 不提供 `tag`；通知点击路径只能是来源应用内部路径。
- 不自动 `git add`、commit、push 或创建 PR；计划中的“提交”步骤统一改为本地验证和人工检查。
- 修改代码后按根目录约定运行受影响的前端和 Rust 测试，最终至少运行 `git diff --check`。

## 文件职责地图

- 修改 `docs/guide/aidea-app-bridge.md`：正式的 Bridge v1 契约，删除旧搜索、SDK、Tier 和临时验证说明。
- 新建 `docs/guide/aidea-search.md`：内置应用和官方应用统一遵循的页面搜索行为规范。
- 修改 `docs/guide/aidea-platform.md`、`docs/guide/aidea-official-app.md`、`docs/guide/aidea-builtin-app.md`、`AGENTS.md`：同步应用边界、`/health`、`/settings`、主题和文档路由。
- 修改 `/Users/fourli/atlas/user-agents/skills/aidea-app/SKILL.md`：让外部官方应用 Skill 强制引用上述契约，删除“复制 SDK”和壳侧搜索要求。
- 删除 `shell-frontend/src/components/GlobalSearch.tsx`、`shell-frontend/tests/components/GlobalSearch.test.tsx`：移除全局 `Cmd+F` 搜索。
- 修改 `shell-frontend/src/App.tsx`、`shell-frontend/src/components/ContentArea.tsx`、`shell-frontend/src/components/WebviewFrame.tsx`：移除搜索状态，保留主题 query、iframe 注册和通知导航入口。
- 修改 `shell-frontend/src/hooks/useAppBridge.ts`、`shell-frontend/tests/useAppBridge.test.tsx`：实现壳侧 Bridge 路由和生命周期。
- 删除 `shell-frontend/src/lib/app-bridge-sdk.ts`、`shell-frontend/tests/app-bridge-sdk.test.ts`：官方应用不再由壳仓库提供 SDK。
- 修改 `shell-frontend/package.json`、`shell-frontend/package-lock.json`、`shell-native/Cargo.toml`、`shell-native/Cargo.lock`、`shell-native/src/lib.rs`、`shell-native/capabilities/default.json`：接入 macOS 原生通知插件。
- 修改 `samples/official-app-reference/*`：改成手写 Bridge 范本，并补齐 `/health`、`/settings` 和运行期主题示例。

---

### 任务 1：同步正式文档和官方应用 Skill

**文件：**
- 修改：`docs/guide/aidea-app-bridge.md`
- 新建：`docs/guide/aidea-search.md`
- 修改：`docs/guide/aidea-platform.md`
- 修改：`docs/guide/aidea-official-app.md`
- 修改：`docs/guide/aidea-builtin-app.md`
- 修改：`AGENTS.md`
- 修改：`/Users/fourli/atlas/user-agents/skills/aidea-app/SKILL.md`

**接口约定：**
- Bridge 信封固定为 `{ protocol, version, source, appId, id, type, payload, inReplyTo? }`。
- `ready.payload` 为 `{ appId, supported?: string[] }`。
- `theme.payload` 为 `{ mode: 'light' | 'dark' }`。
- `notify.payload` 为 `{ title, body, action?: { type: 'navigate', path: string } }`。
- `notify:result.payload` 为 `{ ok: true }` 或 `{ ok: false, error: { code, message } }`。
- `navigate.payload` 为 `{ path: string }`，回执为 `navigate:result`。

- [ ] **步骤 1：重写 Bridge 正式契约。**
  删除旧文档中的 `find` 消息、搜索会话、高亮算法、搜索 SDK、Tier 说明和临时 demo；补齐消息信封、来源校验、能力声明、超时、非法消息、主题双阶段同步、通知权限和通知点击生命周期。
- [ ] **步骤 2：新增搜索规范。**
  明确搜索由应用自身负责：只搜索当前页面已渲染内容；应用自行负责快捷键、输入框、匹配、高亮、计数、翻页和关闭；壳不拦截全局 `Cmd+F`，不遍历 iframe，不保存搜索状态；不提供统一运行时库。
- [ ] **步骤 3：同步平台和应用边界。**
  在平台文档中明确官方应用必须提供 `/health` 和 `/settings`，`ready_url` 指向 `/health`，设置入口固定打开 `/settings`；明确内置应用继续用 Tauri IPC，官方应用主页面用 App Bridge；主题 query 负责主页面和设置页首屏，Bridge 只负责主页面运行时同步。
- [ ] **步骤 4：同步路由和外部 Skill。**
  在根 `AGENTS.md` 的文档路由中加入 `aidea-search.md`；在外部 Skill 中删除“复制 SDK”、`find` 和搜索接入清单，改为要求阅读 Bridge/Search 文档、手写最小通信代码、提供 `/health` 和 `/settings`。
- [ ] **步骤 5：文档检查。**
  运行：
  ```bash
  git diff --check
  rg -n "find:|GlobalSearch|复制 SDK|app-bridge-sdk" docs/guide AGENTS.md /Users/fourli/atlas/user-agents/skills/aidea-app/SKILL.md
  ```
  预期：正式契约和 Skill 不再出现搜索通信或 SDK 要求；历史设计文档可以保留，但不能被正式路由引用为当前规范。

### 任务 2：删除壳侧全局搜索和搜索通信

**文件：**
- 删除：`shell-frontend/src/components/GlobalSearch.tsx`
- 删除：`shell-frontend/tests/components/GlobalSearch.test.tsx`
- 删除：`shell-frontend/src/lib/app-bridge-sdk.ts`
- 删除：`shell-frontend/tests/app-bridge-sdk.test.ts`
- 修改：`shell-frontend/src/App.tsx`
- 修改：`shell-frontend/src/builtin-apps/dev-tools/tabs/data-formatter/DataFormatter.tsx`

**接口约定：**
- `App.tsx` 不再导入 `GlobalSearch`、`AppFindResult` 或搜索状态。
- `useAppBridge` 的调用只接收当前主题和通知导航回调，不能暴露 `sendToApp('find', ...)`。

- [ ] **步骤 1：先删除搜索测试和实现。**
  删除全局搜索组件及其测试；删除应用侧 SDK 及其测试，避免旧测试继续把 `find` 当成契约。
- [ ] **步骤 2：清理 App 入口。**
  删除 `officialFindResult` state、`sendToApp` 传递和 `GlobalSearch` JSX；保留 `registerFrame` 给官方 iframe Bridge 使用。
- [ ] **步骤 3：清理搜索误导注释。**
  删除 Data Formatter 中“页面搜索由 aIdea 壳 GlobalSearch 提供”的说明，改成应用页面按 `aidea-search.md` 自行实现的事实描述；不顺便改业务组件。
- [ ] **步骤 4：静态检查。**
  运行：
  ```bash
  rg -n "GlobalSearch|AppFindResult|sendToApp|find:|app-bridge-sdk|Cmd\\+F" shell-frontend/src shell-frontend/tests
  ```
  预期：只剩 Bridge 文档或测试计划中的普通文本，不再有壳侧搜索实现或搜索通信代码。

### 任务 3：实现壳侧 Bridge v1 的握手、主题和来源校验

**文件：**
- 修改：`shell-frontend/src/hooks/useAppBridge.ts`
- 修改：`shell-frontend/tests/useAppBridge.test.tsx`
- 修改：`shell-frontend/src/components/WebviewFrame.tsx`
- 修改：`shell-frontend/src/components/ContentArea.tsx`
- 修改：`shell-frontend/src/App.tsx`

**接口约定：**
```ts
interface AppBridgeController {
  registerFrame: (app: AppManifest, iframe: HTMLIFrameElement | null) => void;
}

interface NotifyNavigateRequest {
  appId: string;
  path?: string;
}

type UseAppBridgeOptions = {
  theme: 'light' | 'dark';
  onNavigateRequest: (request: NotifyNavigateRequest) => void | Promise<void>;
};
```

- [ ] **步骤 1：先重写测试夹具。**
  保留跨源 iframe 的 fake `contentWindow`，增加以下失败用例：错误 origin、错误 `event.source`、错误 appId、非法信封、版本不兼容、握手后下发 theme、主题变化不重载 iframe、iframe 清理后不再收消息。
- [ ] **步骤 2：实现统一信封校验和发送。**
  在 hook 内保留最小的 `isEnvelope`、`nextMessageId`、`getAppOrigin` 和 `send`；所有发送使用 `iframe.contentWindow.postMessage(envelope, connection.origin)`，禁止 `'*'`。
- [ ] **步骤 3：实现 ready 生命周期。**
  收到合法 `ready` 后校验 `payload.appId`，登记 `connected` 和 `supported`；立即发送当前 `theme`。重复 `ready` 允许恢复连接；iframe ref 为 `null` 时删除连接。
- [ ] **步骤 4：实现 theme 同步。**
  主题变化只给已连接 iframe 发送 `theme`，不改变 iframe `src`。保留 `WebviewFrame` 的 `aidea_theme` 首屏参数，并测试 query 参数与运行时消息同时存在。
- [ ] **步骤 5：处理协议和未知消息。**
  非法信封、错误来源和未知事件直接丢弃；版本不是 `1` 时向同一来源返回 `protocol:error`，payload 使用 `{ code: 'unsupported_version', message: '不支持的 App Bridge 版本' }`；不为普通未知事件发送回执。
- [ ] **步骤 6：运行最小测试。**
  ```bash
  cd shell-frontend
  npm test -- --run tests/useAppBridge.test.tsx tests/WebviewFrame.test.tsx
  ```
  预期：所有握手、来源、主题和 iframe 生命周期用例通过。

### 任务 4：实现 notify 请求、回执和应用内 navigate 命令

**文件：**
- 修改：`shell-frontend/src/hooks/useAppBridge.ts`
- 修改：`shell-frontend/tests/useAppBridge.test.tsx`
- 新建或修改：`shell-frontend/src/lib/native-notifications.ts`
- 修改：`shell-frontend/src/App.tsx`

**接口约定：**
- 壳收到应用 `notify` 后只接受非空 `title`、`body`；不接受 `tag`。
- `action.path` 必须是应用内部路径：以单个 `/` 开头，不允许 `//`、协议、文件路径、脚本地址或反斜杠。
- 带 action 时，连接必须已在 `ready.payload.supported` 声明 `navigate`，否则回复 `unsupported`。
- 通知点击后，壳先调用应用激活/启动回调；应用重新 `ready` 后才发送 `navigate`，不直接修改 iframe URL。

- [ ] **步骤 1：先为通知边界写纯验证测试。**
  覆盖合法 payload、空标题、空正文、`tag`、`https://`、`file://`、`javascript:`、`//other-host`、反斜杠路径和未声明 `navigate`。
- [ ] **步骤 2：接入 Tauri 通知依赖。**
  在 `shell-frontend/package.json` 增加 `@tauri-apps/plugin-notification`，在 `shell-native/Cargo.toml` 增加同版本 `tauri-plugin-notification`，通过项目已有包管理器更新两个 lockfile；在 `shell-native/src/lib.rs` 注册 `.plugin(tauri_plugin_notification::init())`，在 `capabilities/default.json` 增加通知默认权限。
- [ ] **步骤 3：实现原生通知适配器。**
  `native-notifications.ts` 负责检查权限、首次真正调用时申请权限、发送通知和监听点击事件；权限拒绝返回 `permission_denied`，插件能力不存在或调用失败返回 `unsupported`/`native_error`。通知映射必须携带来源 `appId` 和可选内部路径，不能把正文或路径写普通日志。
- [ ] **步骤 4：确认点击动作的稳定标识。**
  先以插件类型定义确认通知点击回调能拿到稳定通知 ID；用进程内 `Map<notificationId, { appId; path? }>` 关联 action。若插件 API 不提供稳定 ID 或自定义 userInfo，则在同一任务内增加一个很小的 Rust notification command/event 适配层保存该关联，不修改 Bridge payload，不把路径编码进通知正文。
- [ ] **步骤 5：实现 notify 回执。**
  成功发送后回复 `{ ok: true }`；参数错误、权限拒绝、未声明导航或平台能力错误都回复结构化 `{ ok: false, error: { code, message } }`，并使用原请求 `id` 填 `inReplyTo`。
- [ ] **步骤 6：实现点击后的导航排队。**
  `App.tsx` 提供 `onNavigateRequest`：切换到来源应用，若进程未运行则通过现有 `ipc.startApp` 启动；Bridge 按 `appId` 暂存路径，在该 iframe 重新 `ready` 且声明 `navigate` 后发送 `{ type: 'navigate', payload: { path } }`。`navigate:result` 仅作为应用已接收的回执，不解析应用业务路由。
- [ ] **步骤 7：测试 notify 生命周期。**
  在 `useAppBridge.test.tsx` 覆盖成功/拒绝/不支持、回执 `inReplyTo`、点击无 action 只激活来源应用、点击有 action 等待 ready、非法路径拒绝、未声明 navigate 拒绝和请求超时。

### 任务 5：收紧官方应用 manifest 和 settings 页面契约

**文件：**
- 修改：`shell-native/src/manifest.rs`
- 修改：`shell-native/src/official_market.rs`
- 修改：`shell-native/tests/manifest_test.rs`
- 修改：`shell-frontend/src/components/AppManagementPage.tsx`（仅在测试暴露缺口时修改）
- 修改：`shell-frontend/tests/components/AppManagementPage.test.tsx`

**接口约定：**
- 官方 `process.ready_url` 必须是本机 HTTP `/health` 地址；aIdea 从它的 origin 派生主页面地址，不再增加独立的 `ui.url` 字段。
- 设置入口固定向 `WebviewFrame` 传 `path="/settings"`，由应用自己渲染和保存业务配置。

- [ ] **步骤 1：补 Rust manifest 校验测试。**
  增加合法 `/health`、路径不是 `/health`、非 `127.0.0.1` 和缺失 ready URL 的用例；不要修改内置应用继续使用的 Tauri IPC 结构。
- [ ] **步骤 2：在官方应用定义校验中落实规则。**
  在现有 manifest/market 验证入口拒绝不符合 `/health` 的官方 ready URL，复用已有 URL 解析和端口校验逻辑；不新增独立 validator class 或重复解析器。
- [ ] **步骤 3：确认 settings 入口。**
  测试应用管理设置详情对 webview 使用 `/settings`，并保留主题 query；aIdea 不读取表单字段、不保存业务设置。
- [ ] **步骤 4：运行 Rust/前端定向测试。**
  ```bash
  cd shell-native && cargo test manifest
  cd ../shell-frontend && npm test -- --run tests/components/AppManagementPage.test.tsx
  ```

### 任务 6：重写官方应用接入范本，不再复制 SDK

**文件：**
- 修改：`samples/official-app-reference/README.md`
- 修改：`samples/official-app-reference/aidea.yaml`
- 修改：`samples/official-app-reference/src/main.ts`
- 删除：`samples/official-app-reference/aidea-bridge-sdk.ts`
- 新建：`samples/official-app-reference/src/aidea-bridge.ts`
- 新建或修改：`samples/official-app-reference/vite.config.ts`
- 修改：`samples/official-app-reference/package.json`

**接口约定：**
- 范本手写 `postMessage`，只包含协议常量、信封生成、来源校验、`ready`、`theme`、`notify` 和 `navigate`。
- 范本不得实现搜索，不得依赖 `@tauri-apps/api`，不得把通信封装发布成 SDK。
- Vite dev server 对 `GET /health` 返回 `200 {"status":"ok"}`，`GET /settings` 返回可访问的设置页。

- [ ] **步骤 1：删除范本 SDK 和搜索说明。**
  删除副本文件及 README 中的“复制 SDK”“find 内置处理”内容。
- [ ] **步骤 2：写最小手工 bridge。**
  `src/aidea-bridge.ts` 导出 `createAppBridge({ appId, supported, onTheme, onNavigate })`，内部只做 `postMessage` 信封、`event.origin + event.source + appId` 校验、ready、theme、request/回执和超时；应用自己决定搜索实现。
- [ ] **步骤 3：补运行端点。**
  在 Vite middleware 中加入 `/health` JSON 响应；让 `/settings` 走同一入口并显示空设置页，确保范本符合官方应用契约。
- [ ] **步骤 4：更新入口示例和 manifest。**
  `main.ts` 初始化手工 bridge、声明 `supported: ['navigate']`、处理主题和 navigate；`aidea.yaml` 保持 `process.command` 数组、`ready_url: .../health` 和 `127.0.0.1:43xxx`。
- [ ] **步骤 5：独立运行验证。**
  ```bash
  cd samples/official-app-reference
  npm install
  npm run build
  ```
  预期：浏览器直接打开时不访问壳 API，`/health` 正常返回，页面可独立开发。

### 任务 7：真实跨源浏览器验证与完整闭环

**文件：**
- 新建：`samples/official-app-reference/tests/app-bridge-browser-check.md`（记录可重复的真实浏览器验证步骤和预期）
- 可能修改：`shell-frontend/tests/WebviewFrame.test.tsx`
- 修改：必要时的测试脚本或 `.gitignore`，不得提交临时安装目录和运行日志

- [ ] **步骤 1：启动两个真实 HTTP origin。**
  一个 origin 提供壳测试页/运行中的前端，另一个 origin 启动官方范本；确保 iframe 的 `event.origin` 与壳 origin 不同，且不是把两个页面塞进同一个 jsdom。
- [ ] **步骤 2：验证握手和主题。**
  用真实浏览器打开壳，确认官方 iframe 发送 `ready`，壳回 `theme`；切换浅色/深色时 iframe 不刷新且主题回调变化。
- [ ] **步骤 3：验证通知链路。**
  从 iframe 发 `notify`，确认首次调用触发 macOS 权限请求；允许和拒绝各验证一次；带内部 path 的通知点击后应用被激活/启动，等待 ready 后收到 `navigate`；外部 URL 被拒绝。
- [ ] **步骤 4：验证重载恢复。**
  刷新 iframe，确认重新 `ready` 后收到当前 theme；销毁 iframe 后旧 window 发消息不会再被处理。
- [ ] **步骤 5：记录验证结果。**
  在验证记录中写明浏览器、端口、通过项和未能验证的 macOS 权限状态；不把通知正文、路径或用户数据写入日志。
- [ ] **步骤 6：执行仓库闭环。**
  ```bash
  cd shell-frontend && npm run lint && npm test && npm run build
  cd ../shell-native && cargo test
  cd .. && git diff --check
  ```
  若通知插件需要网络下载依赖，明确记录未完成的依赖安装或使用的已缓存版本，不把未验证写成通过。

## 计划自检

- 搜索边界：任务 1、2、6 覆盖规范、壳侧删除和范本不实现搜索。
- Bridge 地基：任务 3 覆盖信封、握手、来源、版本、主题和生命周期。
- 原生能力：任务 4 覆盖权限、通知、回执、点击导航、启动等待和错误码。
- 应用基础契约：任务 5、6 覆盖 `/health`、`/settings`、manifest 和手工通信范本。
- 真实验证：任务 7 覆盖跨源浏览器和 macOS 通知链路。
- 未引入：搜索 SDK、通用应用市场、内置应用 `postMessage`、全局搜索状态、未来 badge/open-external 等 speculative 能力。

计划中没有 `TODO`、`TBD` 或“自行补充测试”的空步骤；通知插件点击 ID 的兼容处理已限定在任务 4 的适配器边界内，不改变已批准的 Bridge 契约。
