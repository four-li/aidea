#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
release_script="$repo_root/scripts/release.sh"
release_docs=(
  "$repo_root/.codex/skills/aidea-release/SKILL.md"
  "$repo_root/docs/release-updater.md"
  "$repo_root/README.md"
)
skill_prompt="$repo_root/.codex/skills/aidea-release/agents/openai.yaml"

[[ -x "$release_script" ]] || {
  echo "错误：缺少可执行的仓库发布入口 scripts/release.sh。" >&2
  exit 1
}

grep -Fq -- 'prepare_only=false' "$release_script" || {
  echo "错误：发布脚本必须支持无副作用的 --prepare-only 自检。" >&2
  exit 1
}
grep -Fq -- 'git add -A' "$release_script" || {
  echo "错误：发布脚本必须自动纳入正常的当前工作区改动。" >&2
  exit 1
}
grep -Fq -- '自动生成的维护性更新。' "$release_script" || {
  echo "错误：发布脚本必须自动生成用户更新说明。" >&2
  exit 1
}
grep -Fq -- 'command -v' "$release_script" || {
  echo "错误：发布脚本必须在构建前检查工具。" >&2
  exit 1
}
if grep -En '\|[[:space:]]*grep[[:space:]]+-[^[:space:]]*q' "$release_script" >/dev/null; then
  echo "错误：发布脚本不得在 pipefail 下使用管道 grep -q。" >&2
  exit 1
fi
grep -Fq -- 'release_lock_dir/pid' "$release_script" || {
  echo "错误：发布脚本必须能清理强制终止后遗留的发布锁。" >&2
  exit 1
}
grep -Fq -- 'rm -f "$release_lock_dir/pid"' "$release_script" || {
  echo "错误：发布脚本必须在退出时删除发布锁的 pid 文件。" >&2
  exit 1
}
if grep -Fq -- 'v*|[0-9]*.[0-9]*.[0-9]*' "$release_script"; then
  echo "错误：正常发布不得允许手工指定版本号。" >&2
  exit 1
fi

for document in "${release_docs[@]}"; do
  grep -Fq -- 'bash scripts/release.sh' "$document" || {
    echo "错误：发布资料必须指向仓库唯一入口：$document" >&2
    exit 1
  }
done
grep -Fq -- 'Gitee' "$skill_prompt" || {
  echo "错误：发布 Skill 的默认提示必须指向 Gitee。" >&2
  exit 1
}
if grep -Eiq 'GitHub DMG|aidea-release/scripts|\$CODEX_HOME/skills/aidea-release|iTerm2|Terminal\.app|prepare release|当前工作区路径' "${release_docs[@]}" "$skill_prompt"; then
  echo "错误：发布资料仍包含已废弃的发布路径。" >&2
  exit 1
fi

echo "发布脚本入口检查通过。"
