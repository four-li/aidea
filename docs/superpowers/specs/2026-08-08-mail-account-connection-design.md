# 邮箱账户编辑与连接测试设计

## 目标

让用户能修正已保存的邮箱账户配置，并在保存前确认 IMAP 能够使用当前账号和密码登录。

## 范围

- 左侧账户列表中的账户条目通过右键菜单提供“编辑账户”入口。
- 编辑与新增共用账户配置弹窗；编辑账户时密码默认掩码，只有点击密码框旁的眼睛图标查看明文时，才请求 macOS 本机认证并从 Keychain 加载密码或授权码。
- 认证由现有 `mac_auth` 模块执行，优先使用 Touch ID；无法使用时由 macOS 提供设备密码兜底。认证成功后的 5 分钟内不重复弹窗。
- 编辑保存时使用当前显示或修改后的密码或授权码覆盖 macOS Keychain 中原有凭据，无需重复输入未变更的凭据。
- 弹窗提供“测试连接”按钮，使用当前表单的 IMAP 主机、端口、TLS、用户名和密码执行一次 TLS IMAP 登录。
- 测试成功只表示服务器接受连接和认证，不保存账户、不写入 Keychain、不拉取或变更邮件。
- 测试失败回显明确的连接或认证错误，用户可以继续修改表单。

## 阿里云邮箱个人版预设

阿里云邮箱个人版使用：

- IMAP 主机：`imap.aliyun.com`
- 端口：`993`
- TLS：启用
- 用户名：完整邮箱地址
- 密码：邮箱登录密码
- 网页邮箱：`https://mail.aliyun.com`

客户端授权码不作为个人版预设选项。`LOGIN failed` 表示 TLS 连接已建立，但服务器拒绝当前用户名或密码。

## 接口与数据流

新增 Tauri 命令 `test_mail_account_connection(request)`，参数复用 `SaveMailAccountRequest`。该命令只校验连接所需字段，并将表单秘密直接传给 IMAP 登录函数；不得调用账户保存、SQLite 写入或 Keychain 写入。

前端新增 `ipc.testMailAccountConnection`。测试按钮在必填字段缺失时禁用，调用期间显示“测试中”，成功或失败使用 toast 反馈。

新增 `load_mail_account_secret(id)` 命令：先复用 `mac_auth` 的本机认证，再读取指定账户的 Keychain 条目。编辑时从账户右键菜单进入，将 `MailAccount` 转换为 `SaveMailAccountRequest`，保留账户 `id`；点击眼睛并认证成功后填入 `secret`，再次点击只切换掩码，不重复读取。保存仍复用 `save_mail_account` 的更新路径。

## 错误与安全

- 密码和授权码不经 `list_mail_accounts` 返回，也不写入 SQLite、日志或 toast；仅在用户主动点击眼睛且完成 macOS 本机认证后返回给前端。
- 测试失败只返回经过现有 `AppError` 包装的 IMAP 错误，不包含秘密。
- 测试连接的超时和 TLS 行为与同步使用相同配置，避免“测试成功、同步失败”的协议差异。

## 验证

- Rust 单测覆盖：测试连接请求拒绝缺少连接字段；使用显式表单秘密的连接辅助函数可由测试替身验证，不读 Keychain。
- 前端测试覆盖：右键菜单可打开编辑；编辑时在本机认证后的 IPC 返回密码并填入弹窗；点击测试连接把当前表单传入 IPC；测试失败不关闭弹窗。
- 完整验证执行 Rust 测试、前端 lint、build 和 Vitest 全套测试。
