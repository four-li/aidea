# aIdea 签名更新发布

应用内更新使用 Tauri updater，不使用 Apple 代码签名或公证。首次安装的 macOS 放行流程仍见 README；后续更新只接受使用本项目 updater 私钥签名的安装包。

## 一次性配置

私钥保存于仓库根目录的 `aidea-updater.key`（已加入 `.gitignore`，不进仓库），公钥已写入 `shell-native/tauri.conf.json`。私钥只用于本机构建签名；不要上传到 Gitee、GitHub 或任何 CI 平台。

本机发布还需要设置 `GITEE_TOKEN`，用于创建 `aidea-org/aidea-app` 的 Gitee Release 和上传附件。Token 只通过本机环境变量传入，不写入仓库或文档。

私钥丢失后，旧版无法信任使用新密钥签名的更新；不得删除或轮换它，除非同时设计密钥迁移发布。

## 每次发布

使用 `$aidea-release`。脚本从 `shell-native/tauri.conf.json` 读取目标版本并同步 Cargo、前端包和 lockfile，在本机构建并生成：DMG、`.app.tar.gz`、`.app.tar.gz.sig` 和 `latest.json`。验证成功后，脚本创建 Gitee tag 和 Release，并上传这些产物。

发布后应从已安装的旧版执行“检查更新”，确认能发现新版本；点击“更新并重启”后，Tauri 必须在重启前验证签名。删除或篡改 `.sig`、更新包或 `latest.json` 时，安装必须失败且保留旧版。
