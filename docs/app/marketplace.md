# aIdea 官方应用市场规范

官方应用市场由 aIdea 提供，不依赖独立市场仓库、远程市场服务或自动发现。

## 官方收录目录

```text
plugin-markets/
└── official/
    └── <app-id>.yaml
```

每个收录文件只包含：

```yaml
schema_version: 1
repository: https://github.com/four-li/stock-assistant.git
enabled: true
```

完整应用定义位于应用仓库根目录 `aidea.yaml`，字段见 [package-spec.md](package-spec.md)。aIdea 打开应用市场或用户点击刷新时，使用 Git 拉取仓库默认分支读取此文件；启动 aIdea 时不触发网络请求。

最近一次成功读取的定义缓存到：

```text
~/Library/Application Support/aIdea/runtime/market-cache/<catalog-file-stem>/
├── aidea.yaml
└── metadata.json
```

刷新失败时继续展示上次成功缓存和对应错误。aIdea 不保存 Git 密码或 SSH 私钥。

## 发布与更新

新增官方应用时：

1. 发布应用仓库，其中必须包含合法的 `aidea.yaml`。
2. 在 aIdea 的 `plugin-markets/official/` 增加仓库收录文件。
3. 发布新的 aIdea 版本。

已收录应用更新时：

1. 发布新源码 commit。
2. 更新应用仓库的 `aidea.yaml`，提高 `version` 并填写新 `revision`。
3. 用户在应用市场刷新即可发现更新，无需发布新的 aIdea。

市场仅在市场版本高于本机安装版本时显示更新。安装、更新始终使用声明的固定 SHA，不能跟随 `main` 或其他浮动分支。

## 当前边界

当前不提供第三方市场、用户填写仓库地址安装、后台静默安装或自动更新。应用市场仅展示 aIdea 内置收录目录中的官方应用，并支持安装、更新、卸载和查看安装日志。
