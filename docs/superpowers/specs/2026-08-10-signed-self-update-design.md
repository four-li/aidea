# aIdea 签名自更新设计

## 目标

aIdea 在 macOS 上通过 GitHub Releases 检查、下载并安装自身更新。用户可在设置的“关于”页检查更新，也可从 macOS 菜单栏触发并跳转到该页。整个安装过程必须验证更新包签名；本期不做 Apple 代码签名和公证。

## 更新流程

1. 后端以 Tauri updater 读取当前应用版本并检查 GitHub Release 的 `latest.json`。
2. “关于”页显示真实当前版本、最近检查时间、可用版本和更新说明。
3. 找到更高版本后，用户点击“更新并重启”；updater 下载并验证签名，验证通过后重启替换应用。
4. macOS 菜单的“检查更新”向前端发送事件，设置弹窗打开“关于”页并复用同一个检查动作。
5. 网络、清单格式、版本或签名错误均保留当前版本，并显示可读错误。开发模式不执行安装。

更新包私钥只保存为 GitHub Actions Secret，公钥配置在 `tauri.conf.json`。不允许前端拼接下载链接、下载 DMG 或自行覆盖 `aIdea.app`。

## 版本规则

`shell-native/tauri.conf.json` 的 `version` 是唯一人工维护的版本号。以下文件必须与它相同：

- `shell-native/Cargo.toml` 的 `package.version`
- `shell-frontend/package.json` 的 `version`
- `shell-frontend/package-lock.json` 的根 `version` 与根 package 的 `version`

日常开发若版本不一致，验证失败；发布时 `aidea-release` 从 Tauri 配置读取当前版本，自动将目标版本同步到其余文件。发布提交只包含这四个版本文件。GitHub Actions 也在构建前校验 tag 与全部版本一致。

## 发布产物

GitHub Actions 生成 DMG、Tauri updater 安装包、对应签名和 `latest.json`，并作为同一 GitHub Release 的资产发布。私钥通过 `TAURI_SIGNING_PRIVATE_KEY` Secret 注入；需要密码时使用单独 Secret。由于未做 Apple 签名和公证，初次下载仍可能需要用户按 macOS 提示手动放行。

## 验证

- Rust 单测验证当前版本来自构建时应用版本，以及升级版本比较。
- 前端测试验证关于页状态、错误和菜单事件打开关于页。
- 发布脚本校验四个版本文件、tag、更新签名配置和所需产物。
- 发布前执行 `npm test`、`npm run lint`、`npm run build`、`cargo test` 与 `git diff --check`。
