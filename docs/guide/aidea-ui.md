# aIdea UI 规范

本文档是 aIdea 和官方独立应用统一的 UI 基线。所有 Web UI 必须使用 shadcn/ui 标准，不得建立第二套设计系统或自行实现基础交互组件。

## 技术体系

- React 18 + TypeScript
- Tailwind CSS 3.4
- shadcn/ui（基于 Radix UI 原语）
- lucide-react
- sonner
- shadcn 标准 HSL CSS 主题变量

## 组件来源

- 优先复用项目已有的 `components/ui/` shadcn 组件。
- 缺少组件时，只能从 shadcn 官方组件或官方 registry 添加，并保留 shadcn 的 Radix、Tailwind 和 lucide-react 依赖方式。
- 禁止引入 Ant Design、MUI、Mantine、Chakra UI、NextUI 等第二套 UI 组件库。
- 禁止手写或复制 `Button`、`Dialog`、`Sheet`、`Popover`、`DropdownMenu`、`Select`、`Switch`、`Checkbox`、`RadioGroup`、`Tabs`、`Tooltip` 等基础组件；业务组件可以组合已有 shadcn 组件。
- 不得以“视觉等价”为由在独立官方应用中重建基础组件。确有 shadcn 官方未覆盖的基础交互时，先更新本规范并获得确认后再实现。

## 组件与操作

| 场景 | 使用 |
| --- | --- |
| 模态、滑出面板、浮层 | `Dialog`、`Sheet`、`Popover` |
| 菜单、选择、开关、复选、单选 | `DropdownMenu`、`Select`、`Switch`、`Checkbox`、`RadioGroup` |
| 标签、标签页、按钮、反馈 | `Badge`、`Tabs`、`Button`、`toast.success/error` |
| 悬浮说明 | `Tooltip`，不使用 `title` 冒充 |

图标统一来自 lucide-react，不使用 emoji 或内联 SVG。标准按钮变体为主要操作 `default`、次要操作 `outline`、图标按钮 `ghost` + `size="icon"`、危险操作 `destructive`、链接 `link`。每个视图最多一个主要按钮；等权操作都使用 `outline`。

导航列表项、标签和图标网格单元格可以使用原生 `button`，但必须有明确布局、状态和可访问名称。

## 颜色与主题

只使用灰、蓝、红三个主色系和语义 token：`background`、`card`、`muted`、`foreground`、`muted-foreground`、`primary`、`destructive`、`border`、`ring`。警告色只在确实需要表达警告时使用，并保证两个主题下都有足够对比度。

所有页面、内置应用和官方应用都必须同时适配浅色与深色主题。业务组件不得写死 `#fff`、`#000`、固定灰色或固定背景色；优先使用主题变量和 Tailwind token。

官方应用嵌入 aIdea 时，aIdea 会在主页面 URL 追加 `aidea_theme=light` 或 `aidea_theme=dark`，用于首屏主题；应用页面应优先使用这个值渲染主题，独立运行且没有该参数时回退到 `prefers-color-scheme`。主页面发送 `ready` 后，主题变化通过 App Bridge 的 `theme` 消息同步，不重新加载 iframe。

邮件正文、Markdown 预览、富文本、第三方 HTML 等内容区必须单独验证：如果保留原始内容样式，内容区必须有明确可读的背景和文字颜色；如果跟随主题，必须覆盖内联颜色造成的低对比度问题。链接、引用、代码块、表格边框和图片占位状态也要在两个主题下可读。

## 布局与字体

- 页面根容器优先使用 `flex flex-col h-full` 或等价的可伸缩布局；填满父容器的子元素使用 `flex-1 min-h-0`。
- 工具类应用使用紧凑、可扫描、面向重复操作的布局；不做营销式 hero、装饰性渐变球、bokeh 或卡片套卡片。
- 页面分区优先使用完整宽度布局；卡片只用于独立重复项、弹窗和确实需要边界的工具区域。
- 固定格式区域使用稳定尺寸，避免文字、图标和状态变化造成跳动。
- 全局字体使用 `-apple-system, BlinkMacSystemFont, 'Segoe UI', 'SF Pro Text', sans-serif`。
- 标签和次要信息为 12px，正文为 14px，标题为 16px；代码、路径和结构化数据使用等宽字体。不使用负字距，不用视口宽度直接缩放字号。

## 交互与无障碍

- 图标按钮必须有可访问名称；不熟悉的图标放在 `TooltipProvider` 内并说明用途。
- 覆盖 shadcn Button 的焦点环时，`focus-visible:ring-0` 必须同时使用 `focus-visible:ring-offset-0`，避免菜单关闭或点击后焦点恢复产生额外边线。原生导航按钮、Dialog/Sheet 关闭按钮也必须使用 `focus-visible` 焦点样式，不得使用常驻 `focus:ring`，避免弹窗首次打开或关闭后出现默认边框。
- 全屏二级页（非弹窗）必须提供返回主页面的按钮；返回目标由其父页面管理，避免页面自行维护导航状态。
- 所有输入和操作控件必须有清晰的 label、placeholder 或 `aria-label`。
- 错误、成功、加载和空状态都要有明确反馈；重复操作不能因异步结果造成布局跳动。
- 拖拽排序使用已安装的 `@dnd-kit`，激活距离建议 8px，拖拽中透明度建议 0.5。
