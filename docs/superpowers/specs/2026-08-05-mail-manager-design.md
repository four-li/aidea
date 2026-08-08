# 邮件管理内置子应用设计

## 1. 目标与范围

新增内置子应用 `mail-manager`，在 aIdea 内只读查看多个邮箱的技术通知邮件。

第一阶段支持：

- 腾讯企业邮箱和阿里云邮箱的标准 IMAP 账户；
- 多账户统一查看；
- 每个账户的收件箱和垃圾箱；
- 收件箱本地保留最近 90 天，垃圾箱本地保留最近 30 天；
- 邮件列表、邮件详情、搜索、刷新、标记已读；
- 写邮件时在默认浏览器打开该账户对应的网页邮箱；
- 凭据保存到 macOS Keychain。

第一阶段不支持：

- Gmail OAuth；
- 发信、草稿、联系人、日历和附件下载；
- 修改服务器文件夹、移动邮件和删除邮件；
- 邮件规则编辑、系统通知和 AI 摘要。

规则通知和关键词统计建立在本阶段的本地邮件索引上，后续可以追加，不改变基础邮件模型。

## 2. 接入方式

这是 `builtin` 应用，不启动独立进程，也不使用 iframe。入口在
`shell-frontend/src/builtin-apps/mail-manager/`，通过
`shell-frontend/src/components/BuiltinPage.tsx` 显式注册。

Rust 负责 IMAP、数据库、Keychain 和浏览器跳转；React 负责账户配置、邮件列表和详情展示。前端不直接接触 IMAP 凭据，也不直接访问 SQLite。

账户配置支持服务商预设和手工编辑：

- 显示名称、邮箱地址、IMAP 主机、端口、TLS 模式、用户名；
- 认证方式为密码或客户端授权码；
- 网页邮箱地址，用于写信跳转；
- 收件箱和垃圾箱远程文件夹名称，可从 IMAP 特殊用途标记自动识别，识别失败时允许手工选择。

密码或授权码只写入 Keychain；SQLite 只保存账户配置中的非敏感字段和 Keychain 条目标识。

## 3. SQLite 数据模型

数据库文件为：

```text
~/Library/Application Support/aIdea/databases/mail-manager.db
```

遵守 [app-storage-spec.md](../../app-storage-spec.md)：WAL、外键、迁移、事务和备份规则由通用规范统一管理。

### 3.1 `mail_accounts`

保存账户和连接配置，不保存密码：

```text
id                TEXT PRIMARY KEY
display_name      TEXT NOT NULL
email             TEXT NOT NULL
provider          TEXT NOT NULL
imap_host         TEXT NOT NULL
imap_port         INTEGER NOT NULL
tls_mode          TEXT NOT NULL
username          TEXT NOT NULL
auth_kind         TEXT NOT NULL
keychain_id       TEXT NOT NULL
webmail_url       TEXT NOT NULL
enabled           INTEGER NOT NULL DEFAULT 1
last_sync_at      INTEGER
last_error        TEXT
created_at        INTEGER NOT NULL
updated_at        INTEGER NOT NULL
```

### 3.2 `mail_folders`

每个账户最多为第一阶段同步收件箱和垃圾箱，但表结构保留远程文件夹名：

```text
id                INTEGER PRIMARY KEY
account_id        TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE
remote_name       TEXT NOT NULL
folder_kind       TEXT NOT NULL
uid_validity      INTEGER
last_uid          INTEGER
last_synced_at    INTEGER
UNIQUE(account_id, remote_name)
```

`folder_kind` 只允许 `inbox` 或 `trash`。远程 UID 只在账户和文件夹内有效，不能作为全局邮件主键。

### 3.3 `mail_messages`

列表所需的轻量字段和同步标记：

```text
id                INTEGER PRIMARY KEY
account_id        TEXT NOT NULL REFERENCES mail_accounts(id) ON DELETE CASCADE
folder_id         INTEGER NOT NULL REFERENCES mail_folders(id) ON DELETE CASCADE
remote_uid        INTEGER NOT NULL
rfc_message_id    TEXT
sender_name       TEXT
sender_address    TEXT NOT NULL
subject           TEXT NOT NULL
received_at       INTEGER NOT NULL
is_read           INTEGER NOT NULL DEFAULT 0
snippet           TEXT
body_loaded       INTEGER NOT NULL DEFAULT 0
synced_at         INTEGER NOT NULL
UNIQUE(folder_id, remote_uid)
```

### 3.4 `mail_bodies`

正文与列表分离，打开详情时按需读取：

```text
mail_message_id   INTEGER PRIMARY KEY REFERENCES mail_messages(id) ON DELETE CASCADE
text_body         TEXT
sanitized_html    TEXT
updated_at        INTEGER NOT NULL
```

第一阶段不建立线程、标签、附件和规则表；确认出现实际共享需求后再增加迁移。

## 4. 同步流程

1. 邮件管理启动后，Rust 为每个已启用账户分别建立收件箱和垃圾箱的 IMAP `IDLE` 连接。一条 IMAP 连接只能监听一个已选中文件夹，因此两个文件夹必须使用两条连接。
2. 腾讯企业邮箱和阿里云企业邮箱均在其 IMAP `CAPABILITY` 响应中声明 `IDLE`，优先使用这一标准协议能力，不使用固定间隔轮询作为主收信方式。
3. 任一连接收到邮箱变更事件后，只对对应账户和文件夹执行基于 `uid_validity`、`last_uid` 的 UID 增量同步；首次同步仍按收件箱 90 天、垃圾箱 30 天的保留期限拉取。
4. IDLE 连接每 29 分钟主动结束并重新进入 IDLE，满足 RFC 2177 的保活建议；网络中断、Mac 睡眠、服务端断开或认证失败时记录状态并按退避策略重连。
5. 网络恢复、应用从睡眠恢复、手动刷新时，先执行一次所有账户与文件夹的增量补偿，再重新建立监听。主动查询仅是补偿手段，不承担实时收信职责。
6. 邮件列表先写入 `mail_messages`；正文在用户打开详情时按需获取并经过清理后写入 `mail_bodies`。
7. 读取服务器 `Seen` 标记更新本地 `is_read`；用户标记已读时向 IMAP 写回 `Seen`。
8. 同步完成后删除超过保留期限的本地记录和正文，不删除服务器邮件。单个账户或文件夹失败不阻塞其他账户，错误写入 `last_error` 并在界面展示。

监听连接、重连计时和当前同步进度是进程运行态，不写入 SQLite。SQLite 只保留账户配置、文件夹 UID 游标、邮件与同步结果，应用重启后可用这些游标安全补偿。

### 4.1 同步任务与可见进度

- 自动增量同步和用户发起的历史同步共用单一任务队列，避免同一账户和文件夹并发写入游标。
- 用户手动刷新只触发增量补偿；不会重复下载已同步历史邮件。
- 历史同步由用户选择账户、文件夹和时间范围后单独启动，按固定批次 FETCH，并展示已处理数、总数、当前账户/文件夹、开始时间、错误和阶段日志。
- 自动监听只同步元数据，不下载正文；历史同步也只下载元数据。正文仍按需加载。

## 5. 邮件正文安全

- HTML 正文必须在 Rust 侧或受控渲染层清理脚本、事件属性、危险协议和表单。
- 默认不加载远程图片和其他远程资源，避免阅读追踪。
- 链接点击前限制为 `http`、`https`、`mailto`，并在默认浏览器打开。
- 不允许邮件正文调用 aIdea IPC。
- 清理失败时显示纯文本正文，不把原始 HTML 直接交给 WebView。

## 6. 写信跳转

邮件详情页提供“网页邮箱”按钮，使用当前邮件所属账户的 `webmail_url` 在默认浏览器打开。第一阶段不拼接复杂收件人或主题参数，避免不同邮箱网页接口不一致；后续可按服务商增加安全的 compose URL 参数。

打开 URL 前只允许账户配置中保存的 `http` 或 `https` 地址，Rust 侧校验协议后调用 macOS 默认浏览器。

## 7. 前端结构

```text
shell-frontend/src/builtin-apps/mail-manager/
├── index.tsx
├── MailManagerPage.tsx
├── AccountDialog.tsx
├── MessageList.tsx
└── MessageDetail.tsx

shell-frontend/src/types/
└── mail.ts
```

页面采用紧凑的三段式工具布局：账户树、邮件列表、邮件详情。左侧账户树包含“全部收件箱”，以及每个账户下的收件箱和垃圾箱；中间列表在聚合视图中显示账户标识。工具栏展示监听状态、最后一次补偿结果，并提供手动增量刷新和历史同步入口。移动端不在本阶段单独适配，桌面 macOS 窗口优先。

### 7.1 列表分页与详情切换

- 邮件列表按当前账户、文件夹和搜索条件查询，每页默认 30 封；“加载更多”继续追加下一页。
- 列表 IPC 在同一次 SQLite 查询中返回当前页邮件和相同筛选条件下的总数，界面显示“已显示 X / 共 Y 封”。总数仅代表本地已同步的元数据，不发起额外 IMAP 请求。
- 用户选择邮件后，详情区域立即显示加载状态；正文读取完成后使用约 150ms 的淡入过渡展示。过渡只作用于详情容器，不改变邮件正文 iframe 的安全隔离方式。

## 8. 后续扩展边界

- `mail_rules`：按账户、发件人、主题和关键词判断重要邮件。
- 壳通知索引：邮件中心通过 IPC 提交重要邮件摘要，aIdea 壳负责系统通知和统一通知列表。
- 关键词统计：基于 `mail_messages` 和 `mail_bodies` 查询，不复制邮件数据。
- Gmail：新增 OAuth 授权流程，不修改现有 IMAP 账户表的基本身份结构。
