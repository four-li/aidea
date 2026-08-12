# 官方应用 Binary 安装 v1 设计

> 本文是 aIdea 官方应用预编译安装能力的实施设计。当前正式运行契约仍以 `docs/guide/aidea-official-app.md` 和 `docs/guide/aidea-platform.md` 为准；实现完成并发布后，再将已落地的字段写入正式规范。

## 目标

让 aIdea 安装和更新自包含的 macOS Apple Silicon（arm64）官方应用包。终端用户不需要安装 Rust、Cargo、Node、npm、Python 或 SQLite。

本期只服务 aIdea 自行维护的官方应用，首个目标应用是 `mail-center`。

## 范围

### 本期实现

- 只支持 macOS Apple Silicon（arm64）。
- 只支持 `runtime: binary` 的 `.tar.gz` 包。
- 下载 Gitee Release 的固定版本附件。
- 下载完成后校验 SHA-256。
- 解压到既有安装 staging 目录，健康检查通过后替换既有 `source/`。
- 安装、更新失败时保留旧版本；更新后恢复更新前的运行状态。
- 安装记录保存 binary 产物信息和应用定义快照。

### 明确不做

- Intel Mac、Windows、Linux 或多架构选择。
- `artifact` 数组、`arch` 字段、架构回退。
- Node/Python 系统运行时检查、自动安装运行时或修改用户全局 `PATH`。
- 第三方市场、自定义仓库、签名体系、权限模型。
- `process.path`、复杂的包内目录白名单或可执行文件扫描。
- 修改现有安装目录名称；binary 包继续安装到 `source/`。

## Manifest

binary 应用的完整定义继续包含固定源码提交 `revision`，用于追溯“这个包由哪份源码构建”；安装器不再 clone 该提交。

```yaml
schema_version: 1
id: mail-center
name: 邮件中心
description: 本地邮件管理
category: 效率
version: 0.1.5
icon: Mail
revision: <构建此包的完整 40 位源码 commit SHA>
min_aidea_version: <支持 binary v1 的 aIdea 版本>
runtime: binary
artifact:
  url: https://gitee.com/aidea-org/mail-center/releases/download/v0.1.5/mail-center-0.1.5-darwin-arm64.tar.gz
  sha256: <64 位小写十六进制 SHA-256>
process:
  command: [mail-center]
  working_directory: .
  ready_url: http://127.0.0.1:43130/health
update_notes: 首期版本。
```

规则：

- `artifact` 仅有 `url` 和 `sha256`，两者必填。
- `url` 必须是 HTTPS 的 Gitee Release 固定附件地址；不使用分支中会被覆盖的 `dist/` 文件。
- `sha256` 必须是 64 位十六进制值。
- `revision` 必须是构建该包的完整源码 commit SHA，不指向包含 `aidea.yaml` 的同一提交。
- binary 的 `command[0]` 可以是裸命令，例如 `mail-center`；也可保留现有的相对写法。

## 包格式

包只接受 `.tar.gz`，且 tar 包顶层必须恰好有一个目录。例如：

```text
mail-center-0.1.5-darwin-arm64/
├── mail-center
└── public/
    └── index.html
```

安装器把顶层目录中的内容放入既有：

```text
~/Library/Application Support/aIdea/apps/installed/<app-id>/source/
```

解压时只做以下必要校验：

- tar 条目不得是绝对路径；
- tar 条目不得包含 `..`；
- 不接受符号链接或硬链接；
- 必须只有一个顶层目录。

不支持的包格式直接安装失败，staging 被清理，旧版本保持不变。

## 命令与 PATH

binary 包根目录加入子进程 `PATH` 的最前面。这样 manifest 可以使用：

```yaml
process:
  command: [mail-center]
```

而不必强制写 `./mail-center`。仍沿用既有 `process.command` 参数数组，不增加 `process.path` 字段。

本期不做包内路径白名单、多个工具目录的声明或系统 PATH 隔离。Atlas 等应用需要更多目录或更严格约束时，后续单独设计。

## 安装与更新流程

### 安装

1. 读取并校验 binary manifest。
2. 在 `apps/installed/<app-id>/staging-<uuid>/` 下载 artifact。
3. 下载完成后计算 SHA-256；不匹配则删除 staging 并失败。
4. 按包格式规则解压到 staging。
5. 将解压后的顶层目录内容作为 staging 应用根目录。
6. 在临时数据、日志目录中启动 staging 应用并请求 `/health`。
7. 健康检查成功后，将现有 `source/` 改名备份，并把 staging 应用根目录替换为 `source/`。
8. 原子写入 `install-state.yaml`；写入失败时恢复旧 `source/`。
9. 删除备份，返回成功。

### 更新

更新复用安装流程。命令层在更新前记录应用是否正在运行：

1. 运行中的旧应用先停止。
2. 执行 binary 安装流程。
3. 成功后，若更新前正在运行，则启动新版本。
4. 安装或新版本启动失败时，恢复旧 `source/` 和旧安装记录；若旧应用此前在运行，重新启动旧版本。

下载、校验、解压和 staging 健康检查阶段均不触碰正式业务数据目录。

## 安装记录

`install-state.yaml` 在保留既有字段和定义快照的基础上，对 binary 记录：

```yaml
id: mail-center
version: 0.1.5
revision: <源码 commit SHA>
status: installed
artifact:
  url: https://...
  sha256: <64 位 SHA-256>
definition: <安装时 manifest 快照>
```

该记录只服务离线启动、卸载和问题定位，不能替代市场刷新。

## 错误处理

| 场景 | 行为 |
| --- | --- |
| 下载失败 | 安装失败，清理 staging，保留旧版本。 |
| SHA-256 不匹配 | 安装失败，删除下载文件和 staging，不启动、不替换旧版本。 |
| 包结构或 tar 条目非法 | 安装失败，清理 staging，保留旧版本。 |
| 启动文件找不到或无法启动 | staging 健康检查失败，保留旧版本。 |
| `/health` 失败 | staging 健康检查失败，保留旧版本。 |
| 替换目录或写安装记录失败 | 恢复旧 `source/` 和旧安装记录。 |

错误写入既有安装日志；不得记录业务数据、邮件正文、凭据或通知内容。

## 测试

安装器至少覆盖：

- 合法 arm64 tar.gz 可安装，且 staging 健康检查后成为 `source/`。
- SHA-256 不匹配时不替换旧版本。
- 包含绝对路径、`..`、符号链接、硬链接或多个顶层目录时拒绝安装。
- staging 健康检查失败时保留旧版本。
- 更新成功后恢复原运行状态。
- 更新失败后恢复旧目录、旧安装记录和原运行状态。
- binary manifest 缺少 artifact、URL 非法、SHA-256 非法时拒绝读取。

mail-center 在平台测试通过后进行端到端验证：安装、启动、主页面、主题握手、`/settings`、更新、卸载和业务数据保留。

## 发布顺序

1. 发布包含 binary v1 的 aIdea。
2. mail-center 提交可构建源码 commit `C1`。
3. 从 `C1` 构建并发布 arm64 tar.gz 到 Gitee Release，取得 SHA-256。
4. 后续 commit `C2` 创建 `aidea.yaml`，其 `revision` 指向 `C1`，并填写 artifact URL 与 SHA-256。
5. 在官方市场收录 `mail-center`。
6. 用已发布的 aIdea 完成真实安装、更新、主题、设置和卸载验证。
