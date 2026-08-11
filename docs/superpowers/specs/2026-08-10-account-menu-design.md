# 顶部账户菜单设计

> **历史设计记录**：本文件只记录当时设计，不是当前平台契约。当前规则以仓库根目录 `AGENTS.md` 和 `docs/guide/` 为准。

## 目标

将设置入口放在顶部右侧账户菜单；账户菜单显示 macOS 短用户名，提供“设置”和暂时禁用的“报告问题”；macOS 顶部 aIdea 菜单新增“设置”。

## 设计

- Rust 提供 `get_os_username` IPC，返回当前进程的短用户名；读取失败返回现有 `AppError`。
- `TopBar` 右侧放置 `AccountMenu`，保留应用标签和拖拽区域。
- `AccountMenu` 使用现有 DropdownMenu、lucide 图标和主题 token。触发器显示用户名与齿轮图标。
- “设置”菜单项打开现有 `SettingsPanel`；“报告问题”显示为 disabled，不执行动作。
- Tauri `aIdea` 菜单新增 `settings-aidea`，发出 `aidea:open-settings`；前端监听后打开设置弹窗。

## 验收

- 顶部右侧显示短用户名和齿轮，点击可打开菜单。
- “设置”可打开弹窗；“报告问题”灰色且不可点击。
- 顶部菜单“设置”可打开同一弹窗。
- 前端测试覆盖菜单项和 IPC 用户名调用；Rust 测试覆盖命令返回短用户名。
