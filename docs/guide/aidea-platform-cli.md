# aIdea 平台环境与命令

本文档定义官方应用可依赖的平台进程接口。只有标记为“已发布”的能力才能写入官方应用的运行前提。

## 已发布：启动环境变量

| 变量 | 含义 |
| --- | --- |
| `AIDEA_APP_ID` | 当前官方应用的全局唯一 ID。 |
| `AIDEA_APP_DATA_DIR` | `~/Library/Application Support/aIdea/app-data/<app-id>`。 |
| `AIDEA_APP_LOG_DIR` | `~/Library/Application Support/aIdea/logs/<app-id>`。 |

官方应用使用这些变量管理自己的数据和日志。独立启动时必须提供自己的默认目录。

## 规划中：平台命令

`AIDEA_COMMAND`、`aidea secret` 和 `aidea notify` 尚未实现，也没有被 aIdea 注入到官方应用进程。官方应用不得依赖、模拟、探测或通过全局 `PATH` 调用它们。

未来启用平台命令时，必须先在本文件定义：命令、参数、标准输出、错误输出、退出码、最低 aIdea 版本、权限边界和是否可从浏览器页面调用；随后实现命令和 `AIDEA_COMMAND` 注入，最后更新官方应用规范与 Skill。

浏览器页面未来也不得直接执行平台命令。需要平台能力时，由官方应用自己的服务进程调用，再以应用内部接口提供给页面。
