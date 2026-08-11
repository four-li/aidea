# AI 模型测试界面优化 Implementation Plan

> **历史实施记录**：本文件只记录当时实现，不是当前平台契约。当前规则以仓库根目录 `AGENTS.md` 和 `docs/guide/` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本仓库用户规则禁止默认使用子代理，也禁止主动 `git add/commit`。

**Goal:** 将 DevTools 的 AI 模型测试页改为左侧功能菜单、右侧共用连接配置和双栏内容区，并补齐模型列表同步、图片理解上传、提取结果展示。

**Architecture:** 继续在现有 `AiModelTester.tsx` 内做外科手术式修改，不新增后端命令，不拆新抽象。前端复用现有 `ipc.sendAiHttpRequest` 调 `/v1/models`，模板发送和历史配置保存沿用现有数据流。

**Tech Stack:** React 18、TypeScript、shadcn/ui、lucide-react、Vitest、Testing Library、Tauri IPC。

## Global Constraints

- 用中文回答；生成的 Markdown 文档和代码注释默认用中文。
- 不主动 `git add`、commit、push 或创建 PR。
- 只触碰必须修改的文件，不做相邻代码重构。
- 不新增后端命令；复用现有 `send_ai_http_request`。
- 不新增依赖；复用现有 shadcn/ui、lucide-react、sonner。
- TypeScript 禁止 `any`，保持 `strict`、`noUnusedLocals`、`noUnusedParameters` 通过。
- UI 同时适配浅色和深色主题，使用现有主题 token。
- 修改后运行闭环测试：`cd shell-frontend && npm run lint && npm test && npm run build`，再运行 `cd ../shell-native && cargo test`。

---

## File Structure

- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester.tsx`
  - 保留模板、请求发送、历史配置能力。
  - 将顶部二级 Tabs 改为组件内左侧菜单。
  - 将 Model 输入改为 Select，下拉内容来自模型列表同步。
  - 将图片理解上传控件改为请求模板上方的附件条。
  - 将发送按钮放进请求模板框内右下角。
  - 将响应结果和提取结果改成右侧固定上下布局。
- Modify: `shell-frontend/tests/dev-tools/tabs/ai-model-tester/AiModelTester.test.tsx`
  - 覆盖模型同步、模型选择、图片理解上传、提取结果展示。
- No change expected: `shell-native/src/commands/ai.rs`
  - 只用于闭环测试确认现有后端未被破坏。

---

### Task 1: 模型列表同步与 Model 下拉

**Files:**
- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester.tsx`
- Modify: `shell-frontend/tests/dev-tools/tabs/ai-model-tester/AiModelTester.test.tsx`

**Interfaces:**
- Consumes: `ipc.sendAiHttpRequest(request: AiHttpRequest): Promise<AiHttpResponse>`
- Produces: `modelOptions: string[]` component state; `syncModels(): Promise<void>` component handler

- [ ] **Step 1: 写失败测试：同步模型列表后可选择模型**

在 `AiModelTester.test.tsx` 新增测试：

```tsx
it('点击同步按钮后拉取模型列表并填充下拉', async () => {
  mockTestAiModel.mockResolvedValue({
    status: 200,
    elapsed_ms: 30,
    body: { data: [{ id: 'gpt-4o-mini' }, { id: 'gpt-4.1' }] },
  });

  render(<AiModelTester />);

  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'https://api.example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: '同步模型列表' }));

  await waitFor(() => {
    expect(mockTestAiModel).toHaveBeenCalledWith({
      url: 'https://api.example.com/v1/models',
      method: 'GET',
      headers: { Authorization: 'Bearer sk-test' },
    });
  });
  expect(await screen.findByText('gpt-4o-mini')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行单测确认失败**

Run:

```bash
cd shell-frontend && npm test -- AiModelTester.test.tsx
```

Expected: FAIL，因为还没有“同步模型列表”按钮和下拉选项。

- [ ] **Step 3: 最小实现模型同步**

在 `AiModelTester.tsx`：

- 从 `components/ui/select` 引入 `Select`、`SelectContent`、`SelectItem`、`SelectTrigger`、`SelectValue`。
- 从 `lucide-react` 引入 `RefreshCw`。
- 新增状态：

```tsx
const [modelOptions, setModelOptions] = useState<string[]>([]);
const [syncingModels, setSyncingModels] = useState(false);
```

- 新增解析函数，放在组件外，避免测试依赖 UI 细节：

```tsx
function extractModelIds(body: unknown): string[] {
  if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data)) {
    return [];
  }
  return body.data
    .map((item) =>
      item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'
        ? item.id
        : '',
    )
    .filter(Boolean);
}
```

- 新增同步函数：

```tsx
const syncModels = async () => {
  setSyncingModels(true);
  try {
    const baseUrl = config.base_url.replace(/\/$/, '');
    const result = await ipc.sendAiHttpRequest({
      url: `${baseUrl}/v1/models`,
      method: 'GET',
      headers: { Authorization: `Bearer ${config.api_key}` },
    });
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`HTTP ${result.status}`);
    }
    const ids = extractModelIds(result.body);
    setModelOptions(ids);
    if (!config.model && ids[0]) update('model', ids[0]);
  } catch (cause) {
    toast.error('模型列表拉取失败', {
      description: cause instanceof Error ? cause.message : String(cause),
    });
  } finally {
    setSyncingModels(false);
  }
};
```

- 将 Model `Input` 替换为 `Select`。当 `modelOptions` 为空时显示 placeholder“先同步模型列表”，并给 `SelectTrigger` 保留 `aria-label="Model"`。
- 从 `sonner` 引入 `toast`，用于模型同步和图片上传错误提示。
- 更新现有“左侧模板渲染请求后发送”测试：不再对 `Model` 做 `fireEvent.change`，改成先 mock `/v1/models` 返回 `gpt-test`，点击“同步模型列表”默认选中模型，再 mock chat 请求并点击“发送请求”。

- [ ] **Step 4: 运行单测确认通过**

Run:

```bash
cd shell-frontend && npm test -- AiModelTester.test.tsx
```

Expected: PASS。

---

### Task 2: 左侧功能菜单与 A 方案布局

**Files:**
- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester.tsx`
- Modify: `shell-frontend/tests/dev-tools/tabs/ai-model-tester/AiModelTester.test.tsx`

**Interfaces:**
- Consumes: `TesterTab`
- Produces: 左侧菜单按钮，`activeTab` 仍为 `TesterTab`

- [ ] **Step 1: 写失败测试：图片理解菜单名称存在，多模态文案消失**

```tsx
it('使用左侧功能菜单并将多模态改名为图片理解', () => {
  render(<AiModelTester />);

  expect(screen.getByRole('button', { name: '连通性' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '图片理解' })).toBeInTheDocument();
  expect(screen.queryByText('多模态')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 运行单测确认失败**

Run:

```bash
cd shell-frontend && npm test -- AiModelTester.test.tsx
```

Expected: FAIL，因为当前仍是 TabsTrigger 和“多模态”。

- [ ] **Step 3: 最小实现左侧菜单布局**

在 `AiModelTester.tsx`：

- 删除内层 `Tabs`、`TabsList`、`TabsTrigger`、`TabsContent` 用法，只保留 DevTools 顶层 Tabs。
- 新增菜单定义：

```tsx
const TESTER_TABS: { id: TesterTab; label: string }[] = [
  { id: 'connectivity', label: '连通性' },
  { id: 'usage', label: '查询用量' },
  { id: 'models', label: '模型列表' },
  { id: 'multimodal', label: '图片理解' },
];
```

- 根布局改成 `grid grid-cols-[10rem_minmax(0,1fr)]`。
- 左侧用原生 `button` 渲染菜单，当前项使用 `bg-primary text-primary-foreground`，非当前项使用 `text-muted-foreground hover:bg-muted`。
- 右侧顶部保留 App Key、Base URL、Model、历史配置。
- 右侧主体只渲染当前 `activeTab` 对应内容，不再 map 全量 TabsContent。

- [ ] **Step 4: 运行单测确认通过**

Run:

```bash
cd shell-frontend && npm test -- AiModelTester.test.tsx
```

Expected: PASS。

---

### Task 3: 发送按钮内置到请求模板框

**Files:**
- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester.tsx`
- Modify: `shell-frontend/tests/dev-tools/tabs/ai-model-tester/AiModelTester.test.tsx`

**Interfaces:**
- Consumes: `send()`, `running`
- Produces: 请求模板区域内的 `发送请求` 按钮

- [ ] **Step 1: 更新现有发送测试，不依赖标题栏按钮位置**

保留现有测试里的：

```tsx
fireEvent.click(screen.getByRole('button', { name: '发送请求' }));
```

新增断言确保按钮仍可用：

```tsx
expect(screen.getByRole('button', { name: '发送请求' })).toBeEnabled();
```

- [ ] **Step 2: 实现按钮移动**

在请求模板 `Textarea` 外层包一层 `relative flex min-h-0 flex-1`，按钮放到绝对定位右下角：

```tsx
<div className="relative flex min-h-0 flex-1">
  <Textarea className="min-h-0 flex-1 resize-none pb-14 font-mono text-xs leading-5" />
  <Button className="absolute bottom-3 right-3" size="sm" onClick={send} disabled={running}>
    {running ? <Loader2 className="animate-spin" /> : <Play />}
    发送请求
  </Button>
</div>
```

- [ ] **Step 3: 运行单测**

Run:

```bash
cd shell-frontend && npm test -- AiModelTester.test.tsx
```

Expected: PASS。

---

### Task 4: 图片理解附件条与发送保护

**Files:**
- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester.tsx`
- Modify: `shell-frontend/tests/dev-tools/tabs/ai-model-tester/AiModelTester.test.tsx`

**Interfaces:**
- Consumes: `imageData`, `imageName`, `chooseImage(file)`
- Produces: `canSend: boolean` 或内联条件 `activeTab !== 'multimodal' || Boolean(imageData)`

- [ ] **Step 1: 写失败测试：图片理解未上传时不能发送**

```tsx
it('图片理解未上传图片时不能发送请求', () => {
  render(<AiModelTester />);

  fireEvent.click(screen.getByRole('button', { name: '图片理解' }));

  expect(screen.getByRole('button', { name: '发送请求' })).toBeDisabled();
});
```

- [ ] **Step 2: 写失败测试：上传图片后可发送并替换 imageData**

```tsx
it('图片理解上传图片后发送请求会替换 imageData', async () => {
  mockTestAiModel
    .mockResolvedValueOnce({
      status: 200,
      elapsed_ms: 1,
      body: { data: [{ id: 'vision-test' }] },
    })
    .mockResolvedValueOnce({ status: 200, elapsed_ms: 1, body: {} });
  const file = new File(['image'], 'demo.png', { type: 'image/png' });

  render(<AiModelTester />);
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'https://api.example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: '同步模型列表' }));
  await screen.findByText('vision-test');
  fireEvent.click(screen.getByRole('button', { name: '图片理解' }));
  fireEvent.change(screen.getByLabelText('选择图片'), { target: { files: [file] } });

  await screen.findByText(/demo.png/);
  fireEvent.click(screen.getByRole('button', { name: '发送请求' }));

  await waitFor(() => expect(mockTestAiModel).toHaveBeenCalled());
});
```

- [ ] **Step 3: 实现附件条**

在图片理解 tab 的请求模板上方渲染：

- 未上传：`Label` + `Input type="file"`，`aria-label="选择图片"`。
- 已上传：文件名、删除按钮，删除按钮清空 `imageData` 和 `imageName`。
- 发送按钮 `disabled={running || (activeTab === 'multimodal' && !imageData)}`。

- [ ] **Step 4: 如测试环境缺 FileReader，补最小 mock**

在测试文件内按需添加：

```tsx
class MockFileReader {
  result: string | ArrayBuffer | null = 'data:image/png;base64,aW1hZ2U=';
  onload: (() => void) | null = null;
  readAsDataURL() {
    this.onload?.();
  }
}

vi.stubGlobal('FileReader', MockFileReader);
```

- [ ] **Step 5: 运行单测**

Run:

```bash
cd shell-frontend && npm test -- AiModelTester.test.tsx
```

Expected: PASS。

---

### Task 5: 右侧原始响应与提取结果上下布局

**Files:**
- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs/ai-model-tester/AiModelTester.tsx`
- Modify: `shell-frontend/tests/dev-tools/tabs/ai-model-tester/AiModelTester.test.tsx`

**Interfaces:**
- Consumes: `displayedResponse`, `displayedExtracted`, `error`
- Produces: 右侧响应区固定原始响应；有提取输出时显示“提取结果”

- [ ] **Step 1: 保留并扩展现有提取结果测试**

现有测试已断言：

```tsx
expect(screen.getByLabelText('提取结果')).toHaveValue('"OK"');
```

新增无提取输出时不显示：

```tsx
it('没有提取输出时不显示提取结果区域', async () => {
  mockTestAiModel.mockResolvedValue({ status: 200, elapsed_ms: 1, body: {} });

  render(<AiModelTester />);
  fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'sk-test' } });
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'https://api.example.com' },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送请求' }));

  await waitFor(() => expect(mockTestAiModel).toHaveBeenCalled());
  expect(screen.queryByLabelText('提取结果')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: 实现右侧上下布局**

将右栏改为：

```tsx
<div className="flex min-h-0 flex-col gap-2">
  <Label>响应结果...</Label>
  {error ? (
    <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive">{error}</div>
  ) : (
    <Textarea aria-label="原始响应" className="min-h-0 flex-1 resize-none font-mono text-xs leading-5" />
  )}
  {displayedExtracted && !error && (
    <>
      <Label>提取结果</Label>
      <Textarea aria-label="提取结果" className="h-32 resize-none font-mono text-xs leading-5" />
    </>
  )}
</div>
```

- [ ] **Step 3: 运行单测**

Run:

```bash
cd shell-frontend && npm test -- AiModelTester.test.tsx
```

Expected: PASS。

---

### Task 6: 收尾验证

**Files:**
- Modify: no new files expected

**Interfaces:**
- Consumes: Tasks 1-5 complete
- Produces: verified working change set

- [ ] **Step 1: 前端闭环测试**

Run:

```bash
cd shell-frontend && npm run lint && npm test && npm run build
```

Expected: all PASS。

- [ ] **Step 2: Rust 闭环测试**

Run:

```bash
cd shell-native && cargo test
```

Expected: all PASS。

- [ ] **Step 3: 检查工作区**

Run:

```bash
git status --short
git diff --stat
```

Expected: 只包含本次 spec、plan、AI 模型测试组件和对应测试改动；没有 `git add/commit`。
