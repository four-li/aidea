# aIdea 内置应用规范

本文档定义随 aIdea 发布的内置应用目录、manifest、前端 IPC 和测试约定。新增或修改内置应用时，先读本文件和 [UI 规范](aidea-ui.md)；涉及数据时再读 [数据与存储规范](aidea-storage.md)。

## 目录与注册

当前没有内置邮件管理。新邮件功能必须进入独立官方应用 `mail-center`，不得依赖旧内置邮件的 manifest、前端入口、Rust 业务模块、IPC、迁移文件或数据结构。

一个内置应用对应一个 manifest 和一个 `shell-frontend/src/builtin-apps/<app-id>/` 目录。入口固定为 `index.tsx`，应用通过 `BuiltinPage.tsx` 显式注册，暂不自动扫描。

```text
shell-frontend/src/builtin-apps/dev-tools/
├── index.tsx
└── tabs/
    ├── data-formatter/
    ├── timestamp-converter/
    ├── ip-lookup/
    └── ai-model-tester/
```

应用目录使用 kebab-case，业务组件使用 PascalCase。DevTools 内部工具使用 tab 组织；每个 tab 独立目录，相关工具函数放在本目录内。只有确认有共享需求后才建立 `shared/`。

## Manifest

```yaml
id: dev-tools
name: DevTools
version: 0.3.1
category: 开发
status: active
ui:
  mode: builtin
  icon: Wrench
settings:
  reset_command: [builtin, dev-tools]
```

- `id` 全局唯一且使用 kebab-case；`name` 是显示名称；只要用户可见功能、界面、交互、设置页、数据格式或行为有变化，就必须更新 `version`；纯重构、测试和文档不要求升版本。
- `ui.mode` 固定为 `builtin`；`ui.icon` 使用 lucide-react 图标名或图片路径。
- 应用管理页为内置应用提供 aIdea 的通用设置详情；没有业务设置的内置应用显示空配置状态。
- 内置应用的业务设置由应用自己负责，统一保存在 `app-data/<app-id>/app.db`，不写入 `shell.config.json` 或壳数据库。DevTools 的工具显示偏好保存在自己的 `app.db`。
- `settings.reset_command` 只能使用已注册的壳内处理器。aIdea 先完成页面确认，再执行配置重置；处理器不能删除整个应用数据目录或业务数据库。

## IPC 与类型

内置应用继续使用 Tauri IPC，并统一通过 `shell-frontend/src/lib/ipc.ts` 调用自己的 Rust 业务代码。内置应用不接入官方应用的跨源 App Bridge。

内置应用需要搜索时，搜索框、快捷键、匹配、高亮和翻页都在该内置应用页面内完成，遵守 [应用内搜索规范](aidea-search.md)。aIdea 壳不提供全局 `Cmd+F` 搜索。

Rust IPC 命令按业务职责放在 `shell-native/src/commands/`，由 `lib.rs` 负责模块声明、状态初始化和命令注册。内置应用前端统一通过 `shell-frontend/src/lib/ipc.ts` 调用；修改命令名、参数或返回值时，同步 Rust 实现、TypeScript 类型和测试。

类型定义放在 `shell-frontend/src/types/`，与 Rust IPC 数据结构保持一致。共享错误使用 `AppError` / `AppResult`。网络请求设置超时，敏感配置不写入普通配置文件。

## 基础设置页

应用管理中的设置按钮只属于内置应用：在内置应用设置注册表中按 `app_id` 显式注册一个 React 设置组件。`settings.reset_command` 也只属于内置 manifest，由 aIdea 的确认流程调用已注册处理器。官方应用没有壳内设置按钮，业务设置由自己的主页面组织。

## 测试

测试目录跟随源码；DevTools tab 测试放在 `tests/dev-tools/tabs/<tab-name>/`。新增 tab 只修改 DevTools 入口的显式注册和对应测试，不引入自动扫描。
