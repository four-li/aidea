# AI Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 aIdea 的 AI 模型测试重构为独立内置应用 AI Service，并让官方应用能通过受管的本机 `POST /api/agent` 使用 Rig Agent 与六个本机工具。

**Architecture:** AI Service 在 aIdea 进程内启动只监听 `127.0.0.1:43880` 的 Axum 服务，HTTP 层只接受受管令牌和 `{ "message": "..." }`。模型、服务绑定、令牌和审计记录存入 `app-data/ai-service/app.db`；Agent、工具、命令保护和审计都留在 Rust 内部，前端只通过 Tauri IPC 管理配置、测试模型和查看审计。

**Tech Stack:** Rust、Tauri 2、Tokio、Axum `0.8.9`、Rig 根 facade `rig 0.41.0`、Reqwest、Rusqlite、React、TypeScript、shadcn/ui、dnd-kit、Vitest。

**Spec:** `docs/superpowers/specs/2026-08-17-ai-service-design.md`

## Global Constraints

- 内置应用 ID 固定为 `ai-service`，数据只放在 `app-data/ai-service/app.db`。
- 仅监听 `127.0.0.1:43880`；官方应用只使用壳注入的 `AIDEA_AI_SERVICE_URL`、`AIDEA_AI_SERVICE_TOKEN`，不接触上游 API Key。
- 首期唯一对外服务是同步 JSON `POST /api/agent`，请求只接受 `message`，成功 `data` 始终是字符串。
- 首期只提供 `read_file`、`write_file`、`edit_file`、`exec`、`search`、`list_dir`；不实现 SSE、图片、视频、Codex app-server、HTTP 专用工具或业务专用 endpoint。
- Agent 任务最多 120 秒、12 轮；单次 `exec` 最多 30 秒；所有工具输出上限 100 KiB，截断结果必须标明截断。
- `exec` 使用 `/bin/zsh -f -c`，只接受绝对 `cwd`，不继承 API Key、AI Service token 或 aIdea 其他敏感环境变量。
- CommandGuard：明确系统危险命令拒绝，高风险删除/强推等必须由当前前台 AI Service 页面授权，普通 git/curl/构建/测试默认允许。
- 审计默认开启，记录脱敏元数据，绝不保存完整 message、模型回复、工具参数/输出、业务正文或凭据；关闭时必须不连数据库、不格式化或复制审计内容。
- 复用现有 shadcn/ui 与 dnd-kit；不新增第二套 UI 组件库，不为未来服务建立空实现、占位页面或运行时发现 API。
- 不保留 DevTools 旧 AI 配置、历史或迁移逻辑；直接删除旧实现与前端测试。
- 不自动执行 `git add`、commit、push 或创建 PR。

---

## 文件结构

| 文件 | 职责 |
| --- | --- |
| `shell-native/Cargo.toml` | 固定 Axum、Rig 与路由测试依赖。 |
| `shell-native/resources/rg`、`shell-native/resources/rg-LICENSE`、`shell-native/tauri.conf.json` | 随 macOS arm64 安装包发布 aIdea 自带的 ripgrep 及许可证，并声明为 Tauri resource。 |
| `shell-native/src/ai_service/mod.rs` | AI Service 状态、SQLite 建表/迁移、模型配置与服务注册表、访问令牌、Tauri 初始化入口。 |
| `shell-native/src/ai_service/http.rs` | Axum 路由、Bearer 校验、请求大小/JSON 校验、统一 HTTP 响应和服务启动。 |
| `shell-native/src/ai_service/agent.rs` | Rig OpenAI 兼容模型适配、系统指令、120 秒/12 轮边界和 Agent 任务编排。 |
| `shell-native/src/ai_service/tools.rs` | 六个工具、100 KiB 限制、原子文件写入、`/bin/zsh -f` 执行和 CommandGuard 分类。 |
| `shell-native/src/ai_service/audit.rs` | `AuditRecorder`、run/event 数据库读写、脱敏摘要、关闭审计的无操作快路径。 |
| `shell-native/src/commands/ai_service.rs` | AI Service 配置、排序、服务绑定、模型测试、审计查询、开关与高风险授权的 Tauri IPC。 |
| `shell-native/src/commands/ai.rs` | 删除；其中的 DevTools AI 测试和历史配置不迁移。 |
| `shell-native/src/commands/mod.rs`、`shell-native/src/lib.rs`、`shell-native/src/process.rs` | 注册新模块/IPC，在 aIdea 启动和官方应用启动时初始化 AI Service 并注入 URL/token。 |
| `apps/builtin/ai-service.yaml` | AI Service 独立内置应用 manifest。 |
| `shell-frontend/src/builtin-apps/ai-service/` | 模型配置、服务列表、模型测试、审计记录和授权弹窗页面。 |
| `shell-frontend/src/types/ai-service.ts`、`shell-frontend/src/lib/ipc.ts` | 与 Rust IPC 一一对应的前端类型与调用封装。 |
| `shell-frontend/src/components/BuiltinPage.tsx` | 根据 `ai-service` 渲染新内置应用。 |
| `shell-frontend/src/builtin-apps/dev-tools/`、`shell-frontend/src/types/ai-test.ts` | 删除旧 AI 测试 tab、类型和引用，不改变其它 DevTools 工具。 |
| `shell-frontend/tests/ai-service/` | AI Service 页面和授权交互的 Vitest 覆盖。 |
| `docs/guide/aidea-ai-service.md`、相关 guide | 实现后回填已实现路径、初始化和官方应用调用样例；不改变已确认的公共契约。 |

## 任务

### Task 1: 建立 AI Service 数据模型、服务注册表与受管令牌

**Files:**
- Create: `shell-native/src/ai_service/mod.rs`
- Create: `shell-native/src/commands/ai_service.rs`
- Modify: `shell-native/Cargo.toml`
- Modify: `shell-native/src/commands/mod.rs`
- Modify: `shell-native/src/lib.rs`
- Delete: `shell-native/src/commands/ai.rs`

**Interfaces:**
- Produces: `AiServiceState`, `ModelConfig`, `ModelConfigSummary`, `ServiceDefinition`, `ServiceSummary`, `access_token() -> AppResult<String>`.
- Produces: Tauri IPC `list_ai_service_models`, `save_ai_service_model`, `delete_ai_service_model`, `reorder_ai_service_models`, `list_ai_service_services`, `save_ai_service_service_model`.
- Consumes: `crate::config::app_data_dir("ai-service")`, `AppError` / `AppResult`.

- [ ] **Step 1: 写 SQLite 模型选择规则的失败测试**

在 `ai_service::tests` 使用临时 `app-data/ai-service` 目录建立数据库，验证：

```rust
assert_eq!(select_model(&service_with_no_binding, &models)?.id, first_enabled.id);
assert!(select_model(&service_bound_to_deleted_id, &models).is_err());
assert_eq!(load_or_create_access_token(&root)?, load_or_create_access_token(&root)?);
```

还要验证重新排序后第一个启用模型改变，删除未绑定模型不影响服务，保存的返回类型绝不包含 `api_key`。

- [ ] **Step 2: 运行测试，确认当前不存在 AI Service 模块**

Run: `cd shell-native && cargo test ai_service::tests::服务未绑定时使用排序第一的可用模型`

Expected: FAIL，因为 `ai_service` 模块和 `select_model` 尚未存在。

- [ ] **Step 3: 实现最小持久化状态**

在 `ai_service/mod.rs` 建立以下表并启用现有的 WAL/5 秒 busy timeout：

```sql
CREATE TABLE IF NOT EXISTS ai_service_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  access_token TEXT NOT NULL,
  audit_enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ai_service_models (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS ai_service_services (
  id TEXT PRIMARY KEY,
  model_id TEXT NULL
);
```

只注册 `agent` 服务：路径 `/api/agent`、协议 `json`、说明为“带本机工具的一次性 Agent 任务”。首次打开数据库时用 `uuid::Uuid::new_v4()` 建立 access token，保存后复用。`ModelConfigSummary` 只返回掩码后的 Key 提示，读写 API Key 的输入只存在于保存调用中。

直接依赖固定为：

```toml
axum = "0.8.9"
rig = "=0.41.0"
```

使用项目已有的 `uuid::Uuid::new_v4()` 生成 token；不新增加密、密钥服务或配置历史表。

- [ ] **Step 4: 注册 IPC 和应用状态**

将 `AiServiceState` 通过 `.manage(...)` 放入 Tauri；`commands/ai_service.rs` 只负责 IPC 输入校验和调用状态方法。模型排序使用前端传入的完整 ID 顺序，拒绝重复、未知或缺失 ID；服务 `model_id: Option<String>` 只允许 `None` 或现有模型 ID。删除被绑定模型只删除模型行，保留绑定 ID，以便服务显示“未配置”并拒绝请求。

删除 `commands::ai` 的 module 声明和所有旧 AI Tauri command，确保旧 DevTools `ai_configs` 不再被读取或写入。

- [ ] **Step 5: 运行 Rust 数据层测试**

Run: `cd shell-native && cargo test ai_service::tests`

Expected: PASS，覆盖默认选择、绑定删除后失败、排序、token 稳定性和 API Key 不出现在摘要类型中。

### Task 2: 启动本机 HTTP 服务并向官方应用注入访问环境

**Files:**
- Create: `shell-native/src/ai_service/http.rs`
- Modify: `shell-native/src/ai_service/mod.rs`
- Modify: `shell-native/src/lib.rs`
- Modify: `shell-native/src/process.rs`

**Interfaces:**
- Produces: `pub const AI_SERVICE_URL: &str = "http://127.0.0.1:43880"`, `start_http_server(state: AiServiceState)`。
- Produces: `router(state) -> axum::Router`，供路由单测直接调用。
- Consumes: `access_token()`；Task 3 将实现的 `run_agent(message, model, audit)`。

- [ ] **Step 1: 写路由认证与请求校验的失败测试**

用 `tower::ServiceExt::oneshot` 调用 `router`，覆盖：

```rust
assert_eq!(post("/api/agent", None, json!({"message":"x"})).status(), StatusCode::UNAUTHORIZED);
assert_eq!(post("/api/agent", Some("wrong"), json!({"message":"x"})).status(), StatusCode::UNAUTHORIZED);
assert_eq!(post("/api/agent", Some(&token), json!({"message":"  "})).status(), StatusCode::BAD_REQUEST);
assert_eq!(post("/api", Some(&token), json!({"message":"x"})).status(), StatusCode::NOT_FOUND);
```

对无可用模型的有效请求断言 `503` 和统一错误体 `{ code, data: "", message }`。在 `Cargo.toml` 添加仅测试使用的 `tower` `util` feature，不搭建真实端口监听测试。

- [ ] **Step 2: 运行路由测试，确认失败**

Run: `cd shell-native && cargo test ai_service::http::tests::拒绝缺失令牌和空消息`

Expected: FAIL，因为 router 尚未定义。

- [ ] **Step 3: 实现最小 Axum 边界**

实现唯一的 `POST /api/agent`：限制 body 大小，反序列化只有 `message` 的请求对象，`trim()` 后为空返回 `400`。Bearer 缺失或不匹配返回 `401`。服务未就绪、没有默认模型或绑定模型失效返回 `503`。完成执行的业务成功/失败都返回 `200` 和固定 JSON：

```rust
#[derive(Serialize)]
struct AgentResponse {
    code: u32,
    data: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}
```

启动时使用 `tokio::net::TcpListener::bind("127.0.0.1:43880")` 和 `axum::serve`。绑定失败记录 AI Service 自身诊断并将服务标记为未就绪，不能让整个 Tauri 壳退出。只启动一次；不增加健康接口或任何尚未实现的 `/api/*` 路由。

- [ ] **Step 4: 在生命周期和官方应用启动路径接线**

在 Tauri `.setup` 中、启动受管官方应用之前初始化 token 和 Axum 任务。修改 `ProcessManager::start_official` 与 staging 健康检查启动路径，在已有 `env_clear()` 之后同时注入：

```rust
command
    .env("AIDEA_AI_SERVICE_URL", ai_service::AI_SERVICE_URL)
    .env("AIDEA_AI_SERVICE_TOKEN", ai_service::access_token()?);
```

仍保留现有的受限 `PATH` 与应用数据/日志变量。不要把 API Key、模型配置或其他 AI Service 内部变量注入子进程。

- [ ] **Step 5: 运行路由和进程环境测试**

Run: `cd shell-native && cargo test ai_service::http::tests && cargo test process::tests`

Expected: PASS；路由拒绝非法请求，官方应用启动环境包含 URL/token 且不包含上游 Key。

### Task 3: 实现审计存储与关闭时的无操作快路径

**Files:**
- Create: `shell-native/src/ai_service/audit.rs`
- Modify: `shell-native/src/ai_service/mod.rs`
- Modify: `shell-native/src/commands/ai_service.rs`

**Interfaces:**
- Produces: `AuditRecorder::new(enabled: bool, db_path: PathBuf)`, `start_run`, `record_event`, `finish_run`。
- Produces: `AuditRunSummary`, `AuditRunDetail`, `AuditEvent`, IPC `get_ai_service_audit_settings`, `save_ai_service_audit_settings`, `list_ai_service_audit_runs`, `get_ai_service_audit_run`。
- Consumes: `AiServiceState` 的数据库路径和全局 `audit_enabled` 内存快照。

- [ ] **Step 1: 写审计行为的失败测试**

使用临时数据库验证以下可观察行为：

```rust
let disabled = AuditRecorder::new(false, missing_db_path);
assert!(disabled.start_run("agent").is_none());
assert!(!missing_db_path.exists());

let run = enabled.start_run("agent").unwrap();
enabled.record_event(&run, "tool", "read_file", 12, None, "read file");
enabled.finish_run(&run, AuditStatus::Succeeded, None, TokenUsage::default());
assert_eq!(load_run(&run)?.events.len(), 2);
```

同时断言摘要替换 `Bearer ...`、`sk-...` 等常见凭据，限制为短文本，且详细查询不包含 message、工具参数、工具输出或最终 `data`。

- [ ] **Step 2: 运行审计测试，确认失败**

Run: `cd shell-native && cargo test ai_service::audit::tests`

Expected: FAIL，因为 `AuditRecorder` 尚未存在。

- [ ] **Step 3: 实现 run/event 表与最小记录器**

创建 `ai_service_audit_runs`、`ai_service_audit_events` 表；run 记录服务、状态、开始/结束时间、总耗时、loop 数、三种可空 token 数和脱敏错误摘要。event 记录 run ID、顺序、类型、名称、耗时、可空 token 增量和已脱敏的短摘要。

`AuditRecorder` 只持有调用开始时的 `enabled` 布尔值：为 `false` 时每个方法立刻返回，不打开连接、不给摘要分配 String、不发后台任务。写入失败吞掉并写一条不含业务内容的诊断，绝不能改变 Agent 响应。使用 `Instant` 计算耗时，使用 Unix 时间保存展示时间。

- [ ] **Step 4: 增加审计 IPC**

审计开关保存到 `ai_service_settings`，默认 `true`，关闭仅影响后续请求。列表按开始时间倒序返回 run 元数据；详情返回有序 event。没有按应用来源筛选、没有公开 HTTP 查询、没有清空历史按钮。

- [ ] **Step 5: 运行审计测试**

Run: `cd shell-native && cargo test ai_service::audit::tests`

Expected: PASS，尤其是关闭时不创建数据库、token 缺失可展示、凭据脱敏和打点失败不影响任务的路径。

### Task 4: 实现六个本机工具与 CommandGuard

**Files:**
- Create: `shell-native/src/ai_service/tools.rs`
- Create: `shell-native/resources/rg`
- Create: `shell-native/resources/rg-LICENSE`
- Modify: `shell-native/tauri.conf.json`
- Modify: `shell-native/src/ai_service/audit.rs`

**Interfaces:**
- Produces: `AiTools`，暴露 Rig 需要的六个带 JSON schema 的工具定义和执行函数。
- Produces: `CommandDecision::{Allow, RequireApproval, Deny}`、`classify_command(command: &str) -> CommandDecision`。
- Consumes: `AuditRecorder`；Task 5 的 `ApprovalManager`。

- [ ] **Step 1: 写工具与命令分类的失败测试**

临时目录覆盖：

```rust
assert_eq!(read_file(file, Some(2), Some(3))?, "line2\nline3\n");
assert!(edit_file(file, "same", "new").is_err()); // 旧文本有两次匹配
assert!(classify_command("sudo rm -rf /"), CommandDecision::Deny);
assert!(classify_command("git push --force"), CommandDecision::RequireApproval);
assert!(classify_command("git commit -m test"), CommandDecision::Allow);
assert!(classify_command("curl -X DELETE https://example.test/x"), CommandDecision::RequireApproval);
```

还要验证 `write_file`/`edit_file` 原子替换且父目录缺失失败、相对路径与非 UTF-8 文件拒绝、目录读取/search/list_dir/exec 输出达到 100 KiB 时带有明确截断标记、`exec` 在绝对 `cwd` 运行并在 30 秒后超时。

- [ ] **Step 2: 运行工具测试，确认失败**

Run: `cd shell-native && cargo test ai_service::tools::tests`

Expected: FAIL，因为工具和 CommandGuard 尚未存在。

- [ ] **Step 3: 实现文件、搜索与目录工具**

文件工具只接受绝对普通文件路径与 UTF-8；行号从 1 开始且包含结尾。`write_file` 和 `edit_file` 在同目录创建随机临时文件、`sync_all` 后 `rename`，不自动创建父目录。`edit_file` 只允许 `old_text` 恰好匹配一次。

将 ripgrep `14.1.1` 的 macOS arm64 `rg` 二进制放入 `shell-native/resources/rg`，在 `tauri.conf.json` 的 `bundle.resources` 中显式声明。运行时通过 `app.path().resource_dir()?.join("resources/rg")` 得到固定绝对路径，`search` 只能调用该文件而不读取用户 PATH；随二进制加入其 MIT/UNLICENSE 许可证文本。`list_dir` 用 `std::fs::read_dir` 递归至请求 depth；不能预先构建 `copy/move/git/http/run_test` 等工具。

- [ ] **Step 4: 实现 exec 与最小命令保护**

`exec` 要求绝对且存在的 `cwd`，以：

```rust
Command::new("/bin/zsh")
    .args(["-f", "-c", command])
    .current_dir(cwd)
    .env_clear()
    .env("PATH", tool_path)
```

启动子进程。`PATH` 只包含 aIdea 自带 `rg` 所在目录和 macOS 系统目录；不携带 token/API Key。返回退出码、stdout、stderr；非零退出码作为工具结果而不是硬失败。

CommandGuard 在 shell 字符串执行前检查所有命令段（`|`、`&&`、`||`、`;` 和换行均是段边界）：`sudo`/`su`/`doas`/`mkfs`/`diskutil erase`/`shutdown`/`reboot` 立即拒绝；递归 `rm`、`git reset --hard`、`git clean`、`git push --force`、删除分支/标签、`curl -X DELETE` 进入授权；`git`、`curl`、构建/测试保留允许。首期不解析脚本内容、不试图识别绕过方式。

- [ ] **Step 5: 运行工具测试**

Run: `cd shell-native && cargo test ai_service::tools::tests`

Expected: PASS，覆盖六个工具、超时、输出截断、原子写入和三类命令决策。

### Task 5: 接入 Rig Agent 循环和当前任务的高风险授权

**Files:**
- Create: `shell-native/src/ai_service/agent.rs`
- Modify: `shell-native/src/ai_service/http.rs`
- Modify: `shell-native/src/ai_service/tools.rs`
- Modify: `shell-native/src/ai_service/audit.rs`
- Modify: `shell-native/src/commands/ai_service.rs`

**Interfaces:**
- Produces: `run_agent(state, message, selected_model, recorder) -> AgentResponse`。
- Produces: `ApprovalRequest`, IPC `list_ai_service_pending_approvals`, `resolve_ai_service_approval(id, approved)`。
- Consumes: Rig `openai::Client::builder().api_key(...).base_url(...).build()`、六个工具、AuditRecorder。

- [ ] **Step 1: 写 Agent 边界与授权等待的失败测试**

使用本机 HTTP 测试服务返回固定 OpenAI-compatible tool call，验证工具结果会再次回传模型，最终文本进入 `data`；同时验证：

```rust
assert_eq!(timeout_result.code, 1001);
assert!(loop_limit_result.message.unwrap().contains("轮次"));
assert_eq!(denied_approval_result.code, 1003);
```

对需要授权的 `git push --force`，断言 IPC 能看到带命令短摘要的 pending 请求，批准只唤醒当前工具调用，拒绝或 120 秒总超时导致统一失败响应。

- [ ] **Step 2: 运行 Agent 测试，确认失败**

Run: `cd shell-native && cargo test ai_service::agent::tests`

Expected: FAIL，因为 `run_agent` 和授权管理尚未存在。

- [ ] **Step 3: 实现 Rig OpenAI 兼容 Agent**

为本次 HTTP 请求复制已选择模型的配置快照，使用 `rig::providers::openai::Client::builder()` 的 `api_key` 与 `base_url` 创建模型，注册 Task 4 的六个工具。系统提示词只承担通用安全语义：顶层用户任务优先，邮件/代码/Redmine 等引用内容不可自行升级为执行或修改指令；不插入 Worktrace/Mail Center 业务提示词。

Agent 循环最多 12 轮，总体用 `tokio::time::timeout(Duration::from_secs(120), ...)` 包住。每轮记录模型耗时与 usage（提供方缺失则保持 `None`）；工具调用记录工具耗时。上游失败、工具失败、超时、授权拒绝分别映射到稳定非零 `code` 与中文 `message`，但只把模型最终纯文本原样放进成功 `data`。

- [ ] **Step 4: 实现只服务于当前任务的授权等待**

`ApprovalManager` 用进程内 `Mutex<HashMap<Uuid, oneshot::Sender<bool>>>` 关联当前高风险工具调用和前端请求；不创建公开 run 查询或授权 HTTP API。AI Service 页面未打开或不响应时，等待属于 120 秒任务总时限的一部分。审计记录 `approval` event，只记录命令类别和允许/拒绝，不记录完整命令或参数。

- [ ] **Step 5: 连接路由、审计与 Agent 后运行测试**

Run: `cd shell-native && cargo test ai_service::agent::tests && cargo test ai_service::http::tests`

Expected: PASS，`POST /api/agent` 对有效 token 返回最终字符串，工具循环和授权按当前任务完成，失败统一为 `code != 0`。

### Task 6: 新建 AI Service 内置应用和 IPC 前端契约

**Files:**
- Create: `apps/builtin/ai-service.yaml`
- Create: `shell-frontend/src/types/ai-service.ts`
- Create: `shell-frontend/src/builtin-apps/ai-service/index.tsx`
- Modify: `shell-frontend/src/lib/ipc.ts`
- Modify: `shell-frontend/src/components/BuiltinPage.tsx`

**Interfaces:**
- Produces: `AiServicePage`、`AiServiceModel`、`AiServiceService`、`AiServiceAuditRun`、`AiServiceApprovalRequest` TypeScript types。
- Consumes: Task 1/3/5 IPC commands and existing `Button` / Tabs / dialog primitives.

- [ ] **Step 1: 写内置应用装载的失败测试**

新增 `shell-frontend/tests/ai-service/AiServicePage.test.tsx`，mock `ipc` 并验证：

```tsx
render(<BuiltinPage app={aiServiceManifest} />);
expect(await screen.findByRole('tab', { name: '模型配置' })).toBeInTheDocument();
expect(screen.getByRole('tab', { name: '服务列表' })).toBeInTheDocument();
expect(screen.getByRole('tab', { name: '模型测试' })).toBeInTheDocument();
expect(screen.getByRole('tab', { name: '审计记录' })).toBeInTheDocument();
```

同时断言 manifest ID 是 `ai-service`，不是 DevTools 的子 tab。

- [ ] **Step 2: 运行前端测试，确认失败**

Run: `cd shell-frontend && npm test -- --run tests/ai-service/AiServicePage.test.tsx`

Expected: FAIL，因为 `AiServicePage` 与 manifest 尚未存在。

- [ ] **Step 3: 建立最小页面壳和 IPC 类型**

创建独立 `ai-service.yaml`，使用 `Sparkles` 图标、正常侧栏入口，不放在菜单栏或 DevTools。`BuiltinPage` 对 `ai-service` 直接渲染 `AiServicePage`。`ipc.ts` 用一组 `aiService*` 方法封装新的 Tauri command；禁止复用删除后的 `AiHttpRequest`、`AiTestConfig` 类型。

页面用现有 Tabs 布局提供四项已确认页面，不创建“图片”“视频”“SSE”“Codex”空 tab。窄屏时 tabs 和操作区自动换行，浅色/深色均使用现有 token。

- [ ] **Step 4: 运行页面装载测试**

Run: `cd shell-frontend && npm test -- --run tests/ai-service/AiServicePage.test.tsx`

Expected: PASS，独立内置应用可在 builtin 路由中渲染四个确定页面。

### Task 7: 实现模型配置、排序与服务模型绑定界面

**Files:**
- Create: `shell-frontend/src/builtin-apps/ai-service/ModelConfigPage.tsx`
- Create: `shell-frontend/src/builtin-apps/ai-service/ServiceListPage.tsx`
- Modify: `shell-frontend/src/builtin-apps/ai-service/index.tsx`
- Modify: `shell-frontend/tests/ai-service/AiServicePage.test.tsx`

**Interfaces:**
- Consumes: `ipc.listAiServiceModels`, `saveAiServiceModel`, `deleteAiServiceModel`, `reorderAiServiceModels`, `listAiServiceServices`, `saveAiServiceServiceModel`。
- Produces: 用户可编辑的模型列表和 `agent` 服务的“跟随默认/指定模型”选择。

- [ ] **Step 1: 写模型配置交互的失败测试**

在现有 AI Service 页面测试中覆盖：

```tsx
fireEvent.click(screen.getByRole('button', { name: '新增模型' }));
fireEvent.change(screen.getByLabelText('模型名称'), { target: { value: 'gpt-5' } });
fireEvent.click(screen.getByRole('button', { name: '保存模型' }));
expect(mockSaveModel).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-5' }));
```

模拟 dnd-kit `onDragEnd`，断言完整模型 ID 顺序传给 `reorderAiServiceModels`。在服务列表中选择指定模型、恢复“跟随默认”、删除绑定模型后均应显示“未配置”，且不改为其它模型。

- [ ] **Step 2: 运行前端配置测试，确认失败**

Run: `cd shell-frontend && npm test -- --run tests/ai-service/AiServicePage.test.tsx`

Expected: FAIL，因为模型/服务页面尚未实现。

- [ ] **Step 3: 实现配置与服务列表**

模型表格显示提供方、Base URL、模型名、Key 提示、启用状态与拖拽手柄。新增/编辑使用现有 Dialog、Input、Switch，API Key 默认密码框且仅编辑时显示；删除使用确认 Dialog。拖拽直接复用项目已安装的 dnd-kit，不新增排序库。

服务列表只渲染后端返回的真实 `agent`，显示路径、协议、工具能力、状态和模型 Select。绑定失效显示明确未配置状态；用户必须明确选择可用模型或恢复跟随默认，前端不替他选。

- [ ] **Step 4: 运行前端配置测试**

Run: `cd shell-frontend && npm test -- --run tests/ai-service/AiServicePage.test.tsx`

Expected: PASS，新增/编辑/删除/排序与服务绑定都只通过 AI Service IPC 完成。

### Task 8: 迁移模型测试并实现高风险命令授权弹窗

**Files:**
- Create: `shell-frontend/src/builtin-apps/ai-service/ModelTestPage.tsx`
- Create: `shell-frontend/src/builtin-apps/ai-service/ApprovalDialog.tsx`
- Modify: `shell-frontend/src/builtin-apps/ai-service/index.tsx`
- Modify: `shell-frontend/tests/ai-service/AiServicePage.test.tsx`
- Modify: `shell-frontend/src/builtin-apps/dev-tools/index.tsx`
- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs.ts`
- Modify: `shell-frontend/src/builtin-apps/dev-tools/DevToolsSettingsPage.tsx`
- Delete: `shell-frontend/src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester.tsx`
- Delete: `shell-frontend/tests/dev-tools/tabs/ai-model-tester/AiModelTester.test.tsx`
- Delete: `shell-frontend/src/types/ai-test.ts`

**Interfaces:**
- Consumes: `ipc.testAiServiceModel`, `listAiServicePendingApprovals`, `resolveAiServiceApproval`。
- Produces: 普通模型连通性测试、经 Agent 的测试、当前 pending 授权确认界面。

- [ ] **Step 1: 写模型测试与授权弹窗的失败测试**

验证模型测试页只能从保存的模型配置选模型，执行普通连通测试或 Agent 测试，并呈现脱敏后的成功/错误结果。对授权弹窗验证：

```tsx
expect(await screen.findByRole('dialog', { name: '高风险命令授权' })).toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: '允许本次执行' }));
expect(mockResolveApproval).toHaveBeenCalledWith(id, true);
```

拒绝按钮必须传 `false`；没有 pending 时不显示弹窗，不显示或编辑完整命令。

- [ ] **Step 2: 运行测试，确认失败**

Run: `cd shell-frontend && npm test -- --run tests/ai-service/AiServicePage.test.tsx`

Expected: FAIL，因为测试和授权页面尚未实现。

- [ ] **Step 3: 实现新模型测试与授权轮询**

模型测试迁入 AI Service：普通测试直接通过所选已保存配置调用 OpenAI-compatible 最小请求；Agent 测试调用 AI Service 内部 `run_agent`，不允许手填 URL/API Key。结果显示最终文本、耗时、HTTP/任务错误，不保存完整业务内容。

AI Service 页面挂载时及有 pending 时以短间隔轮询 `listAiServicePendingApprovals`，用现有 Dialog 呈现命令类别、工作目录和风险原因的短摘要。允许和拒绝只调用当前 `id`；关闭 dialog 等价拒绝。不要建立共享 EventSource、WebSocket 或任务页。

- [ ] **Step 4: 删除 DevTools 旧 AI 测试表面**

从 `DEV_TOOLS_TABS` 移除 `ai`，让现有 `normalizeDevToolsTabOrder` 自动忽略旧配置里的 `ai` ID；删除前端测试、类型、组件和 IPC 旧方法。删除 Rust `ai.rs` 后，确保无前端/测试引用 `send_ai_http_request`、`save_ai_config`、`list_ai_configs`、`load_ai_config`、`delete_ai_config`。

- [ ] **Step 5: 运行迁移和授权测试**

Run: `cd shell-frontend && npm test -- --run tests/ai-service/AiServicePage.test.tsx tests/components/AppManagementPage.test.tsx`

Expected: PASS，AI 测试仅存在于 AI Service，授权仅面向当前高风险调用。

### Task 9: 实现审计记录页面

**Files:**
- Create: `shell-frontend/src/builtin-apps/ai-service/AuditPage.tsx`
- Modify: `shell-frontend/src/builtin-apps/ai-service/index.tsx`
- Modify: `shell-frontend/tests/ai-service/AiServicePage.test.tsx`

**Interfaces:**
- Consumes: `ipc.getAiServiceAuditSettings`, `saveAiServiceAuditSettings`, `listAiServiceAuditRuns`, `getAiServiceAuditRun`。
- Produces: 审计开关、run 列表和单一 run 时间线详情。

- [ ] **Step 1: 写审计 UI 的失败测试**

mock 一个带模型、工具、授权 event 的 run，断言列表显示状态、总耗时、token 使用量（缺失显示“未提供”）；打开详情显示按顺序的时间线和模型/工具/授权耗时。关闭开关后断言保存 `false` 且页面仍显示历史记录和“新的调用不再记录”的提示。

- [ ] **Step 2: 运行审计 UI 测试，确认失败**

Run: `cd shell-frontend && npm test -- --run tests/ai-service/AiServicePage.test.tsx`

Expected: FAIL，因为审计页面尚未实现。

- [ ] **Step 3: 实现最小审计页**

使用一个非嵌套的两栏布局：左侧 run 列表，右侧选中 run 的时间线。显示固定审计字段，来源固定显示“未知”；不要显示 message、业务数据、完整 command 或工具输出。开关使用 shadcn Switch，失败 toast 提示并回滚界面状态；开关关闭不会删除或隐藏历史。

- [ ] **Step 4: 运行审计 UI 测试**

Run: `cd shell-frontend && npm test -- --run tests/ai-service/AiServicePage.test.tsx`

Expected: PASS，审计开关和时间线均由 IPC 数据驱动。

### Task 10: 完成文档、回归与发布前质量检查

**Files:**
- Modify: `docs/guide/aidea-ai-service.md`
- Modify: `docs/guide/aidea-official-app.md`
- Modify: `shell-native/Cargo.lock`

**Interfaces:**
- Consumes: 已完成实现和正式 AI Service 契约。
- Produces: 可由官方应用开发者直接遵守的调用示例，且与实际环境变量、端口、路径和错误体一致。

- [ ] **Step 1: 写文档一致性检查**

用以下搜索确保删除旧契约和错误入口：

```bash
rg -n 'AI Gateway|AI_GATEWAY|/api"|send_ai_http_request|save_ai_config|ai-model-tester' \
  AGENTS.md docs shell-native shell-frontend apps
```

Expected: 除历史设计说明中刻意保留的“未实现”文字外，没有旧实现名、旧 IPC 或 `/api` Agent 别名。

- [ ] **Step 2: 回填实现后的手册说明**

确认 `aidea-ai-service.md` 的环境变量、固定端口、仅 `POST /api/agent`、消息和响应示例、六个工具边界、授权、审计开关及 Rig 升级纪律都与代码一致。官方应用规范只补充“官方应用用注入变量调用 AI Service”，不复制整份 AI 契约。

- [ ] **Step 3: 运行 Rust 全量测试**

Run: `cd shell-native && cargo test`

Expected: PASS。此命令需要允许本机回环端口监听的权限；若路由测试能完全通过 `oneshot` 避免监听，则无需额外监听测试。

- [ ] **Step 4: 运行前端完整验证**

Run: `cd shell-frontend && npm run lint && npm test && npm run build`

Expected: PASS，TypeScript 严格检查、旧 DevTools AI 测试移除、新 AI Service 测试通过、构建可产出。

- [ ] **Step 5: 运行文档和工作区检查**

Run: `git diff --check && rg -n 'T[O]DO|T[B]D|implement[[:space:]]later|fill[[:space:]]in[[:space:]]details' docs/superpowers/plans/2026-08-17-ai-service.md`

Expected: `git diff --check` 无输出；计划没有占位语句。检查 `git status --short`，仅报告本任务文件与已有用户改动，绝不自动暂存或提交。
