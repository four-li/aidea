# AI 模型测试工具实现计划

> **历史实施记录**：本文件只记录当时实现，不是当前平台契约。当前规则以仓库根目录 `AGENTS.md` 和 `docs/guide/` 为准。

**目标：** 在 DevTools 中增加一个 AI 模型测试 Tab，通过 Tauri Rust 后端测试 OpenAI-compatible API 的连通性、用量、模型列表和多模态能力。

**架构：** React 只收集配置和展示结果，Rust 使用现有 `reqwest` 发送请求，API Key 不进入前端网络请求。四项测试由一个 Tauri 命令按测试类型分支执行，互相独立。

**技术栈：** React 18、TypeScript、shadcn/ui、lucide-react、Tauri 2、Rust reqwest、serde。

## 约束

- 不持久化 API Key。
- 不在浏览器启用 `dangerouslyAllowBrowser`。
- 复用现有 DevTools、IPC、shadcn 组件和 CSS 变量。
- 用量接口无权限或第三方不支持时，显示独立状态，不判定为连通失败。

## 任务

1. 先写 Rust 请求构造和响应解析的失败测试，再实现四类请求。
2. 注册 `test_ai_model` Tauri 命令和前端 IPC 类型。
3. 新增 `AiModelTester` Tab，支持配置、单项测试、全部测试和图片选择。
4. 增加前端格式化测试，运行 `npm test`、`npm run lint`、`npm run build`。
