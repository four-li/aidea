# 官方应用 Release 历史 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为官方应用管理增加 Gitee、GitHub 和自部署 GitLab 的匿名 Release 历史查询，并将更新操作调整到应用卡片底部。

**Architecture:** Rust 根据官方应用仓库 URL 识别平台，调用对应公开 Release API，将不同响应转换为统一结构后通过 Tauri IPC 返回。前端在应用管理页按应用打开更新日志弹窗，展示最多 20 条历史 Release、更新说明和远程页面链接；更新按钮复用现有安装更新流程。

**Tech Stack:** Rust、reqwest、serde_json、Tauri IPC、React、Vitest。

## Global Constraints

- 私有 GitLab 首期只支持匿名 API，不发送 Token；HTTP 仓库地址允许读取公开 Release，但不承诺认证能力。
- 不新增前端网络依赖，不在 WebView 直接请求 Release API。
- 不修改官方应用安装产物校验规则；本次只增加 Release 查询。
- 不自动 git add、commit、push 或创建 PR。

### Task 1: 统一 Release API

**Files:**
- Create: `shell-native/src/official_releases.rs`
- Modify: `shell-native/src/official_market.rs`
- Modify: `shell-native/src/commands/shell.rs`
- Modify: `shell-native/src/lib.rs`
- Test: `shell-native/src/official_releases.rs`

- [ ] 定义统一的 `OfficialRelease` 序列化结构，并实现 Gitee、GitHub、GitLab URL 到 API endpoint 的识别。
- [ ] 对响应做有限字段解析、HTTP 超时和状态码错误转换，每个平台最多请求 20 条。
- [ ] 通过应用 ID 从市场缓存读取仓库地址，新增 `list_official_app_releases` Tauri 命令。
- [ ] 添加 endpoint 生成和平台 JSON 映射测试。

### Task 2: 前端 IPC 与更新日志弹窗

**Files:**
- Modify: `shell-frontend/src/types/official-app.ts`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Modify: `shell-frontend/src/components/AppManagementPage.tsx`
- Test: `shell-frontend/tests/components/AppManagementPage.test.tsx`

- [ ] 增加统一 Release 类型和 IPC mock。
- [ ] 将更新按钮从卡片右上操作区移动到卡片底部操作栏。
- [ ] 为每个官方应用提供“更新日志”入口，首次打开时调用 IPC，页面生命周期内复用已加载列表。
- [ ] 弹窗展示版本、发布时间、标题、纯文本更新说明和远程 Release 链接；查询失败时显示错误但保留远程仓库链接。
- [ ] 添加更新入口位置、IPC 调用、列表展示和失败状态测试。

### Task 3: 验证

- [ ] 运行 `cd shell-frontend && npm run lint && npm test && npm run build`。
- [ ] 运行 `cd shell-native && cargo test`，记录沙箱网络测试限制。
- [ ] 运行 `git diff --check`。
