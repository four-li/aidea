# 一键发布设计

## 目标

发布 aIdea 时，操作者只需要在任意正常 macOS 终端执行仓库内的 `bash scripts/release.sh`。脚本自动处理未提交和未跟踪的正常改动、版本、更新日志、测试、构建、签名、Gitee Release 及线上核验。

## 固定入口

```bash
cd /Users/fourli/Desktop/app/aIdea
bash scripts/release.sh
```

发布脚本固定存放在仓库 `scripts/`。`aidea-release` Skill 只引用该入口，不再保存或复制另一份发布脚本。

## 版本与更新日志

- 以最近的正式 `vX.Y.Z` tag 为基准。
- 当前四个版本文件高于最近 tag 时，发布当前版本；当前版本等于最近 tag 时，自动递增 patch。
- 当前版本低于最近 tag 时停止，避免回退发布。
- 脚本同步 `shell-native/tauri.conf.json`、`shell-native/Cargo.toml`、`shell-frontend/package.json` 和 `shell-frontend/package-lock.json`。
- 脚本依据最近 tag 之后的提交标题与当前工作区路径生成中文用户更新说明，写入 `shell-frontend/src/data/changelog.json`。
- 更新说明使用 `新增`、`优化`、`修复` 三个小节，只包含用户可见变化；没有可见变化时使用“维护性更新”。

## 当前工作区

- 正常的已修改和未跟踪文件都由发布脚本纳入本次发布提交，无需人工 `git add` 或 `git commit`。
- 脚本在测试和构建通过后，才创建 `chore: prepare release vX.Y.Z` 提交；它包含当前工作区、版本和更新日志。
- 基于最终签名生成 `updater/latest.json` 后，再创建 `chore: release vX.Y.Z` 提交并打 annotated tag。
- 脚本失败且尚未创建发布提交时，恢复脚本自动写入的版本文件和更新日志，不覆盖用户原有改动。
- 合并冲突、真实密钥、私钥文件、证书文件、`.env` 文件、依赖缓存和构建产物属于明确风险，脚本必须在任何测试或发布动作前停止。

## 预检与发布

- 开始时检查 `git`、`node`、`npm`、`cargo`、`curl`、`hdiutil`、`security`、`strings`、签名私钥、Gitee Token、`main` 分支、远端地址、DMG 挂载状态和远端 tag。
- 脚本不得依赖 Codex、ChatGPT.app 或特定终端专有 PATH 中的工具。
- 预检完成后依次运行前端测试、前端构建、Rust 测试、Tauri Release 构建、最终二进制 updater 地址校验、Gitee 推送、Release 创建、四个附件上传、线上 Release 与 Raw `latest.json` 核验。
- 已推送 tag 后的网络或上传失败由 `scripts/resume-release.sh X.Y.Z` 恢复；它只处理 Release 和附件，不重新构建或修改 tag。

## 验收

- `bash scripts/test-release.sh` 覆盖版本推导、自动版本同步、自动生成更新日志、风险文件拒绝、工具缺失预检和“版本已是发布目标”场景。
- `bash -n scripts/release.sh` 与 `bash -n scripts/resume-release.sh` 通过。
- 第一次实际执行发布 `0.1.11` 后，Gitee Release 正文、四个附件和 Raw `updater/latest.json` 都与本地生成内容一致。
