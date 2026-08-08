# 官方插件市场与运行器设计

**状态：** 待审阅

## 目标

让 aIdea 随版本发布一组官方插件定义。用户可以在应用市场查看简介、安装、启动、停止、更新和卸载官方插件；插件业务数据在更新和默认卸载时保留。

## 首期边界

- 只支持 `plugin-markets/official/*.yaml` 中由 aIdea 维护的官方插件。
- 使用用户系统已有的 `git`、`node`、`python`；缺失时给出明确错误。
- 官方定义使用固定 tag 或完整 commit，安装命令和启动命令使用参数数组，不执行 shell 字符串。
- 不做第三方仓库输入、远程市场、自动更新、托管 Node/Python、aIdea 自更新或全局 CLI 安装。

## 数据模型

市场定义是只读资源，包含 `id`、名称、简介、分类、图标、版本、仓库、固定 revision、安装命令、启动命令、工作目录、健康检查 URL、更新说明和兼容范围。

安装后在 `apps/installed/<id>/` 写入本机安装记录：已安装版本、revision、安装时间和从市场定义派生的运行 manifest。市场定义不被用户覆盖；本机安装记录不写回仓库。

## 安装与更新

安装：校验定义 -> 显示将执行的参数化命令 -> `git clone` 到 staging -> checkout 固定 revision -> 执行安装命令 -> 启动并检查本地健康地址 -> 原子切换 staging 为 source -> 写安装记录。

更新复用 staging。新版本只有通过安装和健康检查后才替换 source；失败时保留当前 source 和业务数据。卸载只删除 `apps/installed/<id>/source`、staging 和安装记录，保留 `app-data/<id>`、`logs/<id>`。

## 运行器

官方插件运行时从安装记录生成，不复用旧本地应用的 shell 字符串命令。运行器将参数数组直接传给 `tokio::process::Command`，工作目录限制在 source 内，注入 `AIDEA_APP_ID`、`AIDEA_APP_DATA_DIR`、`AIDEA_APP_LOG_DIR`。`AIDEA_COMMAND` 在官方 CLI 实现前不注入。

健康检查仅允许 `http://127.0.0.1:<port>`；成功后 WebView 才显示。日志写入 `logs/<id>/`。

## UI

应用市场作为 aIdea 内置页面，展示官方插件的图标、简介、版本和状态。未安装显示安装，已安装显示打开、更新和卸载；安装或更新期间显示当前阶段及失败原因。第一期不预置没有真实仓库的插件条目。

## 验证

Rust 测试以临时本地 Git 仓库模拟固定 revision、安装成功、安装失败保留旧版本、卸载保留业务数据和命令参数不经过 shell。前端测试覆盖市场状态和操作反馈。
