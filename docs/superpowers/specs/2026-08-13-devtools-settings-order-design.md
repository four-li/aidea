# DevTools 应用设置卡片排序设计

## 目标

将 DevTools 当前“每行一个复选框”的原生表单式设置，改为可拖拽排序的卡片列表：

- 每个工具显示为独立卡片。
- 卡片保留显示/隐藏开关。
- 通过拖拽手柄调整工具顺序。
- 顺序立即保存到 DevTools 自己的 `app.db`。
- DevTools 顶部工具 Tab 与设置页使用同一份顺序。
- 重启 aIdea 后顺序仍保留。

这是用户可见的设置交互变化，完成实现后将 `apps/builtin/dev-tools.yaml` 的版本从 `0.3.2` 升至 `0.3.3`。

## 范围

### 包含

- DevTools 设置页卡片化布局。
- 使用现有 `@dnd-kit` 实现鼠标和键盘拖拽排序。
- 扩展现有 DevTools 设置数据结构，增加 `tab_order`。
- DevTools 顶部 Tab 按持久化顺序渲染。
- 兼容没有 `tab_order` 的旧配置。
- 前端组件测试和 Rust 设置读写测试。

### 不包含

- 不新增数据库表。
- 不新增拖拽依赖。
- 不修改工具自身业务页面。
- 不增加工具分组、搜索、批量显示/隐藏或恢复单项默认顺序按钮。
- 不改变隐藏工具的语义；隐藏工具仍保留在设置列表和排序数组中。

## 方案

复用现有 `dev_tools_settings` 表中的 JSON 配置，在现有结构上增加顺序字段：

```json
{
  "hidden_tabs": ["ip"],
  "tab_order": ["timestamp", "data", "ip", "ai"]
}
```

Rust 侧继续读写同一行配置，不做数据库迁移。旧 JSON 没有 `tab_order` 时，Serde 默认返回空数组；前端将空数组解释为默认顺序。

前端不把 `DEV_TOOLS_TABS` 改成可变数据源。它仍然是工具元数据和默认顺序，持久化顺序只负责重排当前已注册工具：

1. 先按 `tab_order` 中出现的已知 ID 排列。
2. 忽略未知 ID 和重复 ID。
3. 将新增但不在旧配置中的工具追加到默认顺序末尾。
4. 如果配置为空，直接使用 `DEV_TOOLS_TABS` 默认顺序。

这样旧配置和未来新增工具都能正常显示，不需要手工迁移历史数据。

## 页面交互

设置页采用单列卡片列表，适合按上下顺序拖动：

```text
DevTools 设置
显示需要的工具

┌──────────────────────────────────────────────┐
│ ⋮⋮  JSON 格式化                         [开关] │
│     将 JSON 数据格式化、压缩并转换             │
└──────────────────────────────────────────────┘
┌──────────────────────────────────────────────┐
│ ⋮⋮  时间戳转换                           [开关] │
│     Unix 时间戳与日期字符串互转                 │
└──────────────────────────────────────────────┘
```

- 卡片左侧使用 `GripVertical` 作为拖拽手柄。
- 只有拖拽手柄启动排序，开关和卡片其他区域不触发拖拽。
- 拖拽激活距离使用现有约定 `8px`。
- 拖拽中卡片透明度降为 `0.5`。
- 手柄提供明确的无障碍名称，并支持 `KeyboardSensor`。
- 显示开关继续使用现有 shadcn `Checkbox`，不改业务规则。
- 至少保留一个可见工具；隐藏最后一个可见工具时继续提示错误且不保存。
- 排序不区分可见和隐藏工具，隐藏工具也会随卡片位置保存。

## 数据流

### 设置页加载

1. `DevToolsSettingsPage` 调用 `ipc.getDevToolsSettings()`。
2. 使用统一的顺序规范化逻辑得到当前卡片列表。
3. 从 `hidden_tabs` 计算每张卡片的开关状态。

### 拖拽保存

1. `DndContext` 收到 `onDragEnd`。
2. 使用 `arrayMove` 生成新顺序。
3. 先更新本地卡片顺序，让界面立即反映结果。
4. 调用 `ipc.saveDevToolsSettings({ hidden_tabs, tab_order })`。
5. 保存失败时恢复拖拽前的顺序，并用 `toast.error` 提示。

排序和显隐开关都保存完整配置，避免一次操作覆盖另一项设置。

### DevTools 顶部 Tab

1. `DevToolsPage` 加载同一个设置对象。
2. 先规范化 `tab_order`，再过滤 `hidden_tabs`。
3. 过滤后的结果用于顶部 Tab 的渲染顺序。
4. 当前激活 Tab 被隐藏后，切换到规范化列表中的第一个可见工具。
5. 如果配置异常导致没有可见工具，保留现有兜底逻辑，至少显示默认第一个工具。

## Rust 设置契约

`DevToolsSettings` 增加：

```rust
#[serde(default)]
pub tab_order: Vec<String>,
```

保存校验继续拒绝空字符串和控制字符。`tab_order` 不在 Rust 中硬编码工具 ID，工具注册表仍归前端管理；前端负责过滤未知和重复 ID。

现有 `hidden_tabs` 继续使用 `BTreeSet`，前端传入的数组仍由 Rust 反序列化并按现有方式保存。

## 组件边界

只保留当前页面级边界，不新增通用拖拽组件：

- `DevToolsSettingsPage.tsx`
  - 加载设置。
  - 规范化工具顺序。
  - 处理显隐和排序保存。
  - 渲染 `DndContext`、`SortableContext` 和卡片。
- `index.tsx`
  - 加载设置。
  - 复用同一顺序规范化规则。
  - 按顺序渲染顶部 Tab。
- `tabs.ts`
  - 继续提供工具元数据和默认顺序。
  - 增加一个小型纯函数用于规范化顺序，供设置页和 DevTools 页面复用。
- `types/dev-tools.ts`
  - 同步增加 `tab_order: string[]`。
- `shell-native/src/commands/dev_tools.rs`
  - 同步增加 `tab_order` 并覆盖旧配置兼容测试。

不建立 interface、DTO、factory 或独立排序服务。

## 错误处理

- 读取设置失败：沿用现有错误 toast，页面保留默认工具顺序。
- 显示/隐藏保存失败：恢复开关之前的状态并提示错误。
- 排序保存失败：恢复拖拽前顺序并提示错误。
- 旧配置缺少 `tab_order`：自动使用默认顺序，不提示用户。
- 配置包含未知工具 ID：忽略未知 ID，不阻塞页面。
- 配置包含重复工具 ID：只保留第一次出现的已知 ID。
- 配置包含新增工具 ID：追加到列表末尾。

## 测试

### 前端

更新 `DevToolsSettingsPage.test.tsx`：

- 旧配置没有 `tab_order` 时，卡片按默认顺序显示。
- 带有 `tab_order` 时，卡片按持久化顺序显示。
- 拖拽结束后保存完整的 `hidden_tabs` 和 `tab_order`。
- 保存排序失败时恢复拖拽前顺序并显示错误。
- 已隐藏工具仍显示为未选中，并参与卡片顺序。
- 至少保留一个可见工具的规则继续成立。

更新 `DevToolsPage.test.tsx`：

- 顶部 Tab 按 `tab_order` 渲染。
- 隐藏工具不显示。
- 旧配置和新增工具仍能回退到合理顺序。

拖拽测试使用 `@dnd-kit` 暴露的真实手柄事件，不引入额外测试工具或 mock 拖拽实现；如果 jsdom 无法可靠模拟完整指针流程，则直接测试页面使用的排序处理结果和保存契约。

### Rust

更新 `shell-native/src/commands/dev_tools.rs`：

- 默认配置的 `tab_order` 为空且可正常保存。
- 带有顺序的设置可以读回。
- 旧 JSON 缺少 `tab_order` 时可以正常读取。
- 非法空字符串或控制字符仍然被拒绝。

### 验证命令

```bash
cd shell-frontend && npm run lint && npm test && npm run build
cd ../shell-native && cargo test
git diff --check
```

## 自检结论

- 无待定项。
- 没有新增依赖或数据库迁移。
- 设置页和顶部 Tab 共用同一顺序规范化逻辑。
- 保存失败有回滚路径。
- 用户可见行为变化已纳入版本升级范围。
