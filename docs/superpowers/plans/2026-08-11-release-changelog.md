# 统一更新日志 Implementation Plan

> **历史实施记录**：本文件只记录当时实现，不是当前平台契约。当前规则以仓库根目录 `AGENTS.md` 和 `docs/guide/` 为准。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 本次按用户约定在当前会话内执行，不自动 `git add`、commit、push 或创建 PR。

**Goal:** 增加本地更新日志页面，并让发布脚本把同一份版本文案写入应用更新提示和 Gitee Release。

**Architecture:** 以 `shell-frontend/src/data/changelog.json` 为唯一人工维护来源，前端直接导入展示；两个发布脚本用 Node 读取并校验目标版本，再生成 `latest.json.notes` 和 Gitee Release `body`。历史版本条目随应用包固化，不在运行时请求 Gitee。

**Tech Stack:** React 18、TypeScript、Vitest、Bash、Node.js JSON API、Tauri updater、Gitee Release API。

## Global Constraints

- 日志正文使用纯文本和换行，不新增 Markdown 渲染依赖。
- 每个版本只能出现一次，版本必须为 `X.Y.Z`，正文去除首尾空白后不得为空。
- 更新日志页面位于设置页“关于”分类上方，支持浅色和深色主题。
- `release.sh` 和 `resume-release.sh` 必须读取同一个日志文件，禁止回退到 `Release vX.Y.Z` 占位正文。
- 不自动执行 `git add`、commit、push 或创建 PR。

---

### Task 1: 建立版本日志数据与更新日志页面

**Files:**
- Create: `shell-frontend/src/data/changelog.json`
- Modify: `shell-frontend/src/components/SettingsPanel.tsx`
- Modify: `shell-frontend/tests/components/SettingsPanel.test.tsx`

**Interfaces:**
- `changelog.json` exports an array of `{ version: string; notes: string }` records ordered newest first.
- `SettingsPanel` adds `SettingsCategory` value `changelog` and renders `ChangelogSettings` before `AboutSettings`.

- [x] **Step 1: Write the failing UI test**

在现有 `SettingsPanel.test.tsx` 增加测试：点击“更新日志”后，断言 `v0.1.9`、对应正文和 `v0.1.8` 按数据顺序可见；保留现有关于页测试不变。

- [x] **Step 2: Run the focused test and verify it fails**

Run: `cd shell-frontend && npx vitest run tests/components/SettingsPanel.test.tsx`

Expected: FAIL，因为当前分类没有“更新日志”按钮和页面。

- [x] **Step 3: Add the changelog data**

创建 JSON，补齐 `v0.1.0` 至 `v0.1.9`。内容只依据提交记录整理；无法确认的改动写成“内部修复与稳定性改进”等概括性说明，不编造细节。

- [x] **Step 4: Implement the minimal page**

在 `SettingsPanel.tsx` 导入 JSON，增加 `changelog` 分类（使用现有 lucide 图标），实现 `ChangelogSettings`：遍历记录显示版本标题和 `whitespace-pre-wrap` 正文；JSON 为空时显示明确空状态。把分类放在 `about` 前面，不改变关于页已有更新检查逻辑。

- [x] **Step 5: Run the focused test and verify it passes**

Run: `cd shell-frontend && npx vitest run tests/components/SettingsPanel.test.tsx`

Expected: PASS。

### Task 2: 让发布脚本统一读取日志并强制校验

**Files:**
- Modify: `/Users/fourli/.codex/skills/aidea-release/scripts/release.sh`
- Modify: `/Users/fourli/.codex/skills/aidea-release/scripts/resume-release.sh`
- Modify: `/Users/fourli/.codex/skills/aidea-release/scripts/test-release-version-sync.sh`
- Modify: `/Users/fourli/.codex/skills/aidea-release/SKILL.md`
- Modify: `docs/release-updater.md`

**Interfaces:**
- Both scripts define `changelog_file="shell-frontend/src/data/changelog.json"`.
- Both scripts derive `release_notes` by parsing the JSON record matching `$target_version`; invalid/missing/duplicate/empty records exit non-zero before network or build work.

- [x] **Step 1: Extend the script contract test**

在 `test-release-version-sync.sh` 的 fixture 中创建 `shell-frontend/src/data/changelog.json`，增加静态断言检查两个脚本读取该路径、校验目标版本，并且生成 `notes: process.env.RELEASE_NOTES` 或等价的来源变量；增加缺少目标版本时发布提前失败的 fixture 检查。

- [x] **Step 2: Run the contract test and verify it fails**

Run: `bash /Users/fourli/.codex/skills/aidea-release/scripts/test-release-version-sync.sh`

Expected: FAIL，因为脚本当前没有日志文件路径、目标版本校验和统一正文。

- [x] **Step 3: Implement shared inline JSON validation in `release.sh`**

在确定 `target_version` 后、检查远端 tag 前读取 JSON；Node 校验数组结构、版本格式、重复版本和非空正文，并输出目标记录的 `notes` 到 shell 变量。将该变量用于生成 `latest.json.notes` 和 Gitee `body`，并把日志文件加入 `git add`。

- [x] **Step 4: Apply the same logic to `resume-release.sh`**

在读取目标版本后使用完全相同的文件路径和校验规则，生成补传用 `latest.json` 时使用同一 `release_notes`，创建缺失 Release 时也用它作为 `body`。

- [x] **Step 5: Add post-upload equality checks and document the rule**

扩展两个脚本的线上核验：解析 Raw `latest.json`，断言 `notes` 等于 `release_notes`；查询 Gitee Release 时断言 `body` 等于 `release_notes`。同步更新 Skill 和 `docs/release-updater.md`，写明日志文件是唯一人工来源、缺失日志禁止发布、补传不得使用占位文案。

- [x] **Step 6: Run script syntax and contract tests**

Run:

```bash
bash /Users/fourli/.codex/skills/aidea-release/scripts/test-release-version-sync.sh
bash -n /Users/fourli/.codex/skills/aidea-release/scripts/release.sh
bash -n /Users/fourli/.codex/skills/aidea-release/scripts/resume-release.sh
```

Expected: 全部退出码为 0。

### Task 3: 完成仓库级验证

**Files:**
- No additional files.

- [x] **Step 1: Check formatting and repository diff**

Run: `git diff --check`，并检查变更只涉及日志、设置页、测试、发布脚本和发布文档。

- [x] **Step 2: Run frontend verification**

Run: `cd shell-frontend && npm run lint && npm test && npm run build`

Expected: 全部通过；既有 React/JSDOM 警告若不影响退出码，记录为非阻断项。

- [x] **Step 3: Run Rust verification**

Run: `cd shell-native && cargo test`

Expected: 全部通过。此次不修改 Rust，因此不增加 Rust 测试。
