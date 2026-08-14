# 官方应用仅支持 Binary 设计

> **历史记录，禁止作为当前实现或发布步骤执行。** 本设计记录 binary-only 决策过程，Gitee-only 说明已经由三平台 Release 附件契约取代。当前规则以 `docs/guide/aidea-official-app.md` 和 `docs/guide/aidea-platform.md` 为准。

## 目标

将 aIdea 的官方应用安装契约收敛为唯一形式：macOS Apple Silicon（arm64）的自包含预编译应用包。aIdea 只负责获取、校验、安装、启动、更新和卸载该应用包；不再安装、构建或执行官方应用源码。

应用内部可以使用 Rust、React、Python、Node 或混合技术，但发布包必须包含启动所需的运行时、依赖和资源。用户不需要预装 Rust、Cargo、Node、npm、Python 或 SQLite。

## 非目标

- 不支持 Intel Mac、Windows、iOS、Android 或多架构包选择。
- 不支持官方应用的源码安装、Git checkout、npm install、pip install 或其他安装命令。
- 不支持用户自行配置应用运行时。
- 不新增应用 SDK、IPC 或凭据服务。
- 不迁移旧内置邮件或旧官方应用数据。

## Manifest

`aidea.yaml` 只描述当前可安装的 binary 包和启动方式：

```yaml
schema_version: 1
id: mail-center
name: 邮件中心
description: 本地多账户 IMAP 邮件管理
category: 效率
version: 0.2.0
icon: Mail
artifact:
  url: https://gitee.com/aidea-org/mail-manager/releases/download/v0.2.0/mail-center-0.2.0-darwin-arm64.tar.gz
  sha256: <64 位小写十六进制 SHA-256>
process:
  command: [mail-center]
  working_directory: .
  ready_url: http://127.0.0.1:43130/health
```

删除以下字段及其语义：

- `revision`：不再通过源码 commit 追溯或安装应用。
- `runtime`：官方应用唯一运行形式就是 binary，不再声明类型。
- `install`：aIdea 不再运行 npm、pip、cargo 或其他安装命令。
- `update_notes`：更新日志唯一来源是应用仓库对应平台的 Release 正文。
- `min_aidea_version`：当前没有安装拦截或用户提示行为，不保留无效兼容性声明。

市场收录文件仍只保存 `schema_version`、`repository` 和 `enabled`。`repository` 用于读取应用仓库根目录的 `aidea.yaml`，以及查询该仓库对应平台的 Release 更新日志；不再用于 clone 或安装源码。

## 安装与更新

```text
市场刷新
  -> 读取 aidea.yaml
  -> 校验 binary manifest
  -> 下载 artifact.url
  -> 校验 artifact.sha256
  -> 受限解压至 staging
  -> 使用 /health 进行 staging 健康检查
  -> 原子替换 source/
  -> 写入安装状态和 manifest 快照
```

安装器删除 Git clone、HTTP/2 Git 重试、Git checkout、运行时分支和 `install` 命令执行。包校验、路径保护、原子替换、更新回滚和运行状态恢复保留不变。

`install-state.yaml` 只保存 `id`、`version`、`status`、`artifact` 和安装时的定义快照。`revision` 不再写入或读取。

更新判断继续只比较已安装版本与市场定义版本。更新日志继续通过应用仓库对应平台的公开 Release API 读取最近 Release 的标题、版本、发布时间和正文，不读取 manifest 的更新说明字段。

## 发布

每次普通版本发布在应用仓库内完成一个连续事务：

```text
检查发布前提
  -> 自动递增版本
  -> 更新应用版本文件并执行测试、构建
  -> 生成唯一 arm64 tar.gz
  -> 计算 SHA-256，写入 aidea.yaml 和 Release 正文
  -> 提交包含版本、manifest 与应用代码的单个发布提交并推送
  -> 创建 vX.Y.Z tag 和对应平台 Release
  -> 上传附件
  -> 下载附件复验 SHA-256
```

`aidea.yaml` 与发布包对应的版本、URL、SHA-256 在同一个应用发布提交中更新。SHA-256 是安装完整性的唯一锚点。Release 正文是更新日志唯一来源。

首次将新应用收录到市场、变更市场仓库地址或变更启用状态时，才额外更新 `aidea-market/official/<app-id>.yaml`。正常版本发布不修改市场仓库。

发布 Skill 提供一个总入口脚本，负责上述固定动作。预检、打包、对应平台 Release 创建和最终核验可以是内部步骤，但不向调用者暴露 C1/C2/C3 等阶段概念。遇到测试失败、远端结果不明、tag 或 Release 冲突、改动归属无法判断、或需要覆盖/删除资源时停止并报告；权限或沙箱限制时主动申请提升权限。

## 代码收敛

aIdea 的 Rust 官方应用模型删除 `revision`、`runtime`、`install` 和 `update_notes` 字段，要求 `artifact` 存在。前端官方应用类型和测试夹具同步删除这些字段。

官方应用安装器删除源码安装辅助函数和相应测试，只保留 binary 包下载、SHA-256 校验、受限解压、健康检查、安装记录、更新与回滚测试。应用进程管理不再按 runtime 分支处理官方应用。

`mail-center/aidea.yaml` 删除上述四个字段，并保持版本、包 URL、SHA-256 和启动配置与 Release 附件一致。

## 验证

自动验证至少覆盖：

- 缺少 artifact、非法 Release URL、非法 SHA-256、非法包结构时拒绝安装。
- 合法 arm64 包可通过 staging 健康检查后安装。
- SHA-256 不匹配、解压失败或健康检查失败时保留旧版本。
- 更新失败可恢复旧目录、安装记录与运行状态。
- Manifest 和市场缓存中不再接受 `revision`、`runtime`、`install` 或 `update_notes`。
- 应用管理仍可基于版本显示更新按钮，并从对应平台 Release 正文显示更新日志。
- 发布 Skill 能在本地对版本、包结构、manifest 和远端附件 SHA-256 进行验证。

手工验收仍包括：市场刷新、安装、启动、更新、卸载、Release 更新日志展示，以及应用自身业务能力。
