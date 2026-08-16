# 子应用日志规范与接入实施计划

> **For agentic workers:** 本计划按当前仓库约束在主分支直接执行；不自动 `git add`、commit、push 或创建 PR。

**目标：** 让内置应用和官方应用按统一级别、格式和脱敏规则记录关键运行证据，并让官方应用前端异常进入 aIdea 统一调试页。

**架构：** aIdea 壳继续负责生命周期日志、stdout/stderr 采集、级别过滤和保存清理。每个应用在自己的仓库内增加最小日志模块，不建立共享 SDK；官方应用前端通过自己的本地 HTTP 接口把脱敏后的异常转给服务端，再由服务端输出到 stdout/stderr。

**技术栈：** Rust、Axum、现有 Tokio/Serde、React/TypeScript、现有 Vitest/Rust 测试工具链。

**规范：** `docs/superpowers/specs/2026-08-16-official-app-logging-contract-design.md`

## 全局约束

- 日志首字段只能是 `DEBUG`、`INFO`、`WARN`、`ERROR`；壳负责追加时间、来源和通道。
- 应用读取 `AIDEA_LOG_LEVEL`；缺省 `info`，不直接维护第二套日志文件。
- 禁止记录密码、授权码、OAuth 令牌、API Key、邮件正文、通知正文、完整 URL 查询参数、完整 Diff 和完整响应体。
- 普通点击不打日志；关键启动、外部依赖、核心业务和异常边界必须打点。
- 同一错误只在最终边界记录一次；底层函数保留上下文并继续返回错误。
- 前端日志转发失败不能阻塞业务，也不能循环重试形成日志风暴。
- 版本号只在正式发布前按发布契约统一递增，开发过程中不改版本。
- 不自动暂存、提交、推送或创建 PR。

## 文件边界

### aIdea 仓库

- 修改：`docs/guide/aidea-platform.md`，补充子应用日志格式、级别、事件和输出边界。
- 修改：`docs/guide/aidea-official-app.md`，补充官方应用前端异常转发接口要求。
- 修改：`shell-frontend/src/lib/ipc.ts`、`shell-native/src/commands/shell.rs`，扩展内置应用日志入口支持业务级别和事件名。
- 新增或修改：内置应用日志调用点及测试。
- 新增：本设计文档和本实施计划。

### worktrace 仓库

- 新增：`src/logging.rs`，解析级别、输出单行事件并限制客户端日志输入。
- 修改：`src/lib.rs`、`src/api/mod.rs`、`src/main.rs`，注册 `/api/client-log` 并在启动/就绪边界初始化日志。
- 修改：业务服务端关键错误边界，记录外部请求、数据库/启动失败和最终业务失败。
- 新增：`web/src/lib/logging.ts`，捕获前端未处理异常并非阻塞转发。
- 修改：`web/src/api.ts`、`web/src/main.tsx`，接入日志接口和全局异常处理。
- 新增或修改：Rust 路由/日志测试、前端日志测试。
- 修改：`AGENTS.md`，增加短日志约束并链接 aIdea 开发手册。

### mail-center 仓库

- 新增：`src/logging.rs`，复用同一输出和输入限制规则。
- 修改：`src/lib.rs`、`src/api/mod.rs`、`src/main.rs`，注册 `/api/client-log` 并记录启动/就绪边界。
- 修改：同步、IMAP、账户测试和数据库错误边界，记录失败原因类别、状态和重试信息，不记录邮件正文或凭据。
- 新增：`web/src/lib/logging.ts`，捕获前端未处理异常并非阻塞转发。
- 修改：`web/src/api.ts`、`web/src/main.tsx`，接入日志接口和全局异常处理。
- 新增或修改：Rust 路由/日志测试、前端日志测试。
- 修改：`AGENTS.md`，增加短日志约束并链接 aIdea 开发手册。

## 实施任务

### Task 1：同步 aIdea 日志契约和内置应用入口

**文件：**

- 修改：`docs/guide/aidea-platform.md`
- 修改：`docs/guide/aidea-official-app.md`
- 修改：`shell-native/src/commands/shell.rs`
- 修改：`shell-frontend/src/lib/ipc.ts`
- 修改：对应内置应用调用点和测试

- [ ] 将设计文档中“输出格式”“级别语义”“必须打点事件”“敏感信息”和“官方前端转发”转成开发手册的长期规则；保留现有日志保存策略，不重复描述 UI。
- [ ] 将 `record_builtin_diagnostic` 统一改为接受 `level`、`event` 和 `message`，只允许 `frontend`/`ipc` 来源，复用现有 `diagnostics::append_level`，并同步修改现有调用点和测试 mock；不保留第二套兼容接口。
- [ ] 在 `ipc.ts` 增加类型安全的 `recordBuiltinLog(id, source, level, event, message)` 封装；禁止业务组件直接调用 Tauri `invoke`。
- [ ] 为无效级别、空事件、超长消息和非法应用 ID 增加 Rust 测试；为前端封装增加参数转发测试。
- [ ] 运行 `cargo test`、前端相关测试和 `git diff --check`，确认日志设置、调试页读取和计数行为不回归。

### Task 2：worktrace 服务端日志模块和关键打点

**文件：**

- 新增：`/Users/fourli/Desktop/app/aidea-plugins/worktrace/src/logging.rs`
- 修改：`/Users/fourli/Desktop/app/aidea-plugins/worktrace/src/lib.rs`
- 修改：`/Users/fourli/Desktop/app/aidea-plugins/worktrace/src/api/mod.rs`
- 修改：`/Users/fourli/Desktop/app/aidea-plugins/worktrace/src/main.rs`
- 修改：worktrace 外部请求和业务错误边界
- 新增：`/Users/fourli/Desktop/app/aidea-plugins/worktrace/tests/logging.rs`

- [ ] 定义 `Level`、`enabled(level)`、`log(level, event, details)` 和 `record_client(payload)`；级别从 `AIDEA_LOG_LEVEL` 读取，缺省 `info`，输出单行 `LEVEL event details`。
- [ ] 对客户端 payload 限制级别枚举、事件名长度、消息长度和控制字符；只接受 `frontend` 来源；日志接口返回 `204`，拒绝输入返回 `400`，不把原始非法内容写入 stdout。
- [ ] 在 `build_router_with_database` 的 `/api` 下注册 `POST /client-log`，处理器只调用日志模块，不修改业务状态。
- [ ] 在 `main` 的资源检查、路径解析、数据库打开、端口绑定和服务启动成功边界记录事件；启动失败仍返回错误，不能因日志失败掩盖原错误。
- [ ] 在 Redmine/Git/代码托管请求的最终错误边界记录状态码、超时、重试和错误类别；不记录 Token、完整 URL 查询和响应正文。
- [ ] 测试四档级别过滤、客户端输入校验、路由 `204/400` 和敏感字段不落原文。

### Task 3：worktrace 前端异常转发

**文件：**

- 新增：`/Users/fourli/Desktop/app/aidea-plugins/worktrace/web/src/lib/logging.ts`
- 修改：`/Users/fourli/Desktop/app/aidea-plugins/worktrace/web/src/api.ts`
- 修改：`/Users/fourli/Desktop/app/aidea-plugins/worktrace/web/src/main.tsx`
- 新增：`/Users/fourli/Desktop/app/aidea-plugins/worktrace/web/src/lib/logging.test.ts`

- [ ] 定义 `logClient(level, event, message)`，调用 `/api/client-log`，失败只静默结束，不影响页面业务。
- [ ] 注册 `window.error` 和 `unhandledrejection`；只发送异常类型、稳定事件名和脱敏短消息，去掉 URL 查询和过长文本。
- [ ] 保持现有 App Bridge、主题和 Toaster 初始化顺序；不得引入 Tauri IPC 或新的壳消息协议。
- [ ] 测试接口 payload、异常监听注册/清理、转发失败不抛出和消息截断。

### Task 4：mail-center 服务端日志模块和关键打点

**文件：**

- 新增：`/Users/fourli/Desktop/app/aidea-plugins/mail-manager/src/logging.rs`
- 修改：`/Users/fourli/Desktop/app/aidea-plugins/mail-manager/src/lib.rs`
- 修改：`/Users/fourli/Desktop/app/aidea-plugins/mail-manager/src/api/mod.rs`
- 修改：`/Users/fourli/Desktop/app/aidea-plugins/mail-manager/src/main.rs`
- 修改：同步、IMAP、账户和数据库错误边界
- 新增：`/Users/fourli/Desktop/app/aidea-plugins/mail-manager/tests/logging.rs`

- [ ] 使用与 worktrace 相同的级别、格式、payload 限制和 `POST /api/client-log` 返回约定；不复制第二套数据存储。
- [ ] 在资源检查、路径/数据库初始化、HTTP 监听、服务就绪和停止边界记录事件。
- [ ] 在 IMAP 连接、认证、同步、附件处理和数据库失败边界记录服务商、账户内部 ID、错误类别、重试次数和状态；禁止邮件地址密码、主题、正文、授权码和响应正文进入日志。
- [ ] 对现有 `append_realtime_debug` 做兼容检查；新业务日志走 stdout/stderr，保留旧测试覆盖的历史调试文件行为，除非确认它是本次日志 UI 的重复来源再单独移除。
- [ ] 测试级别过滤、客户端接口校验、敏感内容脱敏和同步失败日志。

### Task 5：mail-center 前端异常转发

**文件：**

- 新增：`/Users/fourli/Desktop/app/aidea-plugins/mail-manager/web/src/lib/logging.ts`
- 修改：`/Users/fourli/Desktop/app/aidea-plugins/mail-manager/web/src/api.ts`
- 修改：`/Users/fourli/Desktop/app/aidea-plugins/mail-manager/web/src/main.tsx`
- 新增：`/Users/fourli/Desktop/app/aidea-plugins/mail-manager/web/src/lib/logging.test.ts`

- [ ] 定义与 worktrace 一致的 `logClient` 和异常监听；不发送邮件正文、主题、地址查询参数或完整错误响应。
- [ ] 转发失败静默处理，不改变现有请求错误提示、Bridge 初始化和主题行为。
- [ ] 测试监听生命周期、payload 脱敏/截断和失败静默。

### Task 6：更新两个官方应用长期约束

**文件：**

- 修改：`/Users/fourli/Desktop/app/aidea-plugins/worktrace/AGENTS.md`
- 修改：`/Users/fourli/Desktop/app/aidea-plugins/mail-manager/AGENTS.md`

- [ ] 增加简短“日志”小节：读取 `AIDEA_LOG_LEVEL`、只向 stdout/stderr 输出、关键事件必须打点、前端异常走应用接口、敏感信息禁止记录。
- [ ] 明确详细格式以 `/Users/fourli/Desktop/app/aIdea/docs/guide/aidea-platform.md` 和 `aidea-official-app.md` 为准，不在子应用复制完整标准。
- [ ] 运行各仓库 `git diff --check`，检查绝对路径链接和文档内容一致。

### Task 7：闭环验证和人工场景验收

**文件：**

- 无新增代码；验证 Task 1-6 的变更

- [ ] aIdea 仓库运行：`cd shell-frontend && npm run lint && npm test && npm run build`；`cd ../shell-native && cargo test`。
- [ ] worktrace 运行：`npm test`、`npm run build`、`cargo test`、`cargo fmt --check`、`cargo clippy -- -D warnings`。
- [ ] mail-center 运行：`npm test`、`npm run build`、`cargo test`、`cargo fmt --check`、`cargo clippy -- -D warnings`。
- [ ] 在本地安装运行环境中验证：端口占用、启动失败、403、超时、同步失败、前端未处理异常、正常停止；每种情况都能在统一调试页复制到对应运行日志。
- [ ] 验证 `warn/info/debug` 三档过滤和日志清理不触碰任何 `app-data`。
- [ ] 最后运行三个仓库的 `git diff --check` 和状态检查，向用户明确报告已验证和未验证项目。

## 依赖顺序

Task 1 必须先完成，因为它定义内置应用接口和官方应用文档；Task 2/3 与 Task 4/5 可分别实现，但各自服务端任务必须先于对应前端任务；Task 6 在规范文本稳定后执行；Task 7 最后统一验收。

## 计划自检

- 设计文档的目标、非目标、日志格式、级别、关键事件、脱敏、前端转发、封装策略和长期约束均有对应任务。
- 未引入共享 SDK、诊断包或新的壳通信协议。
- 子应用的现有 `realtime-debug.log` 兼容行为已列为检查项，避免未经确认删除历史能力。
- 版本号、提交和推送不属于开发阶段动作，按仓库约束明确排除。
