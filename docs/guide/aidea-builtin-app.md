# aIdea 内置应用规范

本文档定义随 aIdea 发布的内置应用目录、manifest、前端 IPC 和测试约定。新增或修改内置应用时，先读本文件和 [UI 规范](aidea-ui.md)；涉及数据时再读 [数据与存储规范](aidea-storage.md)。

## 目录与注册

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
version: 0.3.0
category: 开发
path: shell-frontend/src/builtin-apps/dev-tools
status: active
ui:
  mode: builtin
  icon: Wrench
settings:
  enabled: true
  reset_command: [builtin, dev-tools]
```

- `id` 全局唯一且使用 kebab-case；`name` 是显示名称；用户可见功能变化时更新 `version`。
- `path` 定位源码目录；`status` 为 `active`、`disabled` 或 `deprecated`。
- `ui.mode` 固定为 `builtin`；`ui.icon` 使用 lucide-react 图标名或图片路径。
- `settings.enabled` 保留用于兼容旧 manifest；每个应用都必须有设置详情页。
- 内置应用的设置字段和持久化由应用自己负责，不写入 `shell.config.json` 或壳数据库。DevTools 的显示状态存放在 `app-data/dev-tools/settings.json`。
- `settings.reset_command` 只能使用已注册的壳内处理器。aIdea 先完成 Touch ID，再执行完整重置；处理器不能删除整个应用数据目录或业务数据库。

## IPC 与类型

Rust IPC 命令按业务职责放在 `shell-native/src/commands/`，由 `lib.rs` 负责模块声明、状态初始化和命令注册。内置应用前端统一通过 `shell-frontend/src/lib/ipc.ts` 调用；修改命令名、参数或返回值时，同步 Rust 实现、TypeScript 类型和测试。

类型定义放在 `shell-frontend/src/types/`，与 Rust IPC 数据结构保持一致。共享错误使用 `AppError` / `AppResult`。网络请求设置超时，敏感配置不写入普通配置文件。

## 测试

测试目录跟随源码；DevTools tab 测试放在 `tests/dev-tools/tabs/<tab-name>/`。新增 tab 只修改 DevTools 入口的显式注册和对应测试，不引入自动扫描。
