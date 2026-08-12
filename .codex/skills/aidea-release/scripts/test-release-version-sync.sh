#!/usr/bin/env bash
set -euo pipefail

skill_dir="$(cd "$(dirname "$0")/.." && pwd)"
skill_file="$skill_dir/SKILL.md"
resume_script="$skill_dir/scripts/resume-release.sh"
fixture="$(mktemp -d)"
tool_bin="$(mktemp -d)"
cleanup() {
  rm -rf "$fixture"
  rm -rf "$tool_bin"
}
trap cleanup EXIT

rg -q 'product_name=.*productName' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须从 tauri.conf.json 读取产品名。" >&2
  exit 1
}
rg -Fq 'signing_key_file="aidea-updater.key"' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须从本地私钥文件加载签名私钥。" >&2
  exit 1
}
rg -Fq 'release_lock_dir="/private/tmp/aidea-release.lock"' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须防止并发发布。" >&2
  exit 1
}
rg -Fq 'updater_archive="shell-native/target/release/bundle/macos/${product_name}.app.tar.gz"' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须精确校验当前产品的 updater 产物。" >&2
  exit 1
}
rg -Fq 'GITEE_TOKEN' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须要求 GITEE_TOKEN 上传 Gitee Release。" >&2
  exit 1
}
rg -Fq 'updater_manifest="updater/latest.json"' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须生成固定路径的 updater 清单。" >&2
  exit 1
}
for script in "$skill_dir/scripts/release.sh" "$resume_script"; do
  rg -Fq 'changelog_file="shell-frontend/src/data/changelog.json"' "$script" || {
    echo "错误：发布脚本必须读取统一更新日志。" >&2
    exit 1
  }
  rg -Fq 'body=$release_notes' "$script" || {
    echo "错误：Gitee Release 必须使用统一更新日志正文。" >&2
    exit 1
  }
done
rg -Fq 'git add "$tauri_file" "$cargo_file" "$frontend_file" "$lock_file" "$updater_manifest" "$changelog_file"' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布提交必须包含 updater 清单和更新日志。" >&2
  exit 1
}
rg -Fq 'cp "$latest_json" "$updater_manifest"' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须在提交前同步生成的 updater 清单。" >&2
  exit 1
}
rg -Fq 'attach_files' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须上传 Gitee Release 附件。" >&2
  exit 1
}
rg -Fq 'Gitee Release 创建失败：' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须显示 Gitee Release 创建失败原因。" >&2
  exit 1
}
rg -Fq 'notes: process.env.RELEASE_NOTES' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须将统一更新日志写入 updater 清单。" >&2
  exit 1
}
rg -Fq 'https://gitee.com/api/v5/user' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须在构建前验证 Gitee Token。" >&2
  exit 1
}
rg -Fq 'verify_bundled_updater_endpoint()' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须校验最终 .app 二进制中的 updater 地址。" >&2
  exit 1
}
rg -Fq 'legacy_updater_endpoint=' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须拒绝最终二进制中的旧 Gitee updater 地址。" >&2
  exit 1
}
rg -Fq 'verify_online_release()' "$skill_dir/scripts/release.sh" || {
  echo "错误：发布脚本必须在上传后校验线上更新清单和附件。" >&2
  exit 1
}
[[ -f "$resume_script" ]] || {
  echo "错误：发布 Skill 必须提供已推送 tag 后的 Release 补传脚本。" >&2
  exit 1
}
rg -Fq 'git rev-parse --verify --quiet "refs/tags/$tag"' "$resume_script" || {
  echo "错误：补传脚本必须校验既有 tag。" >&2
  exit 1
}
rg -Fq 'attach_files' "$resume_script" || {
  echo "错误：补传脚本必须上传缺失的 Gitee Release 附件。" >&2
  exit 1
}
rg -Fq 'r.assets' "$resume_script" || {
  echo "错误：补传脚本必须按 Gitee 的 assets 字段判断已上传附件。" >&2
  exit 1
}
rg -Fq 'Gitee Release 创建失败：' "$resume_script" || {
  echo "错误：补传脚本必须显示 Gitee Release 创建失败原因。" >&2
  exit 1
}
rg -Fq 'notes: process.env.RELEASE_NOTES' "$resume_script" || {
  echo "错误：补传脚本必须将统一更新日志写入 updater 清单。" >&2
  exit 1
}
rg -Fq 'latest_json="$release_dir/latest.json"' "$resume_script" || {
  echo "错误：补传脚本必须用固定名称校验 latest.json 是否已上传。" >&2
  exit 1
}
rg -Fq 'verify_online_release()' "$resume_script" || {
  echo "错误：补传脚本必须在结束前校验线上更新清单和附件。" >&2
  exit 1
}
rg -Fq '| 现象 | 根因 | 固定处理 |' "$skill_file" || {
  echo "错误：发布 Skill 必须提供已验证故障的速查表。" >&2
  exit 1
}
for known_pitfall in 'HTTP 400' 'formData' 'body' 'assets' '假阴性' 'curl -L' 'Husky' 'CodeMirror' '不需要补传' 'releases/latest/download/latest.json' 'foruda.gitee.com' 'codesign --verify' '最终二进制'; do
  rg -Fq "$known_pitfall" "$skill_file" || {
    echo "错误：发布 Skill 缺少已验证的坑：$known_pitfall" >&2
    exit 1
  }
done

for required_rule in \
  '不得在脚本外单独探测' \
  '不要把钥匙串探测失败当成凭据不存在' \
  '/Users/fourli/.codex/skills/aidea-release/scripts/test-release-version-sync.sh' \
  '/Users/fourli/.codex/skills/aidea-release/scripts/release.sh'; do
  rg -Fq "$required_rule" "$skill_file" || {
    echo "错误：发布 Skill 缺少固定执行规则：$required_rule" >&2
    exit 1
  }
done

mkdir -p "$fixture/shell-native" "$fixture/shell-frontend/src/data" "$fixture/updater"
cat > "$fixture/shell-native/tauri.conf.json" <<'EOF'
{"productName":"开搞","version":"0.1.4","bundle":{"createUpdaterArtifacts":true},"plugins":{"updater":{"pubkey":"public-key","endpoints":["https://gitee.com/fixture/aidea/raw/main/updater/latest.json"]}}}
EOF
cat > "$fixture/shell-native/Cargo.toml" <<'EOF'
[package]
name = "fixture"
version = "0.1.0"
EOF
cat > "$fixture/shell-frontend/package.json" <<'EOF'
{"version":"0.1.4"}
EOF
cat > "$fixture/shell-frontend/package-lock.json" <<'EOF'
{"version":"0.1.4","packages":{"":{"version":"0.1.4"}}}
EOF
cat > "$fixture/updater/latest.json" <<'EOF'
{"version":"0.1.4","platforms":{"darwin-aarch64":{"url":"https://example.invalid/app.tar.gz","signature":"fixture"}}}
EOF
cat > "$fixture/shell-frontend/src/data/changelog.json" <<'EOF'
[{"version":"0.1.5","notes":"更新说明"}]
EOF

git -C "$fixture" init --initial-branch=main --quiet
git -C "$fixture" config user.email fixture@example.invalid
git -C "$fixture" config user.name fixture
git -C "$fixture" add .
git -C "$fixture" commit --quiet -m fixture
git -C "$fixture" remote add origin git@gitee.com:fixture/aidea.git

set +e
result="$(cd "$fixture" && bash "$skill_dir/scripts/release.sh" 0.1.5 2>&1)"
status=$?
set -e

[[ $status -ne 0 ]] || { echo "错误：版本不一致时发布脚本不应继续。" >&2; exit 1; }
[[ "$result" == *"四个版本文件版本不一致"* ]] || {
  echo "错误：发布脚本未在联网前报告四个版本文件不一致。" >&2
  exit 1
}

cat > "$fixture/shell-native/Cargo.toml" <<'EOF'
[package]
name = "fixture"
version = "0.1.4"
EOF
git -C "$fixture" add shell-native/Cargo.toml
git -C "$fixture" commit --quiet -m aligned

cat > "$fixture/shell-frontend/src/data/changelog.json" <<'EOF'
[]
EOF
git -C "$fixture" add shell-frontend/src/data/changelog.json
git -C "$fixture" commit --quiet -m missing-changelog
set +e
result="$(cd "$fixture" && TAURI_SIGNING_PRIVATE_KEY=test-key bash "$skill_dir/scripts/release.sh" 0.1.5 2>&1)"
status=$?
set -e

[[ $status -ne 0 ]] || { echo "错误：缺少目标版本更新日志时发布脚本不应继续。" >&2; exit 1; }
[[ "$result" == *"缺少版本 0.1.5 的更新日志"* ]] || {
  echo "错误：发布脚本未在联网前报告缺少目标版本更新日志。" >&2
  exit 1
}

cat > "$fixture/shell-frontend/src/data/changelog.json" <<'EOF'
[{"version":"0.1.5","notes":"更新说明"}]
EOF
git -C "$fixture" add shell-frontend/src/data/changelog.json
git -C "$fixture" commit --quiet -m restored-changelog

git_bin="$(command -v git)"
cat > "$tool_bin/git" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == "ls-remote" ]]; then
  echo "错误：缺少发布凭据时不应访问远端。" >&2
  exit 99
fi
exec "$git_bin" "\$@"
EOF
chmod +x "$tool_bin/git"

set +e
result="$(cd "$fixture" && PATH="$tool_bin:$PATH" env -u TAURI_SIGNING_PRIVATE_KEY bash "$skill_dir/scripts/release.sh" 0.1.5 2>&1)"
status=$?
set -e

[[ $status -ne 0 ]] || { echo "错误：缺少私钥时发布脚本不应继续。" >&2; exit 1; }
[[ "$result" == *"缺少 updater 私钥"* ]] || {
  echo "错误：发布脚本未在联网前报告缺少 updater 私钥。" >&2
  exit 1
}

set +e
result="$(cd "$fixture" && PATH="$tool_bin:$PATH" env -u GITEE_TOKEN TAURI_SIGNING_PRIVATE_KEY=test-key bash "$skill_dir/scripts/release.sh" 0.1.5 2>&1)"
status=$?
set -e

[[ $status -ne 0 ]] || { echo "错误：缺少 GITEE_TOKEN 时发布脚本不应继续。" >&2; exit 1; }
[[ "$result" == *"缺少 GITEE_TOKEN"* ]] || {
  echo "错误：发布脚本未在联网前报告缺少 GITEE_TOKEN。" >&2
  exit 1
}

cat > "$tool_bin/security" <<'EOF'
#!/usr/bin/env bash
if [[ "$1" == "find-generic-password" && "$2" == "-a" && "$4" == "-s" && "$5" == "aidea-gitee-release-token" && "$6" == "-w" ]]; then
  printf 'fixture-token'
  exit 0
fi
exit 1
EOF
chmod +x "$tool_bin/security"

curl_bin="$(command -v curl)"
cat > "$tool_bin/curl" <<EOF
#!/usr/bin/env bash
if [[ "\$*" == *"https://gitee.com/api/v5/user"* ]]; then
  printf '{"id":1}'
  exit 0
fi
exec "$curl_bin" "\$@"
EOF
chmod +x "$tool_bin/curl"

set +e
result="$(cd "$fixture" && PATH="$tool_bin:$PATH" env -u GITEE_TOKEN TAURI_SIGNING_PRIVATE_KEY=test-key bash "$skill_dir/scripts/release.sh" 0.1.5 2>&1)"
status=$?
set -e

[[ $status -ne 0 ]] || { echo "错误：远端校验失败时发布脚本不应继续。" >&2; exit 1; }
[[ "$result" == *"无法检查远端 tag"* ]] || {
  echo "错误：发布脚本未从钥匙串读取 GITEE_TOKEN 后继续发布。" >&2
  exit 1
}
