# aIdea UI 规范

这份文档是 aIdea 及其官方独立插件的 UI 统一规范。独立项目开发时，先阅读并遵守本文档；不要求引用 aIdea 仓库中的组件代码。

## 技术体系

- React 18 + TypeScript
- Tailwind CSS 3.4
- shadcn/ui：基于 Radix UI 原语的组件体系
- lucide-react：统一图标库
- sonner：操作反馈
- CSS 变量使用 shadcn 标准 HSL 主题变量

独立项目可以自行实现组件，但组件行为、视觉和交互应与本文档一致。

## 组件规则

| 场景 | 使用 | 不使用 |
|---|---|---|
| 模态弹窗 | Dialog | 手写 fixed 遮罩和定位 |
| 滑出面板 | Sheet | 手写 absolute 面板 |
| 浮层 | Popover | 手写 Portal 和定位 |
| 左键菜单 | DropdownMenu | 手写 fixed 下拉菜单 |
| 右键菜单 | ContextMenu | 手写 contextmenu 定位菜单 |
| 悬浮提示 | Tooltip | title 属性或手写浮层 |
| 下拉选择 | Select | 原生 select |
| 开关 | Switch | 手写 toggle |
| 复选框 | Checkbox | 原生 checkbox |
| 单选 | RadioGroup | 手写 radio |
| 状态标签 | Badge | 手写彩色 span |
| 标签页 | Tabs | 手写 tab 状态和切换 |
| 标准按钮 | Button | 原生 button 模拟标准按钮 |
| 操作反馈 | toast.success/error | 页面内临时文字提示 |

所有图标从 lucide-react 导入，不使用 emoji 或内联 SVG。标准按钮变体：主要操作 `default`，次要操作 `outline`，图标按钮 `ghost` + `size="icon"`，删除操作 `destructive`，链接 `link`。每个视图最多一个 `default` 主要按钮；若两个操作权重相等，均降级为 `outline`。

导航列表项、标签、图标网格单元格可以使用原生 button，但必须有明确的定制布局和状态，并使用 class 合并工具处理 className。

## 配色

只使用灰、蓝、红三个主色系：

- `background`：页面背景
- `card`：卡片和侧边栏背景
- `muted`：hover 和弱化背景
- `foreground`：主要文字
- `muted-foreground`：次要文字
- `primary`：选中状态、主要按钮、链接、进度指示
- `destructive`：删除、错误和危险操作
- `border`：边框
- `ring`：焦点环

深色主题默认使用页面背景 `0 0% 10%`、卡片背景 `0 0% 14.1%`、主文字 `0 0% 87.8%`、次要文字 `0 0% 53.7%`、主色 `217 91% 60%`、边框 `0 0% 22.7%`。浅色主题使用页面背景和卡片背景 `0 0% 100%`、弱化背景 `220 14% 96%`、主文字 `222 47% 11%`、次要文字 `220 9% 46%`、主色 `221 83% 53%`、边框 `220 13% 91%`。

不要使用紫色、绿色、橙色等额外主色。警告色只有在确实需要表达警告时使用，并确保深浅主题下都有足够对比度。

所有 UI 必须同时适配浅色和深色主题。业务组件不得写死 `#fff`、`#000`、固定灰色或固定背景色；优先使用上面的主题变量和 Tailwind token。邮件正文、Markdown 预览、富文本、第三方 HTML 等内容区必须单独验证可读性：如果保留原始内容样式，应给内容区明确的可读背景和文字颜色；如果跟随主题，应覆盖内联颜色导致的低对比度问题。

## 布局与字体

- 页面根容器优先使用 `flex flex-col h-full` 或等价的可伸缩布局。
- 需要填满父容器时，子元素使用 `flex-1 min-h-0`，避免内容溢出撑破布局。
- 工具类应用优先使用紧凑、可扫描、面向重复操作的布局。
- 不使用营销式 hero，不使用装饰性渐变球、bokeh 或多层卡片套卡片。
- 卡片只用于独立重复项、弹窗和真正需要边界的工具区域。
- 页面分区优先使用完整宽度的布局和间距，不把每个区域都做成浮动卡片。
- 固定格式区域使用稳定尺寸，避免文字、图标或状态变化导致布局跳动。

全局字体：

```css
-apple-system, BlinkMacSystemFont, 'Segoe UI', 'SF Pro Text', sans-serif
```

标签和次要信息为 12px，正文为 14px，标题为 16px；代码、路径、结构化数据使用等宽字体。不使用负字距，不用视口宽度直接缩放字号。

## 图标、交互和可访问性

统一使用 lucide-react：小图标 16px、中等图标 20px、大图标 24px。设置、关闭、信息、添加、删除、编辑、搜索、刷新、复制分别使用 `Settings`、`X`、`Info`、`Plus`、`Trash2`、`Pencil`、`Search`、`RefreshCw`、`Copy`，不把 emoji 当作功能图标。

- 图标按钮必须有可访问名称；不熟悉的图标通过 Tooltip 解释。
- Tooltip 放在 TooltipProvider 内，建议 `delayDuration={400}`。
- 所有输入和操作控件应有清晰的 label、placeholder 或 aria-label。
- 错误、成功、加载、空状态都要有明确反馈。
- 重复操作应保持状态稳定，不因异步结果导致页面跳动。
- 拖拽排序使用 `@dnd-kit`，激活距离建议 8px，拖拽中透明度 0.5。

## 独立插件约定

官方独立插件不需要依赖 aIdea 的前端源码或组件包。开发时按自身技术栈实现等价的组件和视觉规范。
