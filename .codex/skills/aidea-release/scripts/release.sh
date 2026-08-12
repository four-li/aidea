#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

release_lock_dir="/private/tmp/aidea-release.lock"
if ! mkdir "$release_lock_dir" 2>/dev/null; then
  echo "错误：已有发布流程正在运行，请等待其完成后再试。" >&2
  exit 1
fi
cleanup_lock() {
  rmdir "$release_lock_dir" 2>/dev/null || true
}
trap cleanup_lock EXIT

target_version="${1:-}"
if [[ -n "$target_version" ]]; then
  target_version="${target_version#v}"
fi

[[ "$(git branch --show-current)" == "main" ]] || { echo "错误：必须在 main 分支发布。" >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "错误：工作区不干净，请先提交功能代码。" >&2; exit 1; }

origin_url="$(git config --get remote.origin.url || true)"
[[ "$origin_url" =~ (gitee\.com[:/])[^/]+/[^/]+(\.git)?$ ]] || {
  echo "错误：origin 必须指向 Gitee 仓库，当前为：$origin_url" >&2
  exit 1
}
repo="$(git config --get remote.origin.url | sed -E 's#git@gitee\.com:##; s#https://gitee\.com/##; s#\.git$##')"
gitee_api="https://gitee.com/api/v5/repos/$repo/releases"

tauri_file="shell-native/tauri.conf.json"
 cargo_file="shell-native/Cargo.toml"
frontend_file="shell-frontend/package.json"
lock_file="shell-frontend/package-lock.json"
updater_manifest="updater/latest.json"
changelog_file="shell-frontend/src/data/changelog.json"
current_tauri="$(node -p "require('./$tauri_file').version")"
product_name="$(node -p "require('./$tauri_file').productName")"
current_cargo="$(sed -nE 's/^version = "([0-9]+\.[0-9]+\.[0-9]+)"$/\1/p' "$cargo_file" | head -1)"
current_frontend="$(node -p "require('./$frontend_file').version")"
current_lock="$(node -e "const lock=require('./$lock_file'); process.stdout.write(lock.version === lock.packages?.['']?.version ? lock.version : '')")"
[[ "$current_tauri" == "$current_cargo" && "$current_tauri" == "$current_frontend" && "$current_tauri" == "$current_lock" && "$current_tauri" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "错误：四个版本文件版本不一致或不是 X.Y.Z。" >&2; exit 1;
}
[[ -n "$product_name" ]] || { echo "错误：tauri.conf.json 缺少 productName。" >&2; exit 1; }
node -e "const c=require('./$tauri_file'); if (!c.bundle.createUpdaterArtifacts || !c.plugins?.updater?.pubkey || !c.plugins.updater.endpoints?.[0]) process.exit(1)" || {
  echo "错误：updater 公钥、更新源或更新产物配置缺失。" >&2; exit 1;
}
expected_updater_endpoint="https://gitee.com/$repo/raw/main/$updater_manifest"
node -e "const c=require('./$tauri_file'); if (c.plugins.updater.endpoints[0] !== process.argv[1]) process.exit(1)" "$expected_updater_endpoint" || {
  echo "错误：updater 必须使用 Gitee Raw 的固定 latest.json 地址。" >&2; exit 1;
}
[[ -f "$updater_manifest" ]] || {
  echo "错误：缺少 updater 清单：$updater_manifest" >&2; exit 1;
}
if [[ -z "$target_version" ]]; then
  IFS=. read -r major minor patch <<< "$current_tauri"
  target_version="$major.$minor.$((patch + 1))"
fi
[[ "$target_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "错误：版本必须是 X.Y.Z。" >&2; exit 1; }
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
tag="v$target_version"
gitee_release_url="https://gitee.com/$repo/releases/download/$tag"
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  signing_key_file="aidea-updater.key"
  [[ -f "$signing_key_file" ]] || {
    echo "错误：缺少 updater 私钥。请在仓库根目录放置 aidea-updater.key，或设置 TAURI_SIGNING_PRIVATE_KEY。" >&2
    exit 1
  }
  export TAURI_SIGNING_PRIVATE_KEY="$(<"$signing_key_file")"
fi
[[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]] || {
  echo "错误：缺少 updater 私钥。" >&2
  exit 1
}
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
gitee_user="$(curl --fail --silent --show-error --get 'https://gitee.com/api/v5/user' \
  --data-urlencode "access_token=$GITEE_TOKEN")" || {
  echo "错误：Gitee Token 无效，无法开始发布。" >&2
  exit 1
}
node -e 'const user=JSON.parse(process.argv[1]); if (!user.id) process.exit(1)' "$gitee_user" || {
  echo "错误：Gitee Token 验证响应无效，无法开始发布。" >&2
  exit 1
}

if git show-ref --tags --verify --quiet "refs/tags/$tag"; then
  echo "错误：本地 tag $tag 已存在。" >&2
  exit 1
else
  local_tag_status=$?
  [[ "$local_tag_status" == 1 ]] || { echo "错误：无法检查本地 tag。" >&2; exit 1; }
fi
remote_tag_ref="$(git ls-remote --tags origin "refs/tags/$tag" 2>/dev/null)" || {
  echo "错误：无法检查远端 tag，请检查网络和 Git 凭据。" >&2
  exit 1
}
if [[ -n "$remote_tag_ref" ]]; then
  echo "错误：远端 tag $tag 已存在。" >&2
  exit 1
fi

if command -v hdiutil >/dev/null 2>&1 && hdiutil info 2>/dev/null | grep -qE '/Volumes/aIdea(/|$)'; then
  echo "错误：检测到已挂载的 /Volumes/aIdea，请先在 Finder 推出该磁盘映像。" >&2
  exit 1
fi

scan_args=(--files-with-matches --hidden --glob '!.git/**' --glob '!shell-frontend/node_modules/**' --glob '!shell-native/target/**' --glob '!README.md' --glob '!docs/guide/aidea-official-app.md')
path_scan_args=(--files-with-matches --hidden --glob '!.git/**' --glob '!shell-frontend/node_modules/**' --glob '!shell-native/target/**' --glob '!README.md' --glob '!docs/**' --glob '!.codex/**')
personal_home="/Users/${USER}/"
if rg "${scan_args[@]}" '(sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]+|-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY-----)' . \
  || rg "${path_scan_args[@]}" --fixed-strings "$personal_home" .; then
  echo "错误：发现疑似密钥或个人绝对路径，已停止发布。" >&2
  exit 1
fi

npm ci --prefix shell-frontend
npm test --prefix shell-frontend
npm run build --prefix shell-frontend
(cd shell-native && cargo test)

# 仅在所有常规验证通过后改版本；任何失败都恢复脚本自己改过的文件。
backup_dir="$(mktemp -d)"
cp "$tauri_file" "$backup_dir/tauri.conf.json"
cp "$cargo_file" "$backup_dir/Cargo.toml"
cp "$frontend_file" "$backup_dir/package.json"
cp "$lock_file" "$backup_dir/package-lock.json"
cp "$updater_manifest" "$backup_dir/latest.json"
build_marker="$(mktemp)"
release_dir="$(mktemp -d)"
release_committed=false
cleanup() {
  status=$?
  if [[ "$release_committed" == false ]]; then
    cp "$backup_dir/tauri.conf.json" "$tauri_file"
    cp "$backup_dir/Cargo.toml" "$cargo_file"
    cp "$backup_dir/package.json" "$frontend_file"
    cp "$backup_dir/package-lock.json" "$lock_file"
    cp "$backup_dir/latest.json" "$updater_manifest"
  fi
  rm -rf "$backup_dir"
  rm -f "$build_marker"
  rm -rf "$release_dir"
  rmdir "$release_lock_dir" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

node -e "const fs=require('fs'); const p='$tauri_file'; const v=JSON.parse(fs.readFileSync(p)); v.version='$target_version'; fs.writeFileSync(p, JSON.stringify(v, null, 2)+'\\n')"
node -e "const fs=require('fs'); const p='$cargo_file'; const source=fs.readFileSync(p,'utf8'); const next=source.replace(/^version = \"[0-9]+\\.[0-9]+\\.[0-9]+\"$/m, 'version = \"$target_version\"'); fs.writeFileSync(p,next)"
node -e "const fs=require('fs'); const p='$frontend_file'; const v=JSON.parse(fs.readFileSync(p)); v.version='$target_version'; fs.writeFileSync(p, JSON.stringify(v, null, 2)+'\\n')"
node -e "const fs=require('fs'); const p='$lock_file'; const v=JSON.parse(fs.readFileSync(p)); v.version='$target_version'; v.packages[''].version='$target_version'; fs.writeFileSync(p, JSON.stringify(v, null, 2)+'\\n')"
updated_tauri="$(node -p "require('./$tauri_file').version")"
updated_cargo="$(sed -nE 's/^version = "([0-9]+\.[0-9]+\.[0-9]+)"$/\1/p' "$cargo_file" | head -1)"
updated_frontend="$(node -p "require('./$frontend_file').version")"
updated_lock="$(node -e "const lock=require('./$lock_file'); process.stdout.write(lock.version === lock.packages?.['']?.version ? lock.version : '')")"
[[ "$updated_tauri" == "$target_version" && "$updated_cargo" == "$target_version" && "$updated_frontend" == "$target_version" && "$updated_lock" == "$target_version" ]] || {
  echo "错误：版本文件未正确更新到 $target_version。" >&2
  exit 1
}
# 防止旧签名文件被误认作本次构建的 updater 产物。
touch "$build_marker"
(cd shell-native && CI=true ../shell-frontend/node_modules/.bin/tauri build --bundles app,dmg)

dmg="shell-native/target/release/bundle/dmg/${product_name}_${target_version}_aarch64.dmg"
[[ -f "$dmg" ]] || { echo "错误：未找到 DMG：$dmg" >&2; exit 1; }
updater_archive="shell-native/target/release/bundle/macos/${product_name}.app.tar.gz"
updater_signature="${updater_archive}.sig"
[[ -f "$updater_archive" && "$updater_archive" -nt "$build_marker" ]] || {
  echo "错误：未找到本次构建的 updater 安装包：$updater_archive" >&2; exit 1;
}
[[ -f "$updater_signature" && "$updater_signature" -nt "$build_marker" ]] || {
  echo "错误：未找到本次构建的 updater 签名：$updater_signature" >&2; exit 1;
}
verify_bundled_updater_endpoint() {
  local bundled_binary="shell-native/target/release/bundle/macos/${product_name}.app/Contents/MacOS/aidea-shell"
  local legacy_updater_endpoint="https://gitee.com/$repo/releases/latest/download/latest.json"

  [[ -f "$bundled_binary" ]] || {
    echo "错误：未找到最终应用二进制：$bundled_binary" >&2
    return 1
  }
  strings "$bundled_binary" | rg -F "$expected_updater_endpoint" >/dev/null || {
    echo "错误：最终二进制未嵌入 Gitee Raw updater 地址。" >&2
    return 1
  }
  if strings "$bundled_binary" | rg -F "$legacy_updater_endpoint" >/dev/null; then
    echo "错误：最终二进制仍包含旧 Gitee updater 地址。" >&2
    return 1
  fi
}
verify_bundled_updater_endpoint

latest_json="$release_dir/latest.json"
export VERSION="$target_version"
export TAG="$tag"
export URL="$gitee_release_url/$(basename "$updater_archive")"
export SIGNATURE="$(<"$updater_signature")"
export RELEASE_NOTES="$release_notes"
node -e 'console.log(JSON.stringify({version: process.env.VERSION, notes: process.env.RELEASE_NOTES, pub_date: new Date().toISOString(), platforms: {"darwin-aarch64": {url: process.env.URL, signature: process.env.SIGNATURE}}}, null, 2))' > "$latest_json"
cp "$latest_json" "$updater_manifest"

git add "$tauri_file" "$cargo_file" "$frontend_file" "$lock_file" "$updater_manifest" "$changelog_file"
git commit -m "chore: release $tag"
release_committed=true
git tag -a "$tag" -m "Release $tag"
git push origin main || {
  echo "错误：本地 commit 和 tag 已创建，但 main 未推送。补救：git push origin main && git push origin $tag" >&2
  exit 1
}
git push origin "$tag" || {
  echo "错误：main 已推送，但 tag 未推送。补救：git push origin $tag" >&2
  exit 1
}

release_json="$(curl --fail --silent --show-error --request POST "$gitee_api" \
  --data-urlencode "access_token=$GITEE_TOKEN" \
  --data-urlencode "tag_name=$tag" \
  --data-urlencode "name=Release $tag" \
  --data-urlencode "body=$release_notes" \
  --data-urlencode "target_commitish=main")" || {
  echo "错误：main 和 tag 已推送，但无法创建 Gitee Release。" >&2
  exit 1
}
release_id="$(node -e 'try { const release=JSON.parse(process.argv[1]); if (release.id) process.stdout.write(String(release.id)); } catch {}' "$release_json")"
[[ -n "$release_id" ]] || {
  release_error="$(node -e 'try { const release=JSON.parse(process.argv[1]); process.stdout.write(String(release.message || release.error || "响应未包含 Release ID").replace(/\s+/g, " ").slice(0, 500)); } catch { process.stdout.write("Gitee 返回了无效响应"); }' "$release_json")"
  echo "错误：Gitee Release 创建失败：$release_error" >&2
  exit 1
}
upload_release_asset() {
  curl --fail --silent --show-error --request POST "$gitee_api/$release_id/attach_files" \
    --form "access_token=$GITEE_TOKEN" \
    --form "file=@$1" >/dev/null
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
  upload_release_asset "$asset" || {
    echo "错误：main 和 tag 已推送，但上传 Gitee Release 附件失败：$(basename "$asset")" >&2
    exit 1
  }
done
verify_online_release

echo "发布完成：$tag"
echo "Release：https://gitee.com/$repo/releases/tag/$tag"
