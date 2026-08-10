# aIdea 签名更新发布

应用内更新只使用 Tauri updater。项目明确不接入 Apple Developer、Developer ID 代码签名、Apple ID 公证或 stapling；首次安装的 macOS 放行流程见 README。

## 一次性配置

私钥保存于仓库根目录的 `aidea-updater.key`（已加入 `.gitignore`，不进仓库），公钥已写入 `shell-native/tauri.conf.json`。私钥只用于 Tauri updater 安装包签名；不要上传到 Gitee、GitHub 或任何 CI 平台。

本机发布还需要 Gitee Token，用于创建 `aidea-org/aidea-app` 的 Gitee Release 和上传附件。将 Token 存入当前 macOS 用户钥匙串服务 `aidea-gitee-release-token` 后，发布脚本会自动读取；不需要手动 `export`，Token 不写入仓库或文档。

私钥丢失后，旧版无法信任使用新密钥签名的更新；不得删除或轮换它，除非同时设计密钥迁移发布。

## 每次发布

使用 `$aidea-release`。脚本从 `shell-native/tauri.conf.json` 读取目标版本并同步 Cargo、前端包和 lockfile，在本机构建并生成：DMG、`.app.tar.gz`、`.app.tar.gz.sig` 和 `latest.json`。验证成功后，脚本把 `latest.json` 写入并提交到 `updater/latest.json`，创建 Gitee tag 和 Release，并上传这些产物。

应用固定读取 `https://gitee.com/aidea-org/aidea-app/raw/main/updater/latest.json`。不要改回 `releases/latest/download/latest.json`：Gitee 没有这个 GitHub 兼容地址，会返回 404；版本化附件地址仍使用对应 tag 的 Release 下载地址。

发布脚本会先调用 Gitee `GET /api/v5/user` 验证 Token，再开始构建。创建 Release 使用 Gitee OpenAPI 的表单参数：`access_token`、`tag_name`、`name`、`body`、`target_commitish`，其中 `body` 必填；Gitee 返回的已上传附件字段是 `assets`。不要改成 JSON 请求，也不要用 `attach_files` 判断附件是否存在。

如果 commit 和 tag 已推送、但创建 Release 或上传附件时中断，运行：

```bash
bash "$CODEX_HOME/skills/aidea-release/scripts/resume-release.sh" X.Y.Z
```

它只校验当前 tag 与已有产物并补传缺失附件，不会重新构建、提交、推送或覆盖 tag。

发布后应从已安装的旧版执行“检查更新”，确认能读取 Raw 的 `latest.json` 并发现新版本；点击“更新并重启”后，Tauri 必须在重启前验证签名。删除或篡改 `.sig`、更新包或 `latest.json` 时，安装必须失败且保留旧版。
