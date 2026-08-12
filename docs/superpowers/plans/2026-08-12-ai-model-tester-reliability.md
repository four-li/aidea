# AI 模型测试可靠性修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 AI 模型测试的模板变量注入、请求结果错误隔离和响应体大小限制问题。

**Architecture:** 保留现有可编辑 JavaScript 模板、任意 HTTP(S) 请求和历史配置模型。只在现有前端页面和 Rust HTTP 命令中增加边界处理，并用现有测试文件覆盖行为，不新增业务层或抽象层。

**Tech Stack:** React 18、TypeScript、Vitest、Tauri 2、Rust、reqwest 0.12、tokio、serde_json。

## Global Constraints

- 保留用户可编辑 JavaScript 请求模板和提取器。
- 保留任意 HTTP(S) URL 请求能力，包括本机和局域网地址。
- 保留当前历史配置身份规则和最多 20 条记录的行为。
- 不拆分 `AiModelTester` 为多个业务层，不新增 service、repository、DTO 或 factory。
- 不引入数据库迁移体系。
- 不修改工作区中与本任务无关的已有改动。
- 不自动 `git add`、commit、push 或创建 PR。
- 用户可见行为变化后，将 `apps/builtin/dev-tools.yaml` 的版本从 `0.3.1` 升至 `0.3.2`。

---

## 文件映射

- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester.tsx`
  - 修复模板变量编码。
  - 将请求主流程和历史保存错误分开。
- Test: `shell-frontend/tests/dev-tools/tabs/ai-model-tester/AiModelTester.test.tsx`
  - 覆盖特殊字符、请求成功后历史失败和已有请求错误行为。
- Modify: `shell-native/src/commands/ai.rs`
  - 限制 HTTP 响应体大小。
  - 增加可测试的响应读取辅助逻辑和 Rust 单元测试。
- Modify: `apps/builtin/dev-tools.yaml`
  - 升级 DevTools 版本到 `0.3.2`。
- Existing design: `docs/superpowers/specs/2026-08-12-ai-model-tester-reliability-design.md`
  - 作为已确认设计依据，不在实现阶段扩展范围。

## Task 1: 修复模板变量编码

**Files:**
- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester.tsx:62-73`
- Test: `shell-frontend/tests/dev-tools/tabs/ai-model-tester/AiModelTester.test.tsx`

**Interfaces:**
- Produces: `renderTemplate(source: string, config: AiTestConfig, imageData: string): RequestTemplate` 继续保持原签名和返回结构。

- [ ] **Step 1: 为特殊字符写失败测试**

在 `AiModelTester.test.tsx` 增加一个行为测试，使用请求 mock 检查模板执行后的请求值：

```tsx
it('模板变量包含 JavaScript 特殊字符时仍能正确发送', async () => {
  mockTestAiModel.mockResolvedValue({ status: 200, elapsed_ms: 1, body: {} });

  render(<AiModelTester />);
  fireEvent.change(screen.getByLabelText('API Key'), {
    target: { value: 'key"with\\slash\nline' },
  });
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'https://api.example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送请求' }));

  await waitFor(() => expect(mockTestAiModel).toHaveBeenCalled());
  expect(mockTestAiModel).toHaveBeenCalledWith(
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: 'Bearer key"with\\slash\nline',
      }),
    }),
  );
});
```

- [ ] **Step 2: 运行目标测试确认当前实现失败**

运行：

```bash
cd shell-frontend
npm test -- AiModelTester
```

预期：新增测试失败，原因是原始字符串替换破坏生成的 JavaScript。

- [ ] **Step 3: 增加局部模板值编码函数**

在 `renderTemplate` 前增加最小辅助函数：

```ts
function encodeTemplateValue(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r');
}
```

在 `renderTemplate` 中只对注入值编码，模板结构保持不变：

```ts
const filled = source
  .replaceAll('{{baseUrl}}', encodeTemplateValue(config.base_url.replace(/\/$/, '')))
  .replaceAll('{{apiKey}}', encodeTemplateValue(config.api_key))
  .replaceAll('{{model}}', encodeTemplateValue(config.model))
  .replaceAll('{{imageData}}', encodeTemplateValue(imageData));
```

- [ ] **Step 4: 运行目标测试确认通过**

运行：

```bash
cd shell-frontend
npm test -- AiModelTester
```

预期：该测试文件全部通过。

## Task 2: 隔离请求结果与历史保存错误

**Files:**
- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester.tsx:127-182`
- Test: `shell-frontend/tests/dev-tools/tabs/ai-model-tester/AiModelTester.test.tsx`

**Interfaces:**
- Consumes: 现有 `ipc.sendAiHttpRequest`、`ipc.saveAiConfig`、`ipc.listAiConfigs`。
- Produces: `send` 在请求成功后始终保留响应；历史保存错误通过 toast 独立反馈。

- [ ] **Step 1: 为历史保存失败写失败测试**

增加测试，模拟 HTTP 成功、保存历史失败，确认响应仍显示且不会显示请求错误：

```tsx
it('请求成功但历史保存失败时仍保留响应', async () => {
  mockTestAiModel.mockResolvedValue({
    status: 200,
    elapsed_ms: 1,
    body: { ok: true },
  });
  mockSaveAiConfig.mockRejectedValue(new Error('database unavailable'));

  render(<AiModelTester />);
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'https://api.example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送请求' }));

  await waitFor(() => expect(screen.getByLabelText('原始响应')).toHaveValue('{\n  "ok": true\n}'));
  expect(screen.queryByRole('alert')).not.toHaveTextContent('database unavailable');
  expect(mockToastError).toHaveBeenCalledWith(
    '请求成功，但历史配置保存失败',
    expect.objectContaining({ description: 'database unavailable' }),
  );
});
```

- [ ] **Step 2: 运行目标测试确认当前实现失败**

运行：

```bash
cd shell-frontend
npm test -- AiModelTester
```

预期：当前实现将保存错误写入页面 `error`，新增断言失败。

- [ ] **Step 3: 拆分 `send` 的请求阶段和历史阶段**

保持请求阶段的 `try/catch/finally`，在设置响应和提取结果后结束请求错误边界。将保存与历史刷新放入单独的 `try/catch`：

```ts
const result = await ipc.sendAiHttpRequest(template.request);
setResponse(result);
setExtracted(template.extractor?.(result.body));

if (result.status >= 200 && result.status < 300 && config.api_key.trim() && config.base_url.trim()) {
  try {
    await ipc.saveAiConfig(config);
    await loadHistory();
  } catch (cause) {
    toast.error('请求成功，但历史配置保存失败', {
      description: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
```

请求阶段的 `catch` 继续设置页面 `error`，历史阶段不得调用 `setError`。

- [ ] **Step 4: 保留并验证请求失败行为**

确认现有请求失败测试仍然断言：

```tsx
expect(screen.getByRole('alert')).toHaveTextContent('network down');
```

如果现有测试没有覆盖具体错误展示，补一个最小请求失败测试，确保请求失败仍进入响应错误区域。

- [ ] **Step 5: 运行目标测试确认通过**

运行：

```bash
cd shell-frontend
npm test -- AiModelTester
```

预期：AI 模型测试全部通过，响应成功和历史失败的行为边界明确。

## Task 3: 限制 Rust AI 响应体大小

**Files:**
- Modify: `shell-native/src/commands/ai.rs:1-131`
- Test: `shell-native/src/commands/ai.rs` 内 `#[cfg(test)]` 模块

**Interfaces:**
- Consumes: `reqwest::Response` 的状态码、headers 和 byte stream。
- Produces: `send_ai_http_request` 继续返回 `AiHttpResponse`，超限时返回 `AppError::Network`。

- [ ] **Step 1: 定义限制和可测试读取函数**

在 `ai.rs` 顶部定义：

```rust
const MAX_AI_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
```

将响应读取逻辑集中到一个局部异步函数，接口固定为：

```rust
async fn read_ai_response_body(
    response: reqwest::Response,
    max_bytes: usize,
) -> AppResult<String>
```

函数要求：

1. 检查 `response.content_length()`。
2. 超过 `max_bytes` 立即返回 `AppError::Network("AI 响应超过 10MB 限制".to_string())`。
3. 使用 `response.bytes_stream()` 逐块读取。
4. 每块追加前检查 `body.len() + chunk.len()` 是否超过上限。
5. 读取完后使用 `String::from_utf8` 转换；非法 UTF-8 返回 `AppError::Network`。

- [ ] **Step 2: 为响应体读取写失败测试**

在 Rust 测试模块中增加异步测试，使用现有 Tokio 测试风格或 `#[tokio::test]`：

```rust
#[tokio::test]
async fn ai响应体超过限制时返回错误() {
    let response = reqwest::Response::from(
        http::Response::builder()
            .header("content-length", "4")
            .body(reqwest::Body::from("test"))
            .unwrap(),
    );

    let error = read_ai_response_body(response, 3).await.unwrap_err();
    assert!(error.to_string().contains("超过"));
}
```

当前 `reqwest 0.12` 已提供 `From<http::Response<T>> for reqwest::Response`，直接使用现有 `http` 类型构造测试响应，不增加依赖，也不启动测试服务器。

- [ ] **Step 3: 运行 Rust 目标测试确认失败**

运行：

```bash
cd shell-native
cargo test ai
```

预期：新增测试在读取函数尚未实现时无法通过。

- [ ] **Step 4: 替换 `response.text()`**

将 `send_ai_http_request` 中：

```rust
let text = response
    .text()
    .await
    .map_err(|e| AppError::Network(e.to_string()))?;
```

替换为：

```rust
let text = read_ai_response_body(response, MAX_AI_RESPONSE_BYTES).await?;
```

保留后续 JSON/纯文本解析和 HTTP 状态码返回逻辑不变。

- [ ] **Step 5: 增加正常响应和非 JSON响应测试**

至少覆盖：

```rust
assert_eq!(serde_json::from_str::<serde_json::Value>(...).unwrap(), ...);
assert_eq!(serde_json::Value::String(...), ...);
```

如果通过真实 HTTP 测试服务器覆盖，则同时断言：

- 小响应返回成功。
- 超过限制返回错误。
- 500 状态仍返回 `AiHttpResponse.status == 500`。

- [ ] **Step 6: 运行 Rust 目标测试确认通过**

运行：

```bash
cd shell-native
cargo test ai
```

预期：AI 命令相关测试全部通过。

## Task 4: 更新 DevTools 版本

**Files:**
- Modify: `apps/builtin/dev-tools.yaml:4`

- [ ] **Step 1: 将版本从 `0.3.1` 改为 `0.3.2`**

只修改：

```yaml
version: 0.3.2
```

不改 manifest 其他字段。

- [ ] **Step 2: 检查版本 diff**

运行：

```bash
git diff -- apps/builtin/dev-tools.yaml
```

预期：只包含版本号变化。

## Task 5: 完整验证

**Files:**
- Test: 前端和 Rust 现有测试套件

- [ ] **Step 1: 运行前端 lint**

```bash
cd shell-frontend
npm run lint
```

预期：退出码为 0。

- [ ] **Step 2: 运行前端完整测试**

```bash
npm test
```

预期：所有测试通过。允许记录仓库现有的 `act(...)` 和 CodeMirror 测试环境警告，但不得新增失败。

- [ ] **Step 3: 运行前端构建**

```bash
npm run build
```

预期：TypeScript 检查和 Vite 构建通过；允许保留既有 chunk 体积警告。

- [ ] **Step 4: 运行 Rust 完整测试**

```bash
cd ../shell-native
cargo test
```

如果沙箱内出现本地端口或进程相关的 `Operation not permitted`，使用已批准的沙箱外同一命令重跑，并记录实际结果。

- [ ] **Step 5: 检查 diff**

```bash
cd ..
git diff --check
git status --short
```

确认：

- 只包含本次任务的 AI 文件、版本文件和测试改动。
- 不覆盖或回滚其他已有工作区修改。
- 没有自动暂存、提交或推送。
