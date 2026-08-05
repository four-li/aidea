# DevTools 内置子应用设计文档

- 文档日期：2026-08-02
- 最后更新：2026-08-03（DevTools 结构规范整理）
- 状态：v0.3 已实现，后续按 tab 增量扩展
- 作者：用户 + TRAE 协作
- 关联文档：[aIdea 壳应用设计](2026-07-30-aidea-shell-design.md)、[AGENTS.md](../../../AGENTS.md)

> **当前实现摘要**：DevTools 采用一个内置应用 + 多个 tab 的结构。当前包含数据格式化、时间戳转换、IP 查询、AI 模型测试四个工具；数据格式化支持 JSON/XML/YAML、格式化/压缩、Unicode 反转义和 CodeMirror 语法高亮；网络查询只展示 IPv4 多源结果；AI 模型测试包含请求测试和本地配置管理。后续新增小工具继续作为 tab，不拆分为多个顶层内置应用。

---

## 1. 背景与目标

### 1.1 背景

aIdea 壳应用 Phase 1-3 已完成（壳骨架 + Manifest 系统 + 进程管理）。`apps/dev-tools.yaml` 注册的 builtin 子应用当前只有占位页（[shell-frontend/src/builtin-apps/dev-tools/index.tsx](../../../shell-frontend/src/builtin-apps/dev-tools/index.tsx)），需要落地真实内容。

### 1.2 目标

DevTools 作为一个内置开发工具箱，内部通过 tab 承载小工具：

1. **数据格式化**：JSON/XML/YAML 输入输出转换，格式化、压缩、Unicode 反转义和语法高亮
2. **时间戳转换**：Unix 时间戳 ↔ 日期字符串双向转换
3. **IP 查询**：多数据源 IPv4 查询和结果对比，内网 IP 放在底部展示
4. **AI 模型测试**：HTTP 请求测试和本地 AI 配置管理

后续开发工具继续新增为 tab。只有当某个工具需要独立应用生命周期、独立导航入口或独立进程时，才重新讨论是否拆成顶层内置应用。

### 1.3 非目标（YAGNI）

- ❌ JSON 树形可折叠视图（首批用纯文本输出）
- ❌ JSON 缩进选择器（固定 2 空格）
- ❌ JSON 路径显示（如 `$.user.name`）
- ❌ 时间戳时区选择器（只显示本地 + UTC，不选时区）
- ❌ 相对时间显示（「3 天前」）
- ❌ 输入历史记录
- ❌ Base64 / URL / 颜色 tab（首批不做，后续按需加）
- ❌ 不引入任何新依赖（除 shadcn Textarea 原生组件外）

### 1.4 设计原则

- **严格遵循 AGENTS.md**：shadcn/ui 组件体系、lucide-react 图标、sonner toast、HSL CSS 变量主题、禁止 `any`、禁止手写弹层
- **外科手术式修改**：只替换 `builtin-apps/dev-tools/` 内容，不碰壳其他部分
- **纯函数优先**：解析/格式化逻辑拆成纯函数，便于单测

---

## 2. 整体布局

### 2.1 页面结构

```
┌──────────────────────────────────────────────────────────────┐
│  [JSON 格式化]  [时间戳转换]                                  │ ← shadcn Tabs（顶部）
├──────────────────────────────────────────────────────────────┤
│  输入区                       │  输出区                       │
│  ┌──────────────────────┐     │  ┌──────────────────────┐    │
│  │  Textarea            │     │  │  Textarea (只读)      │    │
│  │  font-mono           │     │  │  font-mono           │    │
│  │  自适应高度           │     │  │  自适应高度           │    │
│  └──────────────────────┘     │  └──────────────────────┘    │
│  [清空] [粘贴]                  │  [复制]  <状态提示>           │
└──────────────────────────────────────────────────────────────┘
   50% / 50% 等宽分栏（grid grid-cols-2 gap-4，外层 px-6 py-4）
```

### 2.2 挂载点

- **修改**：[shell-frontend/src/builtin-apps/dev-tools/index.tsx](../../../shell-frontend/src/builtin-apps/dev-tools/index.tsx)（替换占位内容）
- **不改**：[shell-frontend/src/components/BuiltinPage.tsx](../../../shell-frontend/src/components/BuiltinPage.tsx) 已通过 `app.id === 'dev-tools'` 渲染 `DevToolsPage`，挂载逻辑就绪

### 2.3 尺寸与样式

- 外层容器：`flex-1 flex flex-col bg-background`（占满 ContentArea）
- Tabs 区：`border-b border-border px-6 pt-4`（顶部固定，不滚动）
- 内容区：`flex-1 grid grid-cols-2 gap-4 px-6 py-4 overflow-hidden`
- Textarea：`min-h-[400px]` + `resize-y`（允许垂直拖拽调整高度）+ `font-mono text-sm`
- 跟随系统深/浅主题（已通过 CSS 变量自动适配，无需额外代码）

---

## 3. JSON 格式化 tab

### 3.1 交互流程

1. 用户在左栏 Textarea 输入 JSON
2. 输入变化后 **debounce 200ms**（避免每次按键都 parse）
3. 合法 JSON → 右栏 Textarea 显示 `JSON.stringify(parsed, null, 2)`（2 空格缩进）
4. 非法 JSON → 右栏顶部红色 inline banner 显示错误信息
5. 空输入 → 右栏显示 muted-foreground 占位「在左侧输入 JSON…」

### 3.2 错误反馈

- **位置**：右栏顶部 inline banner（`bg-destructive/10 text-destructive text-xs px-3 py-2 rounded-md`）
- **内容**：`SyntaxError` 的 message。若 V8 引擎返回行列号则一并显示（「第 X 行第 Y 列」）
- **不弹 toast**：实时校验场景下 toast 会刷屏，违反 AGENTS.md「操作反馈」本意

### 3.3 操作按钮

| 按钮 | 行为 | shadcn 用法 |
|---|---|---|
| 清空 | 清空左栏输入（右栏随之清空） | `<Button variant="ghost" size="sm">` + `Trash2` 图标 |
| 粘贴 | `navigator.clipboard.readText()` → 写入左栏 | `<Button variant="ghost" size="sm">` + `ClipboardPaste` 图标 |
| 复制 | 复制右栏内容到剪贴板 | `<Button variant="ghost" size="sm">` + `Copy` 图标 |

- 复制成功 → `toast.success('已复制')`
- 复制失败 / 粘贴失败（无剪贴板权限）→ `toast.error(...)`
- 按钮用 shadcn Tooltip 包裹说明用途（delayDuration 400ms）

### 3.4 边界处理

- 空输入：右栏占位提示，不报错
- 超长输入（> 100KB）：仍尝试 parse，靠 debounce 控制频率，不做硬截断（YAGNI）
- 顶层非对象/数组（如 `"hello"`、`123`）：合法 JSON，正常格式化显示

---

## 4. 时间戳转换 tab

### 4.1 布局

左右等宽分栏，**两边都是「输入 + 派生展示」**，避免双向回填导致循环更新：

```
┌────────────────────────────┬────────────────────────────┐
│  时间戳                    │  日期字符串                  │
│  ┌────────────────────┐    │  ┌────────────────────┐    │
│  │  Input (数字)      │    │  │  Input             │    │
│  └────────────────────┘    │  └────────────────────┘    │
│  <按毫秒解析 / 按秒解析>    │  格式：YYYY-MM-DD HH:mm:ss  │
│                            │                            │
│  派生结果：                 │  派生结果：                 │
│  本地：2023-10-31 08:37:12 │  秒  ：1698712632          │
│  UTC ：2023-10-31 00:37:12│  毫秒：1698712632000        │
│  [复制本地] [复制UTC]       │  [复制秒] [复制毫秒]         │
└────────────────────────────┴────────────────────────────┘
```

### 4.2 双向实时逻辑（无循环更新）

**核心设计**：两边 Input 的值各自独立 state，**互不回填**。任一边输入 → 只更新自己下方「派生结果」展示区。

- 左栏输入时间戳 → 左栏下方派生显示「本地日期 / UTC 日期」（只读展示，不写入右栏 Input）
- 右栏输入日期 → 右栏下方派生显示「秒时间戳 / 毫秒时间戳」（只读展示，不写入左栏 Input）
- 用户可同时操作两边，互不干扰

**优点**：
- 无 setInput 互相回填 → 无循环更新风险
- 双向都能用 → 满足「双向实时」需求
- 派生结果只读 → 不会因派生显示导致输入框值跳变

### 4.3 时间戳单位识别

- **自动识别**：输入长度 ≥ 13 → 毫秒；长度 10-12 → 秒；< 10 → 错误
- 左栏 Input 下方显示 muted-foreground 提示当前判定：「按毫秒解析」/「按秒解析」
- 11/12 位边界歧义：实际几乎不出现，用户可手动加减位数修正，不引入手动单位选择器（YAGNI）

### 4.4 日期字符串格式

- **期望格式**：`YYYY-MM-DD HH:mm:ss`（本地时区解析）
- **也接受**：`YYYY-MM-DDTHH:mm:ss`、`YYYY-MM-DD`（仅日期）
- 用 `new Date(str)` 解析失败 → 右栏下方 inline 红字提示「日期格式无效，应为 YYYY-MM-DD HH:mm:ss」
- 不做格式宽松化（不尝试多种分隔符，YAGNI）

### 4.5 错误反馈

| 场景 | 反馈方式 | 位置 |
|---|---|---|
| 时间戳位数 < 10 | inline 红字 | 左栏 Input 下方 |
| 时间戳含非数字 | inline 红字 | 左栏 Input 下方 |
| 日期字符串无法解析 | inline 红字 | 右栏 Input 下方 |
| 复制成功 | `toast.success('已复制')` | 全局 |
| 复制失败 | `toast.error(...)` | 全局 |

### 4.6 操作按钮

- 左栏：`[复制本地]` `[复制UTC]`（分别复制派生的本地/UTC 日期字符串）
- 右栏：`[复制秒]` `[复制毫秒]`（分别复制派生的秒/毫秒时间戳）
- 全部用 `<Button variant="ghost" size="sm">`

---

## 5. 状态管理

### 5.1 DevToolsPage 顶层 state

```typescript
const [activeTab, setActiveTab] = useState<'json' | 'timestamp'>('json');
const [jsonInput, setJsonInput] = useState('');      // JSON tab 左栏
const [tsInput, setTsInput] = useState('');          // 时间戳 tab 左栏
const [dateInput, setDateInput] = useState('');     // 时间戳 tab 右栏
```

- 切换 tab 时 input state 保留（不丢输入）
- 派生值用 `useMemo` 计算，不存 state（避免不一致）

### 5.2 派生计算

```typescript
// JSON tab
const jsonResult = useMemo(() => parseJsonInput(jsonInput), [jsonInput]);
// 返回 { ok: true, output: string } | { ok: false, error: string }

// 时间戳 tab
const tsResult = useMemo(() => parseTimestamp(tsInput), [tsInput]);
// 返回 { ok: true, unit: 'ms'|'s', local: string, utc: string } | { ok: false, error: string }

const dateResult = useMemo(() => parseDate(dateInput), [dateInput]);
// 返回 { ok: true, seconds: number, milliseconds: number } | { ok: false, error: string }
```

---

## 6. 代码组织

```
shell-frontend/src/builtin-apps/dev-tools/
├── index.tsx               # 入口，导出 DevToolsPage（含 Tabs + 顶层 state）
├── JsonFormatter.tsx       # JSON tab 组件（接收 jsonInput + onChange + jsonResult）
├── TimestampConverter.tsx  # 时间戳 tab 组件（接收 tsInput/dateInput + 双向 onChange + 派生结果）
└── format-utils.ts         # 纯函数：parseJsonInput / parseTimestamp / parseDate
```

**拆分理由**：
- `format-utils.ts` 是纯函数（无 React 依赖），拆出便于单测
- `JsonFormatter` / `TimestampConverter` 各自独立，互不影响，便于组件测试
- `index.tsx` 只做组合和 state 提升，逻辑薄

---

## 7. 组件依赖

### 7.1 已有组件

| 组件 | 路径 |
|---|---|
| shadcn Tabs | [components/ui/tabs.tsx](../../../shell-frontend/src/components/ui/tabs.tsx) |
| shadcn Button | [components/ui/button.tsx](../../../shell-frontend/src/components/ui/button.tsx) |
| shadcn Input | [components/ui/input.tsx](../../../shell-frontend/src/components/ui/input.tsx) |
| shadcn Tooltip | [components/ui/tooltip.tsx](../../../shell-frontend/src/components/ui/tooltip.tsx) |
| sonner toast | [components/ui/sonner.tsx](../../../shell-frontend/src/components/ui/sonner.tsx) |

### 7.2 需新增组件

**shadcn Textarea**：

- shadcn Textarea 不依赖 Radix（就是原生 `<textarea>` + `cn()`），无需装 npm 包
- 从 [shadcn/ui 官网 Textarea](https://ui.shadcn.com/docs/components/textarea) 复制代码到 `shell-frontend/src/components/ui/textarea.tsx`
- 改 import 路径为 `../../lib/utils`（AGENTS.md 要求，不用 `@/`）
- 在 AGENTS.md 的 shadcn 组件清单登记

### 7.3 图标

全部从 `lucide-react` 导入：`Copy`、`Trash2`、`ClipboardPaste`。

---

## 8. 测试策略

### 8.1 单元测试（vitest）

测试 `format-utils.ts` 的纯函数：

**parseJsonInput**：
- 合法 JSON 对象 → 格式化输出
- 合法 JSON 数组 → 格式化输出
- 合法 JSON 顶层原始值（`"hello"`、`123`、`true`）→ 格式化输出
- 非法 JSON → 返回错误信息
- 空输入 → 返回空结果（不报错）

**parseTimestamp**：
- 13 位时间戳 → 毫秒解析
- 10 位时间戳 → 秒解析
- < 10 位 → 错误
- 含非数字字符 → 错误
- 边界：11/12 位（按秒解析，可接受）

**parseDate**：
- 合法 `YYYY-MM-DD HH:mm:ss` → 返回秒+毫秒
- 合法 `YYYY-MM-DD` → 返回当天 00:00 的时间戳
- 非法字符串 → 返回错误

### 8.2 组件测试（@testing-library/react）

- 输入合法 JSON → 输出区显示格式化结果
- 输入非法 JSON → 显示错误 banner
- 切换 tab → 输入状态保留（切走再切回，输入还在）
- 时间戳输入 → 派生显示更新

### 8.3 不测的

- 复制/粘贴（依赖剪贴板 API，手动验证）
- 视觉样式（靠运行时肉眼检查）

### 8.4 验证命令

按 AGENTS.md 约定：
- `npm run lint` — ESLint 检查
- `npm test` — vitest 单测
- `npm run build` — tsc + vite 构建（验证类型与产物）

---

## 9. 风险与未决项

### 9.1 已知风险

1. **JSON 错误行列号**：V8 的 `SyntaxError` 不一定带行列号信息。若拿不到行列号，banner 只显示 message（如 `Unexpected token } in JSON at position 42`）。可接受，不额外解析。
2. **时间戳自动识别边界**：11/12 位时间戳会被识别为秒，理论上可能是毫秒的前几位截断。实际几乎不出现，不引入手动选择器。
3. **Date 解析时区**：`new Date('2023-10-31 08:37:12')` 在 V8 中按本地时区解析。若用户期望 UTC，需显式带 `Z` 或 `+00:00`。设计上只显示本地+UTC 两个结果，用户可自行判断。

### 9.2 未决项

无。所有关键决策已在设计稿确认。

---

## 10. 已确认的关键决策汇总

| # | 决策点 | 决定 |
|---|---|---|
| 1 | 首批 tab 范围 | JSON 格式化 + 时间戳转换 |
| 2 | JSON 触发方式 | 实时格式化（debounce 200ms），对标 json.cn |
| 3 | JSON 输出形式 | 纯格式化文本（不做树形视图） |
| 4 | JSON 缩进 | 固定 2 空格（不引入选择器） |
| 5 | JSON 错误反馈 | inline banner（不用 toast，避免刷屏） |
| 6 | 时间戳方向 | 双向实时 |
| 7 | 双向实时实现 | 两边独立 state + 各自派生展示，不互相回填（避免循环） |
| 8 | 时间戳单位 | 自动识别（13位→毫秒，10-12位→秒） |
| 9 | 日期格式 | `YYYY-MM-DD HH:mm:ss` 本地时区 |
| 10 | 复制/粘贴反馈 | toast.success / toast.error |
| 11 | 组件体系 | 严格 shadcn/ui，禁手搓 |
| 12 | Tab 状态保留 | 顶层 state，切 tab 不丢输入 |
| 13 | 测试范围 | 纯函数单测 + 关键交互组件测试 |

---

## 11. 后续计划

本设计稿确认后，由 writing-plans skill 产出详细实现计划（分 Task、逐步骤），再进入实现阶段。

---

## 12. v0.2 升级：CodeMirror + Tauri 剪贴板

### 12.1 升级动机

v0.1 实现后实测发现 4 个体验问题：

| # | 现象 | 根因 | 性质 |
|---|---|---|---|
| 1 | 无语法高亮 | 用 shadcn Textarea（纯文本） | 真差距，json.cn 用 CodeMirror |
| 2 | 错误提示不够精确 | 红色 banner 只显示 message，无行列号 | 体验差距 |
| 3 | 英文引号自动变中文 | macOS 系统级智能引号 | 环境问题，需代码拦截 |
| 4 | 粘贴提示无剪贴板权限 | Tauri 2 默认拒剪贴板特权，未配 capabilities | Tauri 配置缺失 |

### 12.2 升级方案

#### A. CodeMirror 6 替换 Textarea（输入区 + 输出区）

**新增依赖**（前端）：
- `@uiw/react-codemirror` — React 封装（管 EditorView/State 生命周期）
- `@codemirror/lang-json` — JSON 语法高亮 + `jsonParseLinter()`
- `@codemirror/view` — `EditorView.domEventHandlers` 拦截智能引号
- `@codemirror/state` — `Compartment` 热切换 theme
- `@codemirror/lint` — 错误提示框架（已随 lang-json 间接依赖，显式列出便于 import）

预计 bundle +150KB（gzip +50KB）。

**JsonFormatter 改造**：
- 输入区：Textarea → `<CodeMirror>`，配 `json()` 语言 + `jsonParseLinter()` + `lintGutter()`
- 输出区：Textarea → `<CodeMirror>`（`editable={false}`，只读高亮）
- 删掉手写的 debounce（CodeMirror 内置更新流，onChange 直接触发即可）

#### B. 错误位置精确提示

- 编辑器内：错误位置画**红色波浪下划线**（CodeMirror linter 默认行为）
- 行号区：错误行显示红点（`lintGutter()`）
- 底部状态栏：显示「错误：第 X 行第 Y 列 - {message}」
  - 通过 `lintGutter` 的 diagnostics 累计，从 `view.state.field(lintState)` 取最新一条
  - 或监听 `updateListener`，每次更新取 diagnostics

合法 JSON 时底部状态栏显示「✓ JSON 格式正确（X 个键，Y 行）」。

#### C. 智能引号拦截

CodeMirror 本身不启用智能引号，但 macOS 系统级替换仍可能通过 `insertText` input event 生效。用 `EditorView.domEventHandlers` 监听 `beforeinput` 事件：

```typescript
const smartQuoteHandler = EditorView.domEventHandlers({
  beforeinput(event: InputEvent) {
    if (event.inputType === 'insertText' || event.inputType === 'insertFromPaste') {
      const text = event.data;
      if (text && /[\u201c\u201d\u2018\u2019]/.test(text)) {
        event.preventDefault();
        const fixed = text
          .replace(/[\u201c\u201d]/g, '"')
          .replace(/[\u2018\u2019]/g, "'");
        // 通过 view.dispatch 插入修正后的文本
        return true; // 表示已处理
      }
    }
    return false;
  }
});
```

时间戳 tab 的 Input 不受影响（单行 input 浏览器不启用智能替换）。

#### D. Tauri 剪贴板 plugin

**Rust 端**：
- `shell-native/Cargo.toml` 加 `tauri-plugin-clipboard-manager = "2"`
- `shell-native/src/lib.rs` 加 `.plugin(tauri_plugin_clipboard_manager::init())`

**capabilities**：
- 新建 `shell-native/capabilities/default.json`：
```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "aIdea 默认权限",
  "windows": ["main"],
  "permissions": [
    "clipboard-manager:allow-read-text",
    "clipboard-manager:allow-write-text"
  ]
}
```

**前端封装**（新建 `shell-frontend/src/lib/clipboard.ts`）：
```typescript
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager';

export async function copyToClipboard(text: string): Promise<void> {
  await writeText(text);
}

export async function readFromClipboard(): Promise<string> {
  return await readText();
}
```

JsonFormatter / TimestampConverter 的复制/粘贴按钮改用此封装。

### 12.3 自定义主题跟随 shadcn

新建 `shell-frontend/src/builtin-apps/dev-tools/codemirror-theme.ts`，用 `EditorView.theme()` 定义高亮颜色，读取 shadcn CSS 变量：

```typescript
import { EditorView } from '@codemirror/view';

// 深色主题：背景跟随 shadcn --background（hsl(0 0% 10%)）
export const ideaDarkTheme = EditorView.theme({
  '&': {
    backgroundColor: 'hsl(0 0% 10%)',
    color: 'hsl(0 0% 87.8%)',
  },
  '.cm-gutters': {
    backgroundColor: 'hsl(0 0% 10%)',
    color: 'hsl(0 0% 53.7%)',
    border: 'none',
  },
  // ...其他 token 颜色
});

// 浅色主题
export const ideaLightTheme = EditorView.theme({
  '&': {
    backgroundColor: 'hsl(0 0% 100%)',
    color: 'hsl(222 47% 11%)',
  },
  // ...
});
```

用 `Compartment` 在 useTheme mode 变化时热切换 theme，无需重建 EditorView。

### 12.4 测试调整

现有 6 个 JsonFormatter 测试用 `screen.getByPlaceholderText` / `getByLabelText('JSON 输出')` 等 query，CodeMirror 用 contenteditable 不带 placeholder 也不带 label aria。需调整：

| 旧测试 | 新测试 |
|---|---|
| `getByPlaceholderText` | 改用 CodeMirror 的 `view.dispatch` 模拟输入，断言输出区 `view.state.doc.toString()` |
| `getByLabelText('JSON 输出')` | 改用 `getByRole('textbox')`（CodeMirror 的 contenteditable 是 role=textbox） |
| `getByText('错误：...')` | 保留（底部状态栏错误提示） |
| 复制按钮测试 | 保留，但 mock `lib/clipboard.ts` |

新增测试：
- 输入含中文引号的 JSON → 应被转成英文引号后解析
- 切换深/浅主题 → CodeMirror theme 切换（验证 DOM class 变化或 background-color）
- 错误位置精确：输入 `{invalid}` → 底部状态栏显示行号列号

### 12.5 v0.2 不做的事（YAGNI）

- ❌ 不引入 json.cn 的「压缩」「转义」「路径复制」等额外功能
- ❌ 不做 CodeMirror 的代码折叠（lang-json 默认支持但首版不启用，YAGNI）
- ❌ 不做 CodeMirror 的搜索（Cmd+F，YAGNI）
- ❌ 不重构时间戳 tab 的布局（仅复制按钮改 clipboard 封装）

### 12.6 风险

1. **CodeMirror 主题与 shadcn 视觉不完全一致**：CodeMirror 的 token 颜色（key/string/number/bool）需要手工配色，可能与 shadcn 调色板有偏差。首版用合理的默认色（key 蓝、string 绿、number 紫），后续按实际效果微调。
2. **智能引号拦截在 paste 大段含中文引号 JSON 时可能误伤**：JSON 字符串值里合法包含中文引号（`"name":"你好"世界""`）。拦截逻辑只转 input event 的字符，不影响已存在于编辑器的内容。但 paste 一段含中文引号的合法 JSON 字符串值时会被强行转成英文引号，破坏原意。**接受此风险**（JSON 字符串值里中文引号极少见，且 json.cn 也有类似问题）。
3. **capabilities 路径**：Tauri 2 默认在 `src-tauri/capabilities/`，本项目是 `shell-native/`，需通过 `tauri.conf.json` 的 `app.security.capabilities` 显式指定，或放 `shell-native/capabilities/`（实测可行）。

### 12.7 v0.2 关键决策汇总

| # | 决策点 | 决定 |
|---|---|---|
| 14 | JSON 输入区 | CodeMirror 6 + json() + jsonParseLinter |
| 15 | JSON 输出区 | CodeMirror 6 只读模式（语法高亮） |
| 16 | 错误提示 | 行内红色波浪线 + 行号红点 + 底部状态栏显示行列 |
| 17 | 智能引号 | beforeinput 事件拦截，中文引号转英文 |
| 18 | 剪贴板 | Tauri plugin + capabilities 授权 |
| 19 | 主题 | 自定义 EditorView.theme 跟 shadcn CSS 变量，Compartment 热切换 |
| 20 | 时间戳 tab | 仅复制按钮改 clipboard 封装，布局不动 |

---

## 13. v0.3 升级：多格式工具 + 按钮触发 + Unicode 反转义

### 13.1 升级动机

v0.2 实测后用户提出 5 个改进：

| # | 需求 | 说明 |
|---|---|---|
| 1 | 去掉粘贴功能 | 删除「粘贴」按钮，保留「复制」 |
| 2 | 默认高度占满页面 | CodeMirror 没撑满父容器 |
| 3 | 增加格式化按钮和压缩按钮 | 取消自动格式化，改为按钮触发：格式化（pretty）+ 压缩（minify） |
| 4 | 增加 Unicode 反转义勾选 | 勾选后把 `\uXXXX` 解码成中文（如 `\u4f60\u597d` → `你好`） |
| 5 | 增加 XML/YAML 支持 | 三个格式（JSON/XML/YAML）互转，两个下拉框选「输入格式」和「输出格式」 |

### 13.2 Tab 改名

- 「JSON 格式化」→「数据格式化」（支持 JSON/XML/YAML）
- 时间戳 tab 不变

### 13.3 整体布局

```
┌──────────────────────────────────────────────────────────────┐
│ [数据格式化]  [时间戳转换]                                     │ ← shadcn Tabs
├──────────────────────────────────────────────────────────────┤
│ 输入格式: [JSON ▼]   输出格式: [JSON ▼]   ☑ Unicode 反转义    │ ← 工具栏
├──────────────────────────────────────────────────────────────┤
│  输入                          │  输出                        │
│  ┌──────────────────────┐      │  ┌──────────────────────┐   │
│  │  CodeMirror           │      │  │  CodeMirror (只读)   │   │
│  │  (撑满高度)            │      │  │  (撑满高度)           │   │
│  └──────────────────────┘      │  └──────────────────────┘   │
│  [清空] [格式化] [压缩]         │  [复制]                     │
└──────────────────────────────────────────────────────────────┘
   50/50 分栏，整个工具栏 + 编辑器 + 按钮区在 flex-1 容器里撑满
```

**高度撑满关键**：
- DevToolsPage 根容器 `flex-1 flex flex-col h-full`
- JsonFormatter 根容器 `flex flex-col h-full`
- 工具栏 `flex-shrink-0`
- 编辑器区 `flex-1 min-h-0`（min-h-0 防 flex 溢出）
- CodeMirror 容器 `h-full` + CodeMirror 自身 `height="100%`

### 13.4 输入/输出格式选择

**两个 shadcn Select**：
- 输入格式：JSON / XML / YAML / 自动识别（默认）
- 输出格式：JSON / XML / YAML（默认跟输入一致，可手动覆盖）

**自动识别算法**（输入格式选「自动识别」时）：
- 首个非空白字符是 `{` 或 `[` → JSON
- 首个非空白字符是 `<` → XML
- 其他 → YAML

**输出格式默认值**：跟随识别/手选的输入格式，但用户手动改输出格式后保留用户选择。

### 13.5 按钮触发模式

取消 v0.2 的输入即自动格式化（debounce 200ms）。改为三个按钮：

| 按钮 | 行为 |
|---|---|
| 清空 | 清空输入区（输出区不变） |
| 格式化 | 按「输出格式」pretty print 输入，结果写入输出区 |
| 压缩 | 按「输出格式」minify 输入，结果写入输出区 |

**注意**：YAML 没有 minify 概念，点「压缩」按钮时：
- JSON → 一行紧凑输出
- XML → 一行紧凑输出（去空白）
- YAML → 转成 JSON 压缩输出（更实用），并在输出格式提示「YAML 无压缩，已转 JSON」

### 13.6 Unicode 反转义勾选

**shadcn Checkbox**：「Unicode 反转义」

- 不勾（默认）：输出原样
- 勾选：输出时把所有 `\uXXXX` 解码成对应字符（如 `\u4f60\u597d` → `你好`）

**实现**：用正则 `/(\\u[0-9a-fA-F]{4})/g` 匹配，`String.fromCharCode(parseInt(hex, 16))` 解码。

**作用范围**：所有格式都生效（JSON/XML/YAML 输出都做反转义）。

### 13.7 格式互转实现

**新增依赖**：
- `js-yaml` — YAML 解析+序列化
- `fast-xml-parser` — XML ↔ JSON 互转

**转换矩阵**（输入格式 × 输出格式）：

| 输入 \ 输出 | JSON | XML | YAML |
|---|---|---|---|
| JSON | 直接 stringify | `XMLBuilder.build()` | `js-yaml.dump()` |
| XML | `XMLParser.parse()` | 直接 stringify | XML→JSON→YAML（两步） |
| YAML | `js-yaml.load()` | YAML→JSON→XML（两步） | 直接 stringify |

**统一中间表示**：JavaScript Object（普通对象/数组）。

**纯函数拆分**：在 `format-utils.ts` 中新增：
- `parseInput(input: string, format: 'json'|'xml'|'yaml')`: 解析成 JS Object
- `formatOutput(obj: unknown, format: 'json'|'xml'|'yaml', minify: boolean, unescape: boolean)`: 序列化成字符串
- `transform(input, inFormat, outFormat, opts)`: 组合 parse + format

### 13.8 删除功能

- 删除「粘贴」按钮
- 删除 v0.2 的 `readFromClipboard` 调用（但 `lib/clipboard.ts` 保留，复制仍用）
- 删除 v0.2 的「自动格式化」useMemo + debounce 逻辑
- 删除 v0.2 的「底部状态栏 JSON 格式正确」提示（改为按钮触发，无输出时显示占位提示）

### 13.9 错误反馈

- 输入解析失败：输出区顶部红色 banner 显示「错误：{message}」
- 输出格式化失败：同上
- 复制成功/失败：toast
- CodeMirror 行内错误（仅 JSON 输入时）：保留 v0.2 的 jsonParseLinter

### 13.10 CodeMirror 语言高亮

**新增依赖**：
- `@codemirror/lang-xml` — XML 语法高亮
- `@codemirror/lang-yaml` — YAML 语法高亮

**动态切换 language**：
- 用 `Compartment` 在输入格式变化时热切换 CodeMirror 的 language extension
- 输出区同理，按输出格式切换 language

### 13.11 测试调整

- `format-utils.test.ts` 新增 parseInput / formatOutput / transform 的单测
- `JsonFormatter.test.tsx` 改名 `DataFormatter.test.tsx`，调整测试：
  - 删除「点击粘贴按钮」用例
  - 新增「点击格式化按钮」用例（JSON→JSON、JSON→XML、JSON→YAML 等）
  - 新增「点击压缩按钮」用例
  - 新增「勾选 Unicode 反转义」用例
  - 新增「输入格式自动识别」用例

### 13.12 v0.3 不做的事（YAGNI）

- ❌ 不做 JSON Path 提取（如 `$.user.name`）
- ❌ 不做历史记录
- ❌ 不做 Base64/URL 编码
- ❌ 不做 TOML/CSV/Properties 等其他格式
- ❌ 不做 XML 的 DTD/命名空间复杂处理（fast-xml-parser 默认配置即可）
- ❌ 不做 YAML anchor/alias 复杂处理（js-yaml 默认支持，不深究）

### 13.13 风险

1. **fast-xml-parser 的 XML ↔ JSON 转换不是 1:1 可逆**：XML 的属性 vs 子元素在 JSON 里区分不明确，往返转换可能有结构变化。接受此限制，输出可能不严格等价。
2. **YAML minify 转 JSON**：YAML 没有 minify 概念，点压缩按钮时转 JSON 输出。这是兼容处理，已在 13.5 标注。
3. **自动识别误判**：YAML 文档可能以 `{` 开头（flow style），会被误判为 JSON。这是已知边界，用户可手动覆盖输入格式。
4. **bundle 体积**：新增 js-yaml + fast-xml-parser + 2 个 CodeMirror lang 包，预计再 +200KB（gzip +60KB）。可接受。

### 13.14 v0.3 关键决策汇总

| # | 决策点 | 决定 |
|---|---|---|
| 21 | Tab 名 | 「JSON 格式化」→「数据格式化」 |
| 22 | 粘贴按钮 | 删除（保留复制） |
| 23 | 自动格式化 | 取消，改为按钮触发（格式化 + 压缩） |
| 24 | Unicode 反转义 | shadcn Checkbox，勾选后 \uXXXX → 中文 |
| 25 | 输入格式 | Select：JSON/XML/YAML/自动识别（默认） |
| 26 | 输出格式 | Select：JSON/XML/YAML（默认跟输入） |
| 27 | 互转实现 | js-yaml + fast-xml-parser，JS Object 为中间表示 |
| 28 | YAML 压缩 | 转 JSON 压缩输出 |
| 29 | 高度撑满 | DevToolsPage + JsonFormatter 改用 flex + min-h-0 + h-full 链式撑满 |
| 30 | 文件改名 | `JsonFormatter.tsx` → `DataFormatter.tsx`，`JsonFormatter.test.tsx` → `DataFormatter.test.tsx` |

