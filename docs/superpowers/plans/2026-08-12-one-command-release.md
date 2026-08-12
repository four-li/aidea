# 一键发布实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 aIdea 发布收敛为仓库内的一条自动化命令，并用它发布 `0.1.11`。

**Architecture:** `scripts/release.sh` 成为唯一发布实现，先进行无副作用预检，再暂存生成版本和更新日志、验证构建，最后提交、tag、推送及上传。Skill 仅保留调用约定；补传脚本只处理已推送 tag 的 Release 附件恢复。

**Tech Stack:** Bash、Node.js、Git、Cargo/Tauri、Gitee API。

## Global Constraints

- 仅发布 macOS Apple Silicon（arm64）。
- 发布前不要求人工 `git add`、commit、改版本或写更新日志。
- 未推送前失败必须保留用户改动并还原脚本生成文件。
- 不使用 Terminal.app、临时脚本副本或 ChatGPT.app 专有工具路径。

---

### Task 1: 建立仓库内发布入口

**Files:**
- Create: `scripts/release.sh`
- Create: `scripts/resume-release.sh`
- Create: `scripts/test-release.sh`
- Modify: `.codex/skills/aidea-release/SKILL.md`

- [ ] **Step 1: 写入自动版本与更新日志的失败用例**
- [ ] **Step 2: 运行用例，确认旧发布脚本不满足自动化契约**
- [ ] **Step 3: 实现仓库内单一发布脚本和补传脚本**
- [ ] **Step 4: 运行发布脚本自检与 shell 语法检查**

### Task 2: 将当前工作区接入自动提交边界

**Files:**
- Modify: `scripts/release.sh`
- Modify: `scripts/test-release.sh`

- [ ] **Step 1: 覆盖风险文件拒绝、正常未跟踪文件纳入和失败恢复**
- [ ] **Step 2: 运行测试，确认旧逻辑不满足行为**
- [ ] **Step 3: 实现预检、自动暂存、失败还原和两次发布提交**
- [ ] **Step 4: 运行脚本自检**

### Task 3: 发布 `0.1.11`

**Files:**
- Modify: 发布脚本自动生成的版本、更新日志和 `updater/latest.json`

- [ ] **Step 1: 从正常 macOS 终端运行 `bash scripts/release.sh 0.1.11`**
- [ ] **Step 2: 核验 Gitee tag、Release、四个附件和 Raw 更新清单**
- [ ] **Step 3: 从已安装旧版检查更新**
