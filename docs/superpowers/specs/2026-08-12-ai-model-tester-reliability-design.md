# AI 模型测试可靠性修复设计

## 目标

修复 AI 模型测试中的三个实际问题，同时保留现有产品概念和功能边界：

1. 模板变量包含特殊字符时不能破坏 JavaScript 模板执行。
2. 请求成功但历史配置保存失败时，不得覆盖或污染请求结果。
3. 后端读取 AI 响应时限制最大响应体大小，避免异常响应造成过量内存占用。

## 明确保留的设计

- 保留用户可编辑 JavaScript 请求模板和提取器。
- 保留任意 HTTP(S) URL 请求能力，包括本机和局域网地址。
- 保留当前历史配置身份规则和最多 20 条记录的行为。
- 不拆分 `AiModelTester` 为多个业务层，不新增 service、repository、DTO 或 factory。
- 不引入数据库迁移体系。

## 方案

### 1. 模板变量编码

现有模板使用带引号的占位符，例如：

```ts
url: "{{baseUrl}}/v1/chat/completions"
```

替换变量时不能直接插入原始用户输入。实现增加一个局部编码函数，将变量中的反斜杠、双引号、换行和回车编码为 JavaScript 字符串内容，再替换占位符。

编码函数只负责当前模板格式，不改变模板语法，也不改变用户已有模板。四个变量统一经过编码：

- `baseUrl`
- `apiKey`
- `model`
- `imageData`

请求模板本身仍然通过现有 `Function` 执行；本次只修复变量注入边界，不改变脚本执行设计。

测试覆盖：

- API Key 含双引号。
- API Key 含反斜杠。
- API Key 含换行。
- Model 或 Base URL 含特殊字符。
- 图片 Data URL 仍能正确进入请求体。

### 2. 请求结果与历史保存解耦

`send` 流程分成两个阶段：

```text
请求阶段
  -> 解析模板
  -> 发送 HTTP 请求
  -> 更新响应和提取结果

历史阶段
  -> 请求成功且满足当前保存条件时保存配置
  -> 刷新历史列表
```

请求阶段失败时，继续使用当前请求错误展示。

请求阶段成功后，先保留响应结果。历史阶段失败时只通过 toast 提示“请求成功但历史配置保存失败”，不得重新写入响应区错误状态，也不得清空响应。

历史初始化、加载和删除失败仍使用当前页面错误状态，因为这些操作本身没有请求响应需要保护。

测试覆盖：

- HTTP 请求失败显示请求错误。
- 请求成功且历史保存成功时正常刷新历史。
- 请求成功但历史保存失败时响应仍显示。
- 请求成功但历史刷新失败时响应仍显示。
- 历史阶段错误不出现在响应错误区域。

### 3. AI 响应体大小限制

Rust 后端在 `send_ai_http_request` 中设置固定上限：

```rust
const MAX_AI_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
```

响应读取流程：

1. 如果响应包含 `Content-Length` 且超过上限，直接返回网络错误。
2. 否则通过响应字节流分块读取。
3. 每次追加前检查累计大小。
4. 超过上限立即终止读取并返回明确错误。
5. 未超过上限时按 UTF-8 文本解析。
6. JSON 响应继续解析为 JSON，非 JSON 响应继续包装成字符串。

HTTP 状态码行为不变：404、500 等响应仍作为 `AiHttpResponse` 返回，只要响应体没有超过大小限制。

Rust 测试覆盖：

- 小于上限的 JSON 响应正常返回。
- 小于上限的纯文本响应正常返回。
- 已知 `Content-Length` 超限时拒绝。
- 分块读取累计超限时拒绝。
- 非 2xx 状态仍保留状态码和响应体。

## 文件范围

修改：

- `shell-frontend/src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester.tsx`
- `shell-frontend/tests/dev-tools/tabs/ai-model-tester/AiModelTester.test.tsx`
- `shell-native/src/commands/ai.rs`
- `apps/builtin/dev-tools.yaml`

版本从 `0.3.1` 升至 `0.3.2`，因为本次修改会改变用户可见错误行为和响应处理行为。

不新增文件，不修改其他未相关的工作区改动。

## 验证

```bash
cd shell-frontend
npm run lint
npm test
npm run build

cd ../shell-native
cargo test
```

另外执行：

```bash
git diff --check
```

## 风险与取舍

- 10MB 是固定上限，超过上限的调试响应将无法展示；这是有意限制，避免无限制读取外部响应。
- 模板仍然是 JavaScript 执行模型，本次不改变其权限或语法，只修复变量编码问题。
- 历史配置仍然是当前设计，不借本次修复引入新的身份模型或迁移。
