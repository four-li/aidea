# aIdea 外部应用源码安装契约

- 状态：首版开发契约，安装器与远程应用源尚未实现
- 目标平台：macOS Apple Silicon（`aarch64-apple-darwin`）
- 适用对象：通过 GitHub 仓库安装、启动和更新的外部 Web 应用

## 1. 目标与边界

aIdea 是本地应用工作台，负责克隆、安装、启动、停止、更新和卸载外部应用。外部应用保持独立仓库与独立发布节奏。

首版外部应用必须是本地服务进程：aIdea 启动服务后，在内嵌 WebView 中打开其 `127.0.0.1` 地址。应用自己的前端、业务逻辑、配置、SQLite 数据库、文件目录和 API 凭证均由应用负责；aIdea 不迁移、不改写也不备份这些数据。

本契约不定义账户、云同步、网页市场、Docker 容器或 Windows/Intel Mac 支持。

## 1.1 接入层级

aIdea 不强制所有应用达到同一种集成深度。应用列表统一展示和管理，但按来源使用不同约束：

| 层级 | 适用对象 | aIdea 行为 | 子应用要求 |
| --- | --- | --- | --- |
| `builtin` | aIdea 内置工具 | 随 aIdea 发布，直接渲染内置页面。 | 遵守本仓库 UI 与内置应用目录规范。 |
| `owned` | 自己开发的独立项目 | 优先读取 `aidea.json`，提供受管运行时、启动、更新和 WebView 集成。 | 建议遵守 UI 规范、提供健康检查，并使用契约声明默认启动方式。 |
| `external` | 第三方开源项目 | 自动识别后允许人工配置，提供启动、停止、日志和 WebView。 | 无需修改源码；安装前确认命令即可。 |

`owned` 与 `external` 都是独立仓库，区别只在集成质量，不是权限边界。第三方应用也可以逐步添加 `aidea.json` 来获得更好的默认体验。

首版不引入 aIdea SDK、前端组件依赖、子应用 IPC 或插件 API。只有自有项目出现反复的真实共享需求时，再为那个需求新增一个很小的契约字段或环境变量。

## 2. 两种运行方式

### 2.1 `managed`：默认方式

常规 Python 或 Node 本地应用使用 aIdea 托管运行时，应用仓库**不重复携带** Python 或 Node 二进制。仓库只带业务代码、已构建前端、生产依赖定义和迁移文件。

首个 aIdea 版本包含的托管运行时为：

| aIdea 版本 | Node.js | Python | 平台 |
| --- | --- | --- | --- |
| `v1.0.0` | `24.14.0` | `3.13.x`（发布时锁定补丁版本） | macOS Apple Silicon |

应用不应声明 Python 或 Node 的版本范围，也不应依赖用户通过 Homebrew、nvm 或 pyenv 安装的版本。应用只声明兼容的 aIdea 版本；aIdea 必须以其自身托管运行时的绝对路径启动应用。`v1.0.0` 正式打包时应在发布说明中记录实际包含的 Python `3.13` 补丁版本。

一个应用只声明真正需要的运行时：

- Python API + 已构建 Vite 前端：只声明 `python`。前端产物由 Python 服务提供时，运行时不需要 Node。
- Node 服务 + 已构建前端：只声明 `node`。
- 运行时确有两个独立服务时：声明 `python` 与 `node`。首版只支持一个主进程；多进程编排后续单独设计。

Python 与 Node 的应用依赖必须随应用隔离，不能写入 aIdea 的全局依赖目录。对 Python 应用，aIdea 使用其托管 Python 在应用的 `source/.venv` 创建虚拟环境；后续安装和启动命令中的 `python` 都指向该虚拟环境。对 Node 应用，aIdea 使用托管 Node，依赖安装到应用自身的 `source/node_modules`。锁文件用于安装的可重复性。

### 2.2 `bundled`：例外方式

以下情况使用自包含包：Rust/Go 二进制、必须使用不同语言版本的应用、带原生系统依赖的应用、模型类应用，或无法兼容托管档案的应用。

`bundled` 包携带自己要执行的可执行文件和必要动态库；它仍由 aIdea 管理安装、启动、更新和卸载。不要用 `bundled` 仅仅为了规避依赖整理。

## 3. GitHub 仓库安装

用户在 aIdea 中输入 GitHub 仓库地址。aIdea 克隆仓库后，若根目录存在 `aidea.json`，将其作为默认配置；若不存在，则只读扫描常见项目文件，生成待用户确认的配置草稿。仓库没有 `aidea.json` 不阻止安装，但用户必须补齐无法可靠推断的字段。

首版只支持公开 GitHub HTTPS 仓库。安装时必须选择 tag；未指定 tag 时使用仓库默认分支当前提交，并记录完整 commit SHA。更新不会直接覆盖当前工作副本：aIdea 会检出新 tag 或 commit，完成依赖安装与健康检查后才切换。

通过 GitHub 安装的源码默认放在 aIdea 用户数据目录，但 aIdea 只管理源码目录的下载和版本切换，不管理子应用内部的数据库、虚拟环境或运行文件：

```text
~/Library/Application Support/aIdea/
└── apps/installed/<app-id>/
    ├── manifest.yaml                 # aIdea 本地安装配置
    ├── source/                       # Git 检出目录
    └── staging/                      # 更新期间的临时检出目录
```

源码更新或重新安装会替换 `source/`。子应用自己的持久化数据继续按其原有逻辑存储，例如 AKM 的 `~/.akm`；aIdea 不要求它们迁移到统一目录。

## 4. `aidea.json`（可选）

`aidea.json` 是外部仓库可选的默认应用契约，不是 aIdea 内置 manifest：

- `aidea.json` 随外部仓库提交，定义建议的名称、展示信息、运行时、安装命令和启动方式。
- `apps/builtin/*.yaml` 只保留给随 aIdea 发布的内置应用。
- 用户创建或安装的 manifest 保存到 `~/Library/Application Support/aIdea/apps/`，不写回第三方仓库。
- aIdea 将最终安装配置完整保存在本机；设置界面修改不会回写外部仓库的 `aidea.json`。

首版 `aidea.json` 示例：

```json
{
  "schemaVersion": 1,
  "id": "stock-assistant",
  "name": "Stock Assistant",
  "description": "本地股票分析工具",
  "category": "效率",
  "version": "1.0.0",
  "platform": "aarch64-apple-darwin",
  "ui": {
    "url": "http://127.0.0.1:43120",
    "icon": "assets/icon.png"
  },
  "runtime": {
    "mode": "managed",
    "aideaVersion": "v1.0.0",
    "requires": ["python"]
  },
  "install": {
    "commands": [
      ["python", "-m", "pip", "install", "-r", "requirements.txt"]
    ]
  },
  "process": {
    "command": ["python", "-m", "server.main"],
    "workingDirectory": ".",
    "readyUrl": "http://127.0.0.1:43120/health"
  }
}
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `schemaVersion` | 首版固定为 `1`。不兼容变更时递增。 |
| `id` | 全局唯一，kebab-case；安装后不可改名。 |
| `version` | 使用 SemVer（语义化版本）。 |
| `description`、`category` | 可选展示字段。缺失时 aIdea 可使用仓库描述和语言信息生成草稿。 |
| `platform` | 首版固定为 `aarch64-apple-darwin`。 |
| `ui.url` | 仅允许 `http://127.0.0.1:<port>`；禁止任意远程 URL。 |
| `runtime.mode` | `managed` 或 `bundled`。 |
| `runtime.aideaVersion` | `managed` 时必填，首版为 `v1.0.0`。应用以 aIdea 主次版本兼容运行时，不直接选择 Python/Node 版本。 |
| `runtime.requires` | `managed` 时列出 `python`、`node` 中实际需要的项。 |
| `install.commands` | 首次安装和更新时按顺序执行的参数数组。禁止 shell 字符串；aIdea 不执行 `sh -c`。 |
| `process.command` | 参数数组，禁止 shell 字符串；aIdea 不执行 `sh -c`。 |
| `process.workingDirectory` | 相对包根目录，禁止逃出安装目录。 |
| `process.readyUrl` | 本地健康检查地址；aIdea 在它成功前不显示 WebView。 |

对 `managed` 应用，`install.commands` 与 `process.command` 的第一个元素只能是 `python` 或 `node`，由 aIdea 替换为对应托管运行时的绝对路径。Python 应用在虚拟环境创建后使用该环境的 Python。对 `bundled` 应用，它必须是仓库内 `bin/` 下的相对可执行文件。

为方便愿意接入的子应用，aIdea 可注入下列环境变量；子应用可以使用，也可以完全忽略：

```text
AIDEA_APP_ID=stock-assistant
AIDEA_APP_VERSION=1.0.0
AIDEA_APP_DATA_DIR=<aIdea 应用数据目录>/app-data/stock-assistant
AIDEA_APP_LOG_DIR=<aIdea 应用数据目录>/logs/stock-assistant
```

子应用可继续使用自己的默认数据位置。若它选择使用 `AIDEA_APP_DATA_DIR`，应自行负责数据库迁移和数据兼容；aIdea 不参与其中。

### 4.1 本机最终配置与覆盖

每个已安装应用都在 aIdea 本机保存完整配置：仓库地址、固定的 tag 或 commit、由 `aidea.json` 或扫描生成的默认值，以及用户覆盖值。aIdea 的应用列表读取这份本机配置；`aidea.json` 只在首次安装和用户主动重新读取仓库配置时提供默认值。

用户可以在设置中调整已安装应用的显示名、描述、分类、图标、启动附加参数和环境变量。覆盖值优先于 `aidea.json`，但绝不提交或回写到 GitHub 仓库。

可覆盖字段：

```json
{
  "stock-assistant": {
    "name": "我的股票助手",
    "category": "AI",
    "icon": "/Users/me/Pictures/stock.png",
    "process": {
      "arguments": ["--port", "43121"],
      "environment": {
        "LOG_LEVEL": "debug"
      }
    }
  }
}
```

`process.arguments` 追加到默认 `process.command` 末尾，`process.environment` 覆盖同名环境变量。首次安装配置页也允许用户填写或修改运行时、安装命令、主启动命令、管理台 URL 和 `readyUrl`；保存后，这些字段与确认过的仓库 commit 一起记录。已安装应用修改这些关键字段时，aIdea 必须再次显示将执行的命令并要求确认。

### 4.2 智能识别

aIdea 应优先读取 `aidea.json`；没有该文件时，只读分析仓库文件生成草稿，不自动执行推断出的命令。首版只需覆盖常见约定：

| 发现信号 | 可推断内容 |
| --- | --- |
| `pyproject.toml` 的 `requires-python`、`project.scripts` | Python 运行时、可执行命令候选。 |
| `uv.lock`、`requirements*.txt` | Python 依赖安装方式候选。 |
| `package.json` 的 `scripts` | Node 运行时、安装和启动命令候选。 |
| `Dockerfile`、`docker-compose.yml` | 标记为需人工确认的特殊运行方式；首版不自动支持。 |
| README 中的 localhost URL、`health`、`serve` 命令 | 仅作为 URL、健康检查和启动命令候选，不能直接视为可信配置。 |

识别结果必须标注置信度。只有确定性字段，如仓库名、描述、语言、`project.scripts`，可以自动填入；端口、启动参数、健康检查和数据目录策略即使被识别，也必须在安装确认页显示并允许编辑。

## 5. 安装、信任与更新

安装第三方仓库前，aIdea 必须显示仓库 URL、发布者、tag 或完整 commit SHA、`aidea.json` 内容或自动识别草稿，以及将执行的安装和启动命令。用户确认后才允许 clone、安装依赖或启动进程。第三方仓库即使没有 shell 字符串，依然能通过 Python、Node 或依赖安装脚本执行任意本机代码；aIdea 不能把它视为沙箱。

安装完成后，aIdea 校验合并后的本机应用配置、创建需要的 Python 虚拟环境、执行 `install.commands`、启动应用并检查 `readyUrl`。任一步失败都保留当前已工作的源码目录与配置，并展示安装日志。

更新时，aIdea 拉取用户确认的新 tag 或 commit，重复安装和健康检查；成功后才替换当前源码目录。首版不做集中式市场服务、静态索引、自动更新或后台静默安装。GitLab、本地目录和自包含 ZIP 可在有实际需求时追加。

## 6. 开发与发布检查清单

1. 只面向 macOS Apple Silicon 构建和测试。
2. 前端先构建成静态资源；不要把 Vite 开发服务器带进安装包。
3. `managed` 仓库不携带 `node` 或 `python` 二进制；依赖通过仓库中的锁文件或依赖声明安装到应用自身目录。
4. Python 原生扩展、Node 原生模块必须为 `arm64` 且兼容 `v1.0.0` 实际包含的运行时版本。
5. 需要跨源码更新保留的数据不能写入应用源码目录；现有项目可继续使用自己的默认数据位置。
6. 启动后由 `readyUrl` 返回成功状态，再让 aIdea 加载 WebView。
7. 每次发布更新 `version`，并以全新安装和从上一版本更新两种路径验证。

## 7. 对现有开发注册的关系

当前 `apps/*.yaml` 的绝对路径和自由 `process.start` 命令仍可作为开发模式，便于直接调试独立仓库。它不是市场安装格式，也不保证最终用户环境可运行。

在安装器落地前，不能假设现有 YAML manifest 已支持本契约；届时会为安装应用新增独立的 JSON manifest 解析与安装记录，避免破坏内置应用和开发模式。

## 8. aIdea 本体发布与更新

aIdea 本体先发布到 GitHub Releases。首发只构建 macOS Apple Silicon 未签名 `.app.zip`；内置工具、托管 Node/Python 运行时和应用安装器都随 aIdea 一起更新。

本体版本使用 SemVer，例如 `v1.0.0`。应用的兼容判断按主次版本处理：声明兼容 `v1.0.0` 的应用默认兼容 `v1.0.1`、`v1.0.2`，但不自动兼容 `v1.1.0` 或 `v2.0.0`。只有运行时、应用包协议或启动接口发生不兼容变化时，才需要提升主版本或次版本并要求应用重新发布。

每个正式版本应发布：

1. 未签名的 macOS Apple Silicon `.app.zip`。
2. GitHub Release 的自动生成更新说明。
3. 发布说明：aIdea 版本、内置 Node 精确版本、内置 Python 精确版本、已知兼容性限制。

首版不启用 Tauri 自动更新器。用户从 GitHub Release 下载新 `.app.zip`，退出旧版并替换 `aIdea.app`。应用更新与本体更新分开：前者更新 `apps/installed/<app-id>/`，后者更新 aIdea 自身及其共享运行时。

当未来 aIdea 升级共享 Python 或 Node 时，不应无条件删除旧运行时。只要还有已安装应用声明兼容旧版 aIdea，宿主必须保留对应运行时；等应用更新或卸载后再清理。首版不做运行时下载、运行时市场或任意版本组合。
