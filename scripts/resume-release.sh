#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

target_version="${1:-}"
target_version="${target_version#v}"
[[ "$target_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "用法：bash resume-release.sh X.Y.Z" >&2
  exit 1
}
tag="v$target_version"

[[ "$(git branch --show-current)" == "main" ]] || { echo "错误：必须在 main 分支补传。" >&2; exit 1; }
git rev-parse --verify --quiet "refs/tags/$tag" >/dev/null || {
  echo "错误：本地 tag $tag 不存在。" >&2
  exit 1
}
[[ "$(git rev-parse "$tag^{commit}")" == "$(git rev-parse HEAD)" ]] || {
  echo "错误：$tag 不指向当前提交，拒绝使用当前构建产物补传。" >&2
  exit 1
}

origin_url="$(git config --get remote.origin.url || true)"
[[ "$origin_url" =~ (gitee\.com[:/])[^/]+/[^/]+(\.git)?$ ]] || {
  echo "错误：origin 必须指向 Gitee 仓库。" >&2
  exit 1
}

tauri_file="shell-native/tauri.conf.json"
current_version="$(node -p "require('./$tauri_file').version")"
product_name="$(node -p "require('./$tauri_file').productName")"
[[ "$current_version" == "$target_version" && -n "$product_name" ]] || {
  echo "错误：当前应用版本或产品名与补传目标不一致。" >&2
  exit 1
}
changelog_file="shell-frontend/src/data/changelog.json"
release_notes="$(node -e '
const fs = require("fs");
const [file, targetVersion] = process.argv.slice(1);
const fail = (message) => { console.error(`错误：${message}`); process.exit(1); };
let entries;
try { entries = JSON.parse(fs.readFileSync(file, "utf8")); } catch { fail(`无法读取更新日志：${file}`); }
if (!Array.isArray(entries)) fail("更新日志必须是数组。");
const versions = new Set();
for (const entry of entries) {
  if (!entry || typeof entry.version !== "string" || typeof entry.notes !== "string") fail("更新日志条目格式无效。");
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(entry.version)) fail(`更新日志版本格式无效：${entry.version}`);
  if (versions.has(entry.version)) fail(`更新日志版本重复：${entry.version}`);
  if (!entry.notes.trim()) fail(`更新日志正文为空：${entry.version}`);
  versions.add(entry.version);
}
const entry = entries.find((item) => item.version === targetVersion);
if (!entry) fail(`缺少版本 ${targetVersion} 的更新日志`);
process.stdout.write(entry.notes);
' "$changelog_file" "$target_version")"

if [[ -z "${GITEE_TOKEN:-}" ]]; then
  command -v security >/dev/null 2>&1 || {
    echo "错误：缺少 GITEE_TOKEN，且当前系统无法读取 macOS 钥匙串。" >&2
    exit 1
  }
  export GITEE_TOKEN="$(security find-generic-password -a "$USER" -s "aidea-gitee-release-token" -w 2>/dev/null || true)"
fi
[[ -n "${GITEE_TOKEN:-}" ]] || {
  echo "错误：缺少 GITEE_TOKEN。请先写入钥匙串，或在当前终端设置该变量。" >&2
  exit 1
}

dmg="shell-native/target/release/bundle/dmg/${product_name}_${target_version}_aarch64.dmg"
updater_archive="shell-native/target/release/bundle/macos/${product_name}.app.tar.gz"
updater_signature="${updater_archive}.sig"
[[ -f "$dmg" && -f "$updater_archive" && -f "$updater_signature" ]] || {
  echo "错误：缺少本地发布产物，不能补传。" >&2
  exit 1
}

repo="$(git config --get remote.origin.url | sed -E 's#git@gitee\.com:##; s#https://gitee\.com/##; s#\.git$##')"
gitee_api="https://gitee.com/api/v5/repos/$repo/releases"
gitee_release_url="https://gitee.com/$repo/releases/download/$tag"
updater_manifest="updater/latest.json"
expected_updater_endpoint="https://gitee.com/$repo/raw/main/$updater_manifest"
release_json="$(curl --fail --silent --show-error "$gitee_api/tags/$tag")" || {
  echo "错误：无法查询 Gitee Release。" >&2
  exit 1
}
release_id="$(node -e 'const r=JSON.parse(process.argv[1]); if (r?.id) process.stdout.write(String(r.id));' "$release_json")"
if [[ -z "$release_id" ]]; then
  release_json="$(curl --fail --silent --show-error --request POST "$gitee_api" \
    --data-urlencode "access_token=$GITEE_TOKEN" \
    --data-urlencode "tag_name=$tag" \
    --data-urlencode "name=Release $tag" \
    --data-urlencode "body=$release_notes" \
    --data-urlencode "target_commitish=main")" || {
    echo "错误：无法创建 Gitee Release。" >&2
    exit 1
  }
  release_id="$(node -e 'const r=JSON.parse(process.argv[1]); if (r?.id) process.stdout.write(String(r.id));' "$release_json")"
  [[ -n "$release_id" ]] || {
    release_error="$(node -e 'try { const release=JSON.parse(process.argv[1]); process.stdout.write(String(release.message || release.error || "响应未包含 Release ID").replace(/\s+/g, " ").slice(0, 500)); } catch { process.stdout.write("Gitee 返回了无效响应"); }' "$release_json")"
    echo "错误：Gitee Release 创建失败：$release_error" >&2
    exit 1
  }
fi

release_dir="$(mktemp -d)"
latest_json="$release_dir/latest.json"
cleanup() {
  rm -rf "$release_dir"
}
trap cleanup EXIT
export VERSION="$target_version"
export TAG="$tag"
export URL="$gitee_release_url/$(basename "$updater_archive")"
export SIGNATURE="$(<"$updater_signature")"
export RELEASE_NOTES="$release_notes"
node -e 'console.log(JSON.stringify({version: process.env.VERSION, notes: process.env.RELEASE_NOTES, pub_date: new Date().toISOString(), platforms: {"darwin-aarch64": {url: process.env.URL, signature: process.env.SIGNATURE}}}, null, 2))' > "$latest_json"

upload_release_asset() {
  curl --fail --silent --show-error --request POST "$gitee_api/$release_id/attach_files" \
    --form "access_token=$GITEE_TOKEN" \
    --form "file=@$1" >/dev/null
}
asset_exists() {
  node -e 'const r=JSON.parse(process.argv[1]); process.exit((r.assets || []).some(a => a.name === process.argv[2]) ? 0 : 1)' \
    "$release_json" "$(basename "$1")"
}
verify_online_release() {
  release_json="$(curl --fail --silent --show-error --get "$gitee_api/tags/$tag" \
    --data-urlencode "access_token=$GITEE_TOKEN")" || {
    echo "错误：无法核验线上 Gitee Release 附件。" >&2
    return 1
  }
  node -e 'try { const release=JSON.parse(process.argv[1]); const expected=process.argv.slice(2); const notes=expected.pop(); const names=new Set((release.assets || []).map(asset => asset.name)); if (release.body !== notes || !expected.every(name => names.has(name))) process.exit(1); } catch { process.exit(1); }' \
    "$release_json" "$(basename "$dmg")" "$(basename "$updater_archive")" "$(basename "$updater_signature")" "$(basename "$latest_json")" "$release_notes" || {
    echo "错误：线上 Gitee Release 附件或更新日志不一致。" >&2
    return 1
  }

  local manifest
  for attempt in 1 2 3 4 5; do
    if manifest="$(curl --fail --silent --location "$expected_updater_endpoint" 2>/dev/null)" \
      && node -e 'try { const manifest=JSON.parse(process.argv[1]); const platform=manifest.platforms?.["darwin-aarch64"]; if (manifest.version !== process.argv[2] || platform?.url !== process.argv[3] || platform?.signature !== process.argv[4] || manifest.notes !== process.argv[5]) process.exit(1); } catch { process.exit(1); }' \
        "$manifest" "$target_version" "$URL" "$SIGNATURE" "$release_notes"; then
      return 0
    fi
    [[ "$attempt" == 5 ]] || sleep 2
  done
  echo "错误：线上更新清单校验失败。" >&2
  return 1
}

for asset in "$dmg" "$updater_archive" "$updater_signature" "$latest_json"; do
  asset_exists "$asset" || upload_release_asset "$asset" || {
    echo "错误：Gitee Release 附件上传失败：$(basename "$asset")" >&2
    exit 1
  }
done
verify_online_release

echo "Release 补传完成：$tag"
echo "Release：https://gitee.com/$repo/releases/tag/$tag"
