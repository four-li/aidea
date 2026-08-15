# aIdea 发布规范

本文定义 aIdea 壳自身的版本、发布产物、更新来源和发布入口。独立官方应用的发布不适用本文，按 [官方应用规范](aidea-official-app.md) 和 `$aidea-app-release` Skill 执行。

## 何时阅读

以下任务必须先读本文并调用 `$aidea-release` Skill：修改 aIdea 版本、构建 macOS DMG、创建或恢复 aIdea Release、发布更新清单、推送 aIdea 发布 tag。

日常代码、测试或文档修改不自动触发发布，开发阶段也不自动更新版本号。正式发布时，用户可见功能、界面、交互、设置页、数据格式或业务行为发生变化，发布流程必须同步更新 aIdea 版本；纯重构、测试和文档不要求升版本。

## 发布范围

- aIdea 只发布 macOS Apple Silicon（arm64）DMG；不维护 Intel Mac、Windows、iOS、Android 或其他平台产物。
- aIdea 自身代码、tag、Release 附件和应用内更新清单全部使用 Gitee。GitHub 只可作为人工同步的代码镜像，不能作为下载源、更新源、Release、CI 或 Secrets 平台。
- 固定更新清单为 `https://gitee.com/aidea-org/aidea-app/raw/main/updater/latest.json`。Gitee 不支持 GitHub 风格的 `releases/latest/download/latest.json`，不得使用或恢复该地址。
- `aidea-updater.key` 只用于 Tauri updater 安装包签名，不是 Apple 证书。
- 当前不接入 Apple Developer Program、Developer ID、Apple ID 公证、`notarytool` 或 stapling。DMG 保持未使用 Apple 代码签名和公证的发布方式；首次安装按项目 README 的手动放行流程处理。

## 发布入口与验证

`$aidea-release` 是 aIdea 发布的唯一自动化入口。它负责根据当前发布流程完成预检、版本处理、构建、DMG 与更新产物校验、Gitee Release 和更新清单发布。

发布前至少确认：

- 工作区改动归属明确，版本变化符合用户可见改动范围。
- 前端 lint、测试和构建，以及 Rust 测试均已按仓库根 `AGENTS.md` 执行。
- DMG 目标为 arm64，更新产物与更新清单指向本次版本。
- 没有把上游 API Key、签名私钥、用户数据或其他敏感信息写入 Release、日志或提交内容。

发布命令、恢复步骤和临时排障细节由 `$aidea-release` Skill 维护；`docs/release-updater.md` 是现有脚本的辅助说明，不替代本契约或发布 Skill。

## 官方应用边界

aIdea 可以从 Gitee、GitHub 或 GitLab（包括自建实例）的同仓库 Release 下载官方应用的单个 arm64 自包含包，但这不改变 aIdea 自身必须使用 Gitee 发布的规则。官方应用版本、tag、附件、SHA-256 和市场接入详见 [官方应用规范](aidea-official-app.md)。
