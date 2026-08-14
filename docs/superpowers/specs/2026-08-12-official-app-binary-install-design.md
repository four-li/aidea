# 官方应用 Binary 安装设计

> **历史记录，禁止作为当前实现或发布步骤执行。** 本设计记录 binary 安装 v1 的收敛过程，包含已废弃的 Gitee-only 发布链路。当前字段和行为以 [官方应用规范](../../guide/aidea-official-app.md) 为准。

## 目标

官方应用只安装自包含的 macOS Apple Silicon（arm64）`.tar.gz` 包。用户无需安装
Rust、Cargo、Node、npm、Python 或 SQLite。

## 约束

- `aidea.yaml` 只声明展示信息、`version`、`artifact` 和 `process`。
- `artifact.url` 是同仓库 Gitee、GitHub 或 GitLab Release HTTPS `.tar.gz` 地址；`artifact.sha256` 是 64 位小写
  十六进制值，且是安装完整性的唯一锚点。
- 不支持源码安装、运行时选择、多架构、Intel 回退或 `process.path`。
- 应用包顶层恰好一个目录，拒绝绝对路径、`..`、符号链接和硬链接。
- 更新日志唯一来自对应平台 Release 正文。

## 安装与更新

1. 读取并校验 manifest。
2. 下载 artifact 到 staging，校验 SHA-256。
3. 受限解压并用临时数据、日志目录启动 staging，确认 `/health`。
4. 健康检查成功后替换 `source/` 并写入安装记录。
5. 更新失败时恢复旧 `source/`、安装记录与此前运行状态。

安装记录只保存版本、状态和 manifest 快照，用于离线启动、卸载和排查。它不保存源码提交信息，
也不替代市场刷新。

## 发布

一次发布完成版本递增、应用提交、构建打包、对应平台 tag 和 Release、附件 SHA-256 回读、manifest
更新和推送。正常版本发布不修改市场仓库；首次发布、仓库地址变化或启用状态变化时才更新市场收录。
tag 或 Release 冲突、远端结果不明或校验失败时停止，绝不覆盖已有资源。

## 验证

- manifest 缺少 artifact、包含废弃字段、URL 或 SHA-256 非法时拒绝。
- SHA-256 不匹配、包结构非法或 staging 健康检查失败时保留旧版本。
- 合法包安装后从包根 PATH 启动，更新失败恢复原运行状态。
- 应用管理按版本提示更新，并显示对应平台 Release 正文。
