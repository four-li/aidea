# aIdea 发布与更新

aIdea 只发布 macOS Apple Silicon 版本。安装包和应用内更新均使用 Gitee；不使用 GitHub、Apple Developer、Developer ID、Apple ID 公证或 stapling。

## 发布

在仓库根目录的正常 macOS 用户 shell 运行：

```bash
bash scripts/release.sh
```

这是唯一发布入口。不要手工改版本、更新 `changelog.json`、`git add`、commit、推送、传版本号或使用 Skill 目录中的脚本副本。

Token 固定保存于 `/Users/fourli/aidea-gitee-token`，由发布脚本内部读取。Agent 不得读取、显示、写入或要求手动 `export` Token；如果脚本无法读取该文件，应报告文件权限问题。

脚本自动纳入正常的已修改和未跟踪文件，自动计算版本、生成用户更新说明，并执行测试、构建、Tauri updater 签名、提交、tag、Gitee Release、四个附件上传和线上核验。版本每段不超过 9：`0.1.9` 后为 `0.2.0`，`0.9.9` 后为 `1.0.0`。构建失败前会还原自己修改的版本、更新日志和更新清单文件，不创建发布提交。

发布前仅检查：

```bash
bash scripts/release.sh --prepare-only
```

## 凭据与产物

- `aidea-updater.key` 位于仓库根目录且不提交，只用于 Tauri updater 签名；不得上传、删除或轮换。
- Gitee Token 存在 `/Users/fourli/aidea-gitee-token`；文件权限应为 `600`，脚本自动读取，不写入仓库或文档。
- 固定更新清单：`https://gitee.com/aidea-org/aidea-app/raw/main/updater/latest.json`。不要改为 `releases/latest/download/latest.json`。
- Release 必须包含 DMG、`.app.tar.gz`、`.app.tar.gz.sig` 和 `latest.json`；Gitee 自动生成的源码压缩包不算额外发布产物。

## 中断恢复

只有脚本已经明确报告 `main` 和 tag 推送成功、但创建 Release 或上传附件失败时，才运行：

```bash
bash scripts/resume-release.sh X.Y.Z
```

它只补齐 Release、附件和线上核验，不重新构建、提交、推送或覆盖 tag。

发布后从已安装旧版检查更新，确认能读取 Raw 更新清单并完成签名校验。
