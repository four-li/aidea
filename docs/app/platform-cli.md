# aIdea 平台命令契约

官方插件可选择通过环境变量和 `aidea` 命令使用平台能力，不需要依赖 SDK。命令接口已定义；未实现的命令在对应发布版本前不得被插件依赖。

## 环境变量

| 变量 | 含义 |
| --- | --- |
| `AIDEA_APP_ID` | 当前官方插件的全局唯一 ID。 |
| `AIDEA_APP_DATA_DIR` | `~/Library/Application Support/aIdea/app-data/<app-id>`。 |
| `AIDEA_APP_LOG_DIR` | `~/Library/Application Support/aIdea/logs/<app-id>`。 |
| `AIDEA_COMMAND` | 当前 aIdea 内置命令的绝对路径。 |

官方插件必须优先使用 `AIDEA_COMMAND`，不依赖用户终端的全局 `PATH`。aIdea 可在安装时额外提供 `/usr/local/bin/aidea`，但这不是插件运行前提。

## 调用约束

`aidea` 是官方应用访问平台能力的稳定边界，可视为平台 IPC（进程间通信）接口。官方应用必须通过 `AIDEA_COMMAND` 取得绝对路径调用它，不得依赖 Tauri IPC、壳前端封装或用户的全局 `PATH`。

应用服务进程调用命令时必须使用参数数组并关闭 shell；禁止拼接 shell 字符串、`sh -c` 和 `bash -c`。每个已发布命令都必须明确参数、标准输出格式、错误输出、退出码和最低 aIdea 版本；应用不得解析未定义的日志文本，也不得调用尚未在本文件定义的命令。

浏览器页面不能直接调用 `AIDEA_COMMAND`。页面需要平台能力时，由官方应用自己的服务进程代为调用，并按应用自身的接口返回结果。

## 本地加密存储命令

```text
aidea secret set <key>
aidea secret get <key>
aidea secret delete <key>
aidea secret list
aidea secret get --app <app-id> <key>
```

- 插件进程根据 `AIDEA_APP_ID` 自动限定自身命名空间。
- 终端直接调用必须使用 `--app <app-id>` 显式指定命名空间。
- `set` 从标准输入读取值，避免敏感值进入命令历史或进程参数。
- `get` 只返回指定值；`list` 只返回 key，不返回值。
- 插件不得读取、更新或删除其他插件命名空间的值。

命令保存的值遵守 [storage.md](storage.md) 的本地加密和 Touch ID 查看规则。

## 通知

`aidea notify` 是预留的平台通知接口，用于请求 aIdea 或 macOS 展示通知。其参数和实现不在当前版本定义，插件不得依赖它作为已可用能力。
