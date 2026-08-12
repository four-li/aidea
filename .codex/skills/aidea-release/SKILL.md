---
name: aidea-release
description: Use when releasing aIdea, building its macOS Apple Silicon DMG, or publishing its signed updater to Gitee.
---

# 发布 aIdea

仅用于本仓库的 macOS Apple Silicon 发布。调用本 Skill 即授权版本修改、`git add`、提交、推送 `main`、创建 tag、Gitee Release 和附件上传；不创建 PR，不发布 Intel 包，不使用 GitHub、Apple 签名或公证。

唯一入口：

```bash
cd /Users/fourli/Desktop/app/aIdea
bash scripts/release.sh
```

直接运行这一条命令。不要手工改版本、写更新日志、`git add`、commit、传版本号，或复制脚本到其他目录。脚本会自动处理这些内容：当前版本高于最近 tag 时发布当前版本；相等时自动递增 patch；低于最近 tag 时停止。

脚本会依次执行前端测试与构建、Rust 测试、Tauri 构建和 updater 签名，然后提交 `chore: release vX.Y.Z`、推送 `main` 与 tag、创建 Gitee Release、上传 DMG、`.app.tar.gz`、`.sig` 和 `latest.json`，最后在线核验 Release 和 Raw 更新清单。

只有明确风险才停止：未解决冲突、疑似密钥文件、缺少签名私钥或 Gitee 凭据、工具缺失、测试/构建失败、或远端发布异常。构建失败前不会留下发布提交，脚本会还原自己写入的版本和更新日志文件。

若脚本已经明确报告 `main` 和 tag 推送成功、但 Gitee Release 或附件失败，使用：

```bash
bash scripts/resume-release.sh X.Y.Z
```

需要只检查、不发布时：

```bash
bash scripts/release.sh --prepare-only
```

发布结束后报告提交、tag、Release URL 和线上核验结果。仓库脚本只依赖 macOS 自带工具；必须在正常 macOS 用户 shell 中运行。Gitee Token 固定从 `/Users/fourli/aidea-gitee-token` 读取，Agent 不得读取、显示、写入或要求手动 `export` Token。受限自动化环境若无法读取该文件，应停止并报告文件权限问题。
