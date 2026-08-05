# 时间戳转换时区支持 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在时间戳转换工具中显示实时当前时间，并让用户可按完整 IANA 时区列表转换和解析日期。

**Architecture:** 在已有 `format-utils.ts` 扩展纯函数，传入 IANA 时区后格式化时间戳或将墙上日期转换成 Unix 时间戳。`TimestampConverter` 持有选择的时区与当前时间，每秒刷新显示，并继续由 DevTools 顶层持有两个输入值。

**Tech Stack:** React 18、TypeScript、Vitest、浏览器原生 `Date` 和 `Intl`、shadcn/ui Select。

## Global Constraints

- 不新增依赖、不保存时区选择。
- 时区列表使用 `Intl.supportedValuesOf('timeZone')`，默认值使用系统当前时区。
- 日期输入接受既有的 `YYYY-MM-DD HH:mm:ss`、`YYYY-MM-DDTHH:mm:ss` 和 `YYYY-MM-DD`。
- 所选时区同时影响当前时间、时间戳转日期和日期转时间戳。
- 仅修改与该功能直接相关的工具函数、组件和测试。

---

### Task 1: 时区感知的日期纯函数

**Files:**
- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs/data-formatter/format-utils.ts`
- Modify: `shell-frontend/tests/dev-tools/tabs/data-formatter/format-utils.test.ts`

**Interfaces:**
- Consumes: `parseTimestamp(input: string)` 和 `parseDate(input: string)` 的现有调用。
- Produces: `parseTimestamp(input: string, timeZone?: string): TimestampResult` 与 `parseDate(input: string, timeZone?: string): DateResult`；省略 `timeZone` 时保持系统当前时区语义。

- [ ] **Step 1: 写入失败测试**

```ts
it('按指定 IANA 时区格式化并解析日期', () => {
  const timestamp = parseTimestamp('1698712632000', 'America/New_York');
  expect(timestamp).toMatchObject({ ok: true, local: '2023-10-30 20:37:12' });

  const date = parseDate('2023-10-30 20:37:12', 'America/New_York');
  expect(date).toMatchObject({ ok: true, milliseconds: 1698712632000 });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/dev-tools/tabs/data-formatter/format-utils.test.ts`

Expected: FAIL，因函数尚不接受时区参数，或时区结果仍按系统时区计算。

- [ ] **Step 3: 实现最小纯函数改动**

```ts
export function parseTimestamp(input: string, timeZone?: string): TimestampResult {
  // 既有校验保持不变；使用 timeZone 格式化 local。
}

export function parseDate(input: string, timeZone?: string): DateResult {
  // 将输入拆为年月日时分秒，按 IANA 时区求出同一墙上时间的 UTC 毫秒。
}
```

保留 UTC 格式化逻辑与既有错误信息；日期输入无时区时仍解析为系统本地时间。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/dev-tools/tabs/data-formatter/format-utils.test.ts`

Expected: PASS，包含已有 JSON/XML/YAML 与时间转换测试。

### Task 2: 实时时间和时区选择界面

**Files:**
- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs/timestamp-converter/TimestampConverter.tsx`
- Modify: `shell-frontend/tests/dev-tools/tabs/timestamp-converter/TimestampConverter.test.tsx`

**Interfaces:**
- Consumes: `parseTimestamp(input, timeZone)` 与 `parseDate(input, timeZone)`。
- Produces: 带有可访问标签的时区 `Select`，以及每秒更新的当前时间、秒时间戳和毫秒时间戳展示。

- [ ] **Step 1: 写入失败测试**

```tsx
it('显示系统时区和当前秒、毫秒时间戳', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2023-10-31T00:37:12.345Z'));
  render(<TimestampConverter {...props} />);
  expect(screen.getByText('当前时间')).toBeInTheDocument();
  expect(screen.getByText('1698712632')).toBeInTheDocument();
  expect(screen.getByText('1698712632345')).toBeInTheDocument();
});
```

再增加选择 `America/New_York` 后，时间戳输入 `1698712632000` 显示 `2023-10-30 20:37:12` 的测试。

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/dev-tools/tabs/timestamp-converter/TimestampConverter.test.tsx`

Expected: FAIL，因当前页面没有实时区域或时区选择控件。

- [ ] **Step 3: 实现最小界面改动**

```tsx
const [timeZone, setTimeZone] = useState(
  Intl.DateTimeFormat().resolvedOptions().timeZone
);
const [now, setNow] = useState(() => Date.now());

useEffect(() => {
  const timer = window.setInterval(() => setNow(Date.now()), 1000);
  return () => window.clearInterval(timer);
}, []);
```

使用已有 shadcn `Select` 渲染 `Intl.supportedValuesOf('timeZone')`；向两个转换函数传入 `timeZone`。实时区域使用同一套时间戳格式化函数，保证展示语义一致。

- [ ] **Step 4: 运行组件测试确认通过**

Run: `npm test -- tests/dev-tools/tabs/timestamp-converter/TimestampConverter.test.tsx`

Expected: PASS，包含既有复制、错误提示和单位提示测试。

### Task 3: 完整验证

**Files:**
- Modify: 无。

**Interfaces:**
- Consumes: Task 1 与 Task 2 完整实现。
- Produces: lint、类型检查和生产构建验证结果。

- [ ] **Step 1: 运行 DevTools 测试**

Run: `npm test -- tests/dev-tools/tabs/data-formatter/format-utils.test.ts tests/dev-tools/tabs/timestamp-converter/TimestampConverter.test.tsx`

Expected: PASS。

- [ ] **Step 2: 运行 lint**

Run: `npm run lint`

Expected: exit code 0。

- [ ] **Step 3: 运行生产构建**

Run: `npm run build`

Expected: exit code 0。

### Task 4: 时区搜索与主次布局

**Files:**
- Modify: `shell-frontend/src/builtin-apps/dev-tools/tabs/timestamp-converter/TimestampConverter.tsx`
- Modify: `shell-frontend/tests/dev-tools/tabs/timestamp-converter/TimestampConverter.test.tsx`

**Interfaces:**
- Consumes: 已有 `timeZone` 状态和 `parseTimestamp(input, timeZone)`。
- Produces: 带搜索输入的时区 Popover；选择结果更新 `timeZone`，并使时间戳输入的日期结果按该时区重新计算。

- [ ] **Step 1: 写入失败测试**

```tsx
it('搜索并选择时区后，时间戳转换结果随之更新', () => {
  render(<TimestampConverter {...props} tsInput="1698712632000" />);
  fireEvent.click(screen.getByRole('button', { name: /选择时区/ }));
  fireEvent.change(screen.getByPlaceholderText('搜索时区'), {
    target: { value: 'new_york' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'America/New_York' }));
  expect(screen.getByText('2023-10-30 20:37:12')).toBeInTheDocument();
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- tests/dev-tools/tabs/timestamp-converter/TimestampConverter.test.tsx`

Expected: FAIL，因页面没有“选择时区”按钮和“搜索时区”输入框。

- [ ] **Step 3: 实现最小界面改动**

```tsx
const [timeZoneQuery, setTimeZoneQuery] = useState('');
const filteredTimeZones = timeZones.filter((zone) =>
  zone.toLowerCase().includes(timeZoneQuery.trim().toLowerCase())
);
```

使用已有 shadcn `Popover` 容纳搜索输入和滚动列表。主栏保留时间戳输入和结果，使用标题及较大输入框作为唯一高强调区域；实时信息缩减为标题旁的状态行，日期转时间戳改为次要栏。

- [ ] **Step 4: 运行组件测试确认通过**

Run: `npm test -- tests/dev-tools/tabs/timestamp-converter/TimestampConverter.test.tsx`

Expected: PASS，包含时区搜索、选择后的转换结果与既有复制测试。
