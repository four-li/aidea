---
name: aidea-release
description: Use when releasing aIdea, bumping its version, building a macOS DMG, or publishing a Gitee Release with Tauri updater signatures while keeping versions, tags, and artifacts consistent.
---

# 发布 aIdea

仅用于此仓库的 macOS Apple Silicon（arm64）发布；不支持 Intel Mac。用户显式调用本 Skill，即授权本次发布所需的版本修改、`git add`、提交、推送 `main` 和 annotated tag；不创建 PR。发布只走 Gitee，不使用 GitHub 下载、Release、CI 或 Secrets，也不接入 Apple Developer、Developer ID、Apple ID 公证或 stapling。

## 固定入口

在仓库根目录、`main`、干净工作区执行：

```text
$aidea-release
发布 aIdea
```

未指定版本则递增 patch。唯一人工版本源是 `shell-native/tauri.conf.json`；脚本校验它与 Cargo、前端包和 lockfile 一致后，完成测试、构建、签名、提交、tag、Gitee Release 和四个附件上传。

发布前必须先在 `shell-frontend/src/data/changelog.json` 增加目标版本的更新日志。该文件是唯一人工维护的文案来源：应用内“更新日志”页面、updater `latest.json` 的 `notes` 和 Gitee Release 的 `body` 都使用其中的 `notes`。每条记录的 `version` 必须为 `X.Y.Z`、全局唯一且正文非空；缺失、重复或格式错误时脚本必须在读取凭据、联网和构建前停止。日志先随功能代码提交，使发布 tag 包含该版本文案；发布脚本只读取它，不自动生成或补写说明。

## 执行纪律

发布代理必须把发布脚本作为凭据和环境的唯一判断入口，不得在脚本外单独探测钥匙串、打印 `GITEE_TOKEN`，或根据探测结果先要求用户重新配置 Token。直接运行：

```bash
bash /Users/fourli/.codex/skills/aidea-release/scripts/release.sh [X.Y.Z]
```

脚本会自己读取钥匙串并调用 Gitee `/api/v5/user` 验证 Token；只有脚本的验证结果才算发布结论。`security` 在受限沙箱中出现 `EPERM`、参数无效或“找不到项目”属于可能的假阴性；不要把钥匙串探测失败当成凭据不存在，也不要据此重建 Token 或改成手动 `export`；应让完整脚本在 macOS 用户环境中运行。只有完整脚本仍报告缺少或无效 Token，才停止并提示用户处理凭据。

仓库没有本地 `scripts/` 目录是正常的；本 Skill 的脚本都在 `/Users/fourli/.codex/skills/aidea-release/scripts/`，不要改用仓库内的相对路径。

## 发布契约

- 私钥优先 `TAURI_SIGNING_PRIVATE_KEY`，否则读取仓库根目录且被忽略的 `aidea-updater.key`；两者不能上传或轮换。
- Token 优先 `GITEE_TOKEN`，否则读取当前用户钥匙串服务 `aidea-gitee-release-token`。首次写入：`read -rs "aidea_gitee_token?Gitee Token: "; echo; security add-generic-password -U -a "$USER" -s "aidea-gitee-release-token" -w "$aidea_gitee_token"; unset aidea_gitee_token`。
- 脚本在构建前调用 Gitee `GET /api/v5/user` 验证 Token；Token 无效立即停止。
- Gitee 创建 Release 必须用 `formData`，传 `access_token`、`tag_name`、`name`、`body`、`target_commitish`；`body` 必填。附件上传接口是 `attach_files`，查询已上传附件看响应的 `assets`。
- 更新清单固定提交到 `updater/latest.json`，应用读取 Gitee Raw 地址；Release 附件只保存版本化 DMG、updater 压缩包、签名和备份清单。
- 不得使用 `Release vX.Y.Z` 作为 updater `notes` 或 Gitee Release `body` 的占位正文；必须使用目标版本的统一更新日志。
- 构建后必须检查最终二进制 `开搞.app/Contents/MacOS/aidea-shell`：必须包含 Gitee Raw 更新地址，且不得包含旧的 `releases/latest/download/latest.json`。不以 `cargo clean` 代替此检查。
- Release 上传或补传后，必须通过 Gitee API 确认四个附件和 Release 正文正确，并用 `curl -L` 校验线上 Raw `latest.json` 的版本、更新日志、`darwin-aarch64` URL 和签名。

## 已验证的坑

| 现象 | 根因 | 固定处理 |
| --- | --- | --- |
| 单独读取钥匙串报不存在或参数无效 | 受限沙箱无法访问 macOS 登录钥匙串，属于假阴性 | 不重建 Token；让完整发布脚本在 macOS 用户环境运行 |
| 创建 Release 返回空的 HTTP 400 | 漏传必填 `body`，或误把 Gitee `formData` 改成 JSON | 脚本固定传目标版本的 `release_notes` 作为 `body`，不得改为 JSON |
| 二次补传又上传附件 | Gitee 查询字段是 `assets`，不是 `attach_files` | 补传脚本只按 `assets` 名称上传缺失文件 |
| Release 显示 6 个附件 | 4 个发布文件外，Gitee 自动添加源码 `.zip` 和 `.tar.gz` | 这是正常结果；只核对 DMG、`.app.tar.gz`、`.sig`、`latest.json` |
| 手工读取 `latest.json` 得到重定向 HTML | Gitee 附件下载会重定向 | 使用 `curl -L` 再解析 JSON |
| `releases/latest/download/latest.json` 返回 404 | 这是 GitHub 的地址约定，Gitee 不提供该下载入口 | 使用 `https://gitee.com/<owner>/<repo>/raw/main/updater/latest.json`；发布脚本在提交 tag 前同步清单 |
| 源码已改 Raw 地址、发布包仍含旧地址 | 历史构建产物不能证明最终 bundle 的配置；强制 clean 也不能替代产物验证 | 发布脚本检查最终二进制必须含 Raw 地址且不含旧地址，再上传 Release |
| Chrome 显示 `foruda.gitee.com` 危险网站 | Gitee Release 会 302 到公共附件 CDN，Chrome Safe Browsing 独立拦截 | 向 Gitee 提交附件 URL 误报复核；不要把它误判为 Tauri 签名失败 |
| `codesign --verify` 或 `spctl` 失败、`TeamIdentifier=not set` | 当前发布明确不使用 Apple Developer ID 证书，只使用 Tauri updater 私钥 | 保持现状并按 README 手动放行；不要尝试加入 Apple 证书、公证或 stapler |
| `npm ci` 显示 Husky 找不到 `.git`，或测试出现 React/CodeMirror 警告 | `--prefix` 与 JSDOM 的既有警告 | 退出码为 0 时继续发布，不在发布流程顺带修复 |
| 发布在读取 Token 或构建前停止 | 目标版本没有更新日志，或日志版本重复、格式错误、正文为空 | 先修复 `shell-frontend/src/data/changelog.json`，再重新运行发布脚本 |

## 异常恢复

正常发布不需要补传。只有主脚本明确报告 commit/tag 已推送、但 Release 或附件失败时，运行：

```bash
bash /Users/fourli/.codex/skills/aidea-release/scripts/resume-release.sh X.Y.Z
```

它要求目标 tag 指向当前提交，使用已有产物创建或续传缺失附件，并完成线上清单、Release 正文与附件核验；不会构建、提交、推送或覆盖 tag。不要为同一版本重跑完整发布。

## 完成核验

报告提交、tag、DMG 路径和 Release URL。脚本已校验最终二进制、Raw `latest.json` 和四个 Release 附件；最后从已安装旧版执行“检查更新”。当前未配置 Apple Developer ID 时，不把 `codesign`/`spctl` 失败误报为 Tauri updater 签名失败。

修改本 Skill 或脚本后运行：

```bash
bash /Users/fourli/.codex/skills/aidea-release/scripts/test-release-version-sync.sh
bash -n /Users/fourli/.codex/skills/aidea-release/scripts/release.sh
bash -n /Users/fourli/.codex/skills/aidea-release/scripts/resume-release.sh
```
