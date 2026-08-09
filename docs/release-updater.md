# aIdea 签名更新发布

应用内更新使用 Tauri updater，不使用 Apple 代码签名或公证。首次安装的 macOS 放行流程仍见 README；后续更新只接受使用本项目 updater 私钥签名的安装包。

## 一次性配置

私钥保存于本机 vault 目录的 `aidea-updater.key`（不进仓库），公钥已写入 `shell-native/tauri.conf.json`。在 GitHub 仓库的 Actions Secrets 添加：

- `TAURI_SIGNING_PRIVATE_KEY`：私钥文件完整内容。
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：本次密钥未设置口令，可不创建。

私钥丢失后，旧版无法信任使用新密钥签名的更新；不得删除或轮换它，除非同时设计密钥迁移发布。

## 每次发布

使用 `$aidea-release`。脚本从 `shell-native/tauri.conf.json` 读取目标版本并同步 Cargo、前端包和 lockfile，GitHub Actions 会生成并上传：DMG、`.app.tar.gz`、`.app.tar.gz.sig` 和 `latest.json`。

发布后应从已安装的旧版执行“检查更新”，确认能发现新版本；点击“更新并重启”后，Tauri 必须在重启前验证签名。删除或篡改 `.sig`、更新包或 `latest.json` 时，安装必须失败且保留旧版。
