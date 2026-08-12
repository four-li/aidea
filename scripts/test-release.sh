#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
release_script="$repo_root/scripts/release.sh"

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

echo "发布脚本入口检查通过。"
