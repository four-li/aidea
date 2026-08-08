# aIdea 平台与官方插件架构设计

**日期：** 2026-08-08  
**状态：** 待审阅

## 1. 目标

aIdea 是本地应用平台，负责装载、管理和升级插件。首期优先保证内置插件与官方插件的开发、安装和运行体验；不实现第三方插件市场、自定义插件安装或多作者权限系统。

用户首次安装 aIdea 时只获得壳和内置插件。官方插件由 aIdea 内置市场目录收录，用户在应用市场中安装、更新或卸载，无需手工下载插件仓库。

## 2. 术语

| 术语 | 定义 |
| --- | --- |
| aIdea 壳 | 本地平台本体，负责插件目录、生命周期、运行状态、日志、平台能力和自身更新。 |
| 内置插件 | 代码直接位于 aIdea 仓库，随 aIdea 一起构建和发布，例如 DevTools。 |
| 官方插件 | 独立 GitHub 或 GitLab 仓库，由开发者维护业务代码，且由 aIdea 官方市场目录预设接入配置。 |
| 官方插件市场 | 随 aIdea 发布的一组官方插件定义，不是远程市场服务。 |
| 平台组件 | aIdea 向官方插件提供的可选基础能力，例如数据目录、日志、敏感值、通知和命令行入口。 |
| 业务数据 | 插件自身维护的数据库、配置、迁移和文件，不由 aIdea 解析或迁移。 |

第三方插件和用户自定义插件是后续方向，当前不作为产品能力或开发契约。

## 3. 插件边界

### 3.1 内置插件

- 源码位于 `shell-frontend/src/builtin-apps/<app-id>/`。
- 随 aIdea 版本构建、发布和更新。
- 使用 aIdea 的前端、Rust IPC、SQLite 和 UI 规范。

### 3.2 官方插件

- 源码位于独立 GitHub 或 GitLab 仓库；私有 GitLab 直接复用用户当前网络、Git 凭据和 SSH 配置。
- 不要求插件仓库提供 `aidea.yaml`；接入定义由 aIdea 仓库统一维护。
- aIdea 负责安装、更新、卸载、启动、停止、健康检查、WebView、日志和状态展示。
- 官方插件负责业务代码、业务数据、配置、迁移、业务网络请求和业务 UI。
- 卸载默认仅删除源码、依赖和运行环境，保留业务数据；删除业务数据必须由用户单独确认。

### 3.3 当前不做的能力

- 第三方插件市场和自动收录。
- 用户填写仓库地址安装自定义插件。
- 多作者插件的权限系统、沙箱或 SDK。
- 远程市场服务、自动发现、后台静默安装和自动更新。

## 4. 官方插件市场

官方插件目录随 aIdea 发布：

```text
plugin-markets/
└── official/
    ├── mail-manager.yaml
    └── akm.yaml
```

每个定义由 aIdea 维护，至少描述：

- `id`、名称、简介、分类、图标和版本；
- 源码仓库地址、固定 tag 或 commit；
- 运行时类型、安装命令、启动命令和健康检查地址；
- 对应 aIdea 版本兼容范围；
- 插件数据目录约定和更新说明。

新增官方插件或调整其接入定义时，更新 aIdea 的官方市场目录并发布新的 aIdea 版本。用户更新 aIdea 后，应用市场即可展示新的官方插件。

## 5. 数据目录与生命周期

```text
~/Library/Application Support/aIdea/
├── apps/
│   └── installed/<app-id>/
│       ├── manifest.yaml
│       ├── source/
│       └── staging/
├── app-data/<app-id>/
├── logs/<app-id>/
├── databases/
│   ├── shell.db
│   └── <builtin-app-id>.db
└── backups/
```

- `apps/installed/<app-id>/` 是 aIdea 管理的源码和安装记录；更新可以替换其中的 `source/`。
- `app-data/<app-id>/` 与 `logs/<app-id>/` 归插件所有，更新和默认卸载不得删除。
- aIdea 启动官方插件时注入其应用 ID、数据目录、日志目录和平台命令路径。
- 官方插件可使用自身既有配置目录；选择使用 aIdea 注入的数据目录后，自行负责数据迁移。

生命周期：

```text
官方目录展示 → 用户安装 → 校验定义并展示执行内容
→ 克隆指定版本 → 安装依赖 → 启动 → 健康检查 → WebView 展示
→ 更新或卸载
```

## 6. 平台组件

平台组件是可选能力，不提供 SDK。官方插件通过环境变量和 `aidea` 命令使用。

```text
AIDEA_APP_ID=<app-id>
AIDEA_APP_DATA_DIR=<aIdea 数据根目录>/app-data/<app-id>
AIDEA_APP_LOG_DIR=<aIdea 日志根目录>/<app-id>
AIDEA_COMMAND=<aIdea 内置 aidea 可执行文件的绝对路径>
```

第一期平台组件：

| 能力 | 接口 | 说明 |
| --- | --- | --- |
| 数据目录 | `AIDEA_APP_DATA_DIR` | 插件可选使用的持久化目录。 |
| 日志目录 | `AIDEA_APP_LOG_DIR` | 插件可选使用的日志目录。 |
| 本地加密存储 | `aidea secret` | 保存、读取、删除敏感值。 |
| 通知 | `aidea notify` | 请求 aIdea 或 macOS 展示通知。 |
| 生命周期 | aIdea 管理 | 安装、运行、停止、日志和状态。 |

安全凭据命令：

```text
aidea secret set <key>               # 从标准输入读取值，使用 AIDEA_APP_ID
aidea secret get <key>               # 读取当前插件的值
aidea secret delete <key>            # 删除当前插件的值
aidea secret list                    # 只列 key，不返回值
aidea secret get --app <app-id> <key> # 终端中显式指定插件
```

- 插件进程中的命令根据 `AIDEA_APP_ID` 自动限定当前官方插件的命名空间；终端调用必须使用 `--app` 显式指定。
- 业务密码、授权码、API Key 以密文写入 aIdea 管理的本地 SQLite，不写入普通配置或业务 SQLite 明文。
- 后台业务读取不打断同步；只有 UI 请求显示明文时触发 macOS Touch ID，成功后 5 分钟内复用。
- 此能力的安全边界是避免配置文件和数据库直接暴露明文；为保证重启后可静默运行，解密材料同样保存在本机。它不防御能够读取 aIdea 用户数据目录的本机攻击者，也不应被称为 Keychain 级凭据保护。
- `aidea` 可执行文件支持安装到 `/usr/local/bin/aidea`，供用户终端直接调用；官方插件始终使用 `AIDEA_COMMAND`，不依赖全局 `PATH`。

安全凭据的底层加密实现必须只暴露平台命令，不向插件暴露主密钥或 aIdea 内部存储表。

## 7. aIdea 自更新

aIdea 本体发布在 GitHub Releases。产品目标是设置或更新入口可以检查新版本、下载更新包并在退出后替换本体，用户不需要手动到 GitHub 下载 DMG。

本体更新与官方插件更新独立：

- 更新 aIdea：更新壳、内置插件和官方插件市场目录。
- 更新官方插件：只替换该插件的源码、依赖和运行环境，保留业务数据。

自动更新器、签名、公证、安装位置权限和回滚策略是独立实施项，不和插件市场或安全凭据组件捆绑实现。

## 8. 文档归位

长期标准文档统一迁移到 `docs/app/`：

```text
docs/app/
├── platform.md        # 平台术语、插件类型、职责与生命周期
├── marketplace.md     # 官方市场目录、安装、更新、卸载
├── package-spec.md    # 官方插件接入定义与运行契约
├── data-layout.md     # 用户数据目录边界
├── storage.md         # SQLite、迁移、敏感值规则
├── platform-cli.md    # aidea 命令和平台组件契约
└── ui.md              # UI 规范
```

根目录 `AGENTS.md` 只保留开发前文档路由、不可违反的架构决策和测试闭环，不复制各专项规则。

现有 `docs/app-package-spec.md`、`docs/app-data-layout.md`、`docs/app-storage-spec.md` 和 `docs/ui-spec.md` 将迁移或重定向到新位置，避免同时维护两份标准。
