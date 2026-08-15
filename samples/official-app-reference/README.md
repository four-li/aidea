# aIdea 官方应用接入范本（App Bridge）

这是 aIdea 壳 ↔ 子应用通信契约的**最小可运行接入范本**，给所有官方应用做参考。完整协议见仓库根 `docs/guide/aidea-app-bridge.md`。

> 本目录是模板，不是真实应用。通信代码直接写在 `src/main.ts`，没有 SDK 或搜索依赖；其中的 `aidea.yaml` 是 binary manifest 结构范例，URL、SHA-256 和启动二进制均为占位值，不能直接发布或收录。范本内的 Node/Vite 文件不是官方安装包运行依赖。

## 目录内容

| 文件 | 作用 |
| --- | --- |
| `aidea.yaml` | 自包含 binary manifest 结构范例（不能直接发布） |
| `index.html` | 最小页面骨架 |
| `src/main.ts` | 入口：手写 `postMessage`、声明 `supported`、处理主题和跳转 |
| `vite.config.ts` | 提供契约要求的 `GET /health` |
| `package.json` / `tsconfig.json` | 让范本可独立运行的工具配置 |

## 接入清单（子应用必须遵循）

1. **appId 一致**：消息中的 `appId` 必须与 `aidea.yaml` 的 `id` 完全相同。
2. **明确目标源**：从 `document.referrer` 取得父窗口 origin，只接受生产壳 `http://tauri.localhost`、旧壳兼容 `tauri://localhost` 或开发壳 `http://localhost:5173`；跨源 iframe 不要读取 `window.parent.origin`，禁止使用 `'*'` 或模糊匹配。拿不到合法来源时作为独立页面运行，不发送 `ready`。
3. **声明 `supported`**：只列出应用实际支持的壳下发能力。本范本声明 `navigate`；`theme` 是基础能力，不需要声明。
4. **发送 `ready`**：主页面加载和刷新后都发送一次。业务设置由应用自己的主页面内导航完成，不属于 App Bridge 或壳契约。
5. **主题适配**：首屏读取 `aidea_theme=light|dark`，运行期处理壳发来的 `theme` 消息。
6. **binary 启动**：`process.command[0]` 是包根目录的自包含 binary，监听 `127.0.0.1`；`43000-43999` 是端口规范，不是安装拒绝条件，`ready_url` 使用同端口的 `/health`。
7. **搜索自理**：搜索 UI 和逻辑放在应用页面内，遵守 `docs/guide/aidea-search.md`，不通过 App Bridge。

## 本地运行（独立调试，不依赖 aIdea）

按该应用仓库自己的开发文档运行本地调试命令；这些命令不属于 aIdea 官方安装契约。

此时页面照常工作，但不会启用 App Bridge。要体验主题、通知和跳转，需用 aIdea 壳加载本应用（由 `aidea.yaml` 驱动）。
