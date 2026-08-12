---
name: aidea-release
description: 发布 aIdea 的 macOS Apple Silicon 版本：自动收集改动、生成版本和更新说明、构建、签名并发布到 Gitee。
---

# 发布 aIdea

仅用于本仓库的 macOS Apple Silicon 发布。执行本 Skill 即授权本次发布所需的版本修改、`git add`、提交、推送 `main`、创建 annotated tag、Gitee Release 和附件上传；不创建 PR，不发布 Intel 包，不使用 GitHub、Apple 签名或公证。

唯一入口：

```bash
cd /Users/fourli/Desktop/app/aIdea
bash scripts/release.sh
```

脚本会自动纳入当前已修改和未跟踪的正常文件，更新四处版本号，根据 `v*` tag 生成发布版本，并从 `git log` 自动生成中文更新说明，写入 `shell-frontend/src/data/changelog.json`。版本规则：当前版本高于最近 tag 时发布当前版本；相等时自动递增 patch；低于最近 tag 时停止。

脚本会依次执行前端测试与构建、Rust 测试、Tauri 构建和 updater 签名，然后提交 `chore: release vX.Y.Z`、推送 `main` 与 tag、创建 Gitee Release、上传 DMG、`.app.tar.gz`、`.sig` 和 `latest.json`，最后在线核验 Release 和 Raw 更新清单。

只有明确风险才停止：未解决冲突、疑似密钥文件、缺少签名私钥或 Gitee 凭据、工具缺失、测试/构建失败、或远端发布异常。构建失败前不会留下发布提交，脚本会还原其自动改写的版本和更新日志文件。

若脚本已经明确报告 `main` 和 tag 推送成功、但 Gitee Release 或附件失败，使用：

```bash
bash scripts/resume-release.sh X.Y.Z
```

发布前检查：

```bash
bash scripts/test-release.sh
bash -n scripts/release.sh
bash -n scripts/resume-release.sh
```

仓库发布脚本只依赖 macOS 自带工具，不依赖特定终端或 `rg` 等额外 PATH 工具。
