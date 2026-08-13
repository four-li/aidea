#!/usr/bin/env bash
set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

prepare_only=false
for arg in "$@"; do
  case "$arg" in
    --prepare-only) prepare_only=true ;;
    *) echo "用法：bash scripts/release.sh [--prepare-only]" >&2; exit 1 ;;
  esac
done

release_lock_dir="/private/tmp/aidea-release.lock"
if [[ -d "$release_lock_dir" ]]; then
  if [[ -f "$release_lock_dir/pid" ]] && kill -0 "$(<"$release_lock_dir/pid")" 2>/dev/null; then
    echo "错误：已有发布流程正在运行，请等待其完成后再试。" >&2
    exit 1
  fi
  rm -f "$release_lock_dir/pid"
  rmdir "$release_lock_dir" 2>/dev/null || {
    echo "错误：发布锁异常，无法安全清理：$release_lock_dir" >&2
    exit 1
  }
fi
mkdir "$release_lock_dir"
printf '%s\n' "$$" > "$release_lock_dir/pid"

tauri_file="shell-native/tauri.conf.json"
cargo_file="shell-native/Cargo.toml"
frontend_file="shell-frontend/package.json"
lock_file="shell-frontend/package-lock.json"
changelog_file="shell-frontend/src/data/changelog.json"
updater_manifest="updater/latest.json"
release_prepared=false
backup_dir=""
release_dir=""
build_marker=""

cleanup() {
  status=$?
  if [[ "$release_prepared" == false && -n "$backup_dir" ]]; then
    cp "$backup_dir/tauri.conf.json" "$tauri_file"
    cp "$backup_dir/Cargo.toml" "$cargo_file"
    cp "$backup_dir/package.json" "$frontend_file"
    cp "$backup_dir/package-lock.json" "$lock_file"
    cp "$backup_dir/changelog.json" "$changelog_file"
    cp "$backup_dir/latest.json" "$updater_manifest"
  fi
  [[ -n "$backup_dir" ]] && rm -rf "$backup_dir"
  [[ -n "$release_dir" ]] && rm -rf "$release_dir"
  [[ -n "$build_marker" ]] && rm -f "$build_marker"
  rm -f "$release_lock_dir/pid"
  rmdir "$release_lock_dir" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT

for tool in git node npm cargo curl hdiutil security strings grep sed; do
  command -v "$tool" >/dev/null 2>&1 || {
  echo "错误：缺少发布工具 ${tool}。请安装后重试。" >&2
    exit 1
  }
done

[[ "$(git branch --show-current)" == "main" ]] || { echo "错误：必须在 main 分支发布。" >&2; exit 1; }
git diff --check
git diff --cached --check
if [[ -n "$(git diff --name-only --diff-filter=U)" ]]; then
  echo "错误：存在未解决的 Git 冲突。" >&2
  exit 1
fi

origin_url="$(git config --get remote.origin.url || true)"
[[ "$origin_url" =~ (gitee\.com[:/])[^/]+/[^/]+(\.git)?$ ]] || {
  echo "错误：origin 必须指向 Gitee 仓库，当前为：$origin_url" >&2
  exit 1
}
repo="$(printf '%s' "$origin_url" | sed -E 's#git@gitee\.com:##; s#https://gitee\.com/##; s#\.git$##')"
gitee_api="https://gitee.com/api/v5/repos/$repo/releases"

if hdiutil info 2>/dev/null | grep -E '/Volumes/aIdea(/|$)' >/dev/null; then
  echo "错误：检测到已挂载的 /Volumes/aIdea，请先在 Finder 推出该磁盘映像。" >&2
  exit 1
fi

while IFS= read -r file; do
  case "$file" in
    *.pem|*.p12|*.pfx|*.key|.env|.env.*|*id_rsa*|*id_ed25519*)
      echo "错误：拒绝把风险文件纳入发布：$file" >&2
      exit 1
      ;;
  esac
  [[ -f "$file" ]] && grep -Eq -- '-----BEGIN (RSA|OPENSSH|EC|DSA) PRIVATE KEY-----|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}' "$file" && {
    echo "错误：发现疑似密钥：$file" >&2
    exit 1
  }
done < <(git ls-files -co --exclude-standard)

[[ -f aidea-updater.key || -n "${TAURI_SIGNING_PRIVATE_KEY:-}" ]] || {
  echo "错误：缺少 updater 私钥 aidea-updater.key。" >&2
  exit 1
}
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(<aidea-updater.key)"
fi
gitee_token_file="/Users/fourli/aidea-gitee-token"
[[ -f "$gitee_token_file" ]] || { echo "错误：缺少 Gitee Token 文件 $gitee_token_file。" >&2; exit 1; }
gitee_token="$(<"$gitee_token_file")"
[[ -n "$gitee_token" ]] || { echo "错误：Gitee Token 文件为空。" >&2; exit 1; }

# Token 仅通过 curl 标准输入传递，避免出现在命令参数、环境和日志中。
gitee_curl() {
  curl --fail --silent --show-error --config - "$@" <<EOF
data-urlencode = "access_token=$gitee_token"
EOF
}

gitee_upload() {
  curl --fail --silent --show-error --config - "$@" <<EOF
form-string = "access_token=$gitee_token"
EOF
}

gitee_curl --get 'https://gitee.com/api/v5/user' \
  | node -e 'let body=""; process.stdin.on("data", d => body += d).on("end", () => { if (!JSON.parse(body).id) process.exit(1); })' \
  || { echo "错误：Gitee Token 无效。" >&2; exit 1; }

current_version="$(node -p "require('./$tauri_file').version")"
product_name="$(node -p "require('./$tauri_file').productName")"
current_cargo="$(sed -nE 's/^version = "([0-9]+\.[0-9]+\.[0-9]+)"$/\1/p' "$cargo_file" | head -1)"
current_frontend="$(node -p "require('./$frontend_file').version")"
current_lock="$(node -e "const lock=require('./$lock_file'); process.stdout.write(lock.version === lock.packages?.['']?.version ? lock.version : '')")"
[[ "$current_version" == "$current_cargo" && "$current_version" == "$current_frontend" && "$current_version" == "$current_lock" ]] || {
  echo "错误：四个版本文件当前不一致。" >&2
  exit 1
}
[[ -n "$product_name" && -f "$updater_manifest" ]] || { echo "错误：发布配置不完整。" >&2; exit 1; }

latest_tag="$(git tag --list 'v[0-9]*' --sort=-v:refname | head -1)"
[[ -n "$latest_tag" ]] || { echo "错误：找不到历史正式 tag。" >&2; exit 1; }
latest_version="${latest_tag#v}"
version_relation="$(node -e '
const [current, latest] = process.argv.slice(1).map(v => v.split(".").map(Number));
for (let i = 0; i < 3; i++) {
  if (current[i] !== latest[i]) {
    process.stdout.write(String(Math.sign(current[i] - latest[i])));
    process.exit(0);
  }
}
process.stdout.write("0");
' "$current_version" "$latest_version")"
[[ "$version_relation" != "-1" ]] || {
  echo "错误：当前版本 ${current_version} 低于最近正式版本 ${latest_version}，请先修复版本号。" >&2
  exit 1
}
target_version="$(node -e '
const [current, latest] = process.argv.slice(1).map(v => v.split(".").map(Number));
const compare = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};
if (compare(current, latest) > 0) process.stdout.write(current.join("."));
else process.stdout.write(`${latest[0]}.${latest[1]}.${latest[2] + 1}`);
' "$current_version" "$latest_version")"
[[ "$target_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "错误：版本必须是 X.Y.Z。" >&2; exit 1; }
node -e '
const [target, latest] = process.argv.slice(1).map(v => v.split(".").map(Number));
for (let i = 0; i < 3; i++) { if (target[i] > latest[i]) process.exit(0); if (target[i] < latest[i]) process.exit(1); }
process.exit(1);
' "$target_version" "$latest_version" || { echo "错误：发布版本必须高于 ${latest_tag}。" >&2; exit 1; }

tag="v$target_version"
if git show-ref --tags --verify --quiet "refs/tags/$tag"; then
  echo "错误：本地 tag $tag 已存在。" >&2
  exit 1
fi
remote_tag_ref="$(git ls-remote --tags origin "refs/tags/$tag" 2>/dev/null)" || { echo "错误：无法检查远端 tag。" >&2; exit 1; }
[[ -z "$remote_tag_ref" ]] || { echo "错误：远端 tag ${tag} 已存在，请运行 scripts/resume-release.sh ${target_version}。" >&2; exit 1; }

expected_updater_endpoint="https://gitee.com/$repo/raw/main/$updater_manifest"
node -e 'const c=require(process.argv[1]); if (!c.bundle.createUpdaterArtifacts || !c.plugins?.updater?.pubkey || c.plugins.updater.endpoints?.[0] !== process.argv[2]) process.exit(1)' \
  "./$tauri_file" "$expected_updater_endpoint" || { echo "错误：updater 配置不正确。" >&2; exit 1; }

if [[ "$prepare_only" == true ]]; then
  echo "预检通过，将发布 ${tag}。"
  exit 0
fi

backup_dir="$(mktemp -d)"
cp "$tauri_file" "$backup_dir/tauri.conf.json"
cp "$cargo_file" "$backup_dir/Cargo.toml"
cp "$frontend_file" "$backup_dir/package.json"
cp "$lock_file" "$backup_dir/package-lock.json"
cp "$changelog_file" "$backup_dir/changelog.json"
cp "$updater_manifest" "$backup_dir/latest.json"

subjects="$(git log --format=%s "$latest_tag..HEAD")"
node -e '
const fs = require("fs");
const [tauri, cargo, frontend, lock, changelog, version, subjects] = process.argv.slice(1);
const setJsonVersion = file => { const json = JSON.parse(fs.readFileSync(file, "utf8")); json.version = version; if (json.packages?.[""]) json.packages[""].version = version; fs.writeFileSync(file, JSON.stringify(json, null, 2) + "\n"); };
setJsonVersion(tauri); setJsonVersion(frontend); setJsonVersion(lock);
let cargoText = fs.readFileSync(cargo, "utf8"); cargoText = cargoText.replace(/^version = "[0-9]+\.[0-9]+\.[0-9]+"$/m, `version = "${version}"`); fs.writeFileSync(cargo, cargoText);
const groups = { "新增": [], "优化": [], "修复": [] };
for (const subject of subjects.split("\n").filter(Boolean)) {
  const text = subject.replace(/^[a-z]+(?:\([^)]*\))?:\s*/i, "").trim();
  if (!text || /^(test|docs|chore|build|ci)(\(|:)/i.test(subject)) continue;
  if (/^fix/i.test(subject) || /修复/.test(text)) groups["修复"].push(text);
  else if (/^(feat|add)/i.test(subject) || /新增|支持/.test(text)) groups["新增"].push(text);
  else groups["优化"].push(text);
}
const notes = Object.entries(groups).filter(([, lines]) => lines.length).map(([title, lines]) => `${title}\n${[...new Set(lines)].map(line => `- ${line}`).join("\n")}`).join("\n\n") || "优化\n- 自动生成的维护性更新。";
const entries = JSON.parse(fs.readFileSync(changelog, "utf8")).filter(entry => entry.version !== version);
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
entries.unshift({ version, date, notes });
fs.writeFileSync(changelog, JSON.stringify(entries, null, 2) + "\n");
' "$tauri_file" "$cargo_file" "$frontend_file" "$lock_file" "$changelog_file" "$target_version" "$subjects"

npm ci --prefix shell-frontend
npm test --prefix shell-frontend
npm run build --prefix shell-frontend
(cd shell-native && cargo test)

build_marker="$(mktemp)"
touch "$build_marker"
(cd shell-native && CI=true ../shell-frontend/node_modules/.bin/tauri build --bundles app,dmg)

dmg="shell-native/target/release/bundle/dmg/${product_name}_${target_version}_aarch64.dmg"
updater_archive="shell-native/target/release/bundle/macos/${product_name}.app.tar.gz"
updater_signature="${updater_archive}.sig"
[[ -f "$dmg" && -f "$updater_archive" && "$updater_archive" -nt "$build_marker" && -f "$updater_signature" && "$updater_signature" -nt "$build_marker" ]] || {
  echo "错误：缺少本次构建的发布产物。" >&2
  exit 1
}
bundled_binary="shell-native/target/release/bundle/macos/${product_name}.app/Contents/MacOS/aidea-shell"
strings "$bundled_binary" | grep -F -- "$expected_updater_endpoint" >/dev/null || { echo "错误：最终二进制未嵌入 Gitee Raw updater 地址。" >&2; exit 1; }
if strings "$bundled_binary" | grep -F -- "https://gitee.com/$repo/releases/latest/download/latest.json" >/dev/null; then
  echo "错误：最终二进制仍包含旧 updater 地址。" >&2
  exit 1
fi

release_dir="$(mktemp -d)"
latest_json="$release_dir/latest.json"
release_notes="$(node -e "const rows=require('./$changelog_file'); process.stdout.write(rows.find(row => row.version === '$target_version').notes)")"
gitee_release_url="https://gitee.com/$repo/releases/download/$tag"
export VERSION="$target_version" TAG="$tag" URL="$gitee_release_url/$(basename "$updater_archive")" SIGNATURE="$(<"$updater_signature")" RELEASE_NOTES="$release_notes"
node -e 'console.log(JSON.stringify({version: process.env.VERSION, notes: process.env.RELEASE_NOTES, pub_date: new Date().toISOString(), platforms: {"darwin-aarch64": {url: process.env.URL, signature: process.env.SIGNATURE}}}, null, 2))' > "$latest_json"
cp "$latest_json" "$updater_manifest"
git add -A
git diff --cached --quiet || git commit -m "chore: release $tag"
release_prepared=true
git tag -a "$tag" -m "Release $tag"
git push origin main
git push origin "$tag"

release_json="$(gitee_curl --request POST "$gitee_api" --data-urlencode "tag_name=$tag" --data-urlencode "name=Release $tag" --data-urlencode "body=$release_notes" --data-urlencode "target_commitish=main")" || {
  echo "错误：main 和 tag 已推送；请运行 scripts/resume-release.sh ${target_version}。" >&2
  exit 1
}
release_id="$(node -e 'const r=JSON.parse(process.argv[1]); if (r.id) process.stdout.write(String(r.id));' "$release_json")"
[[ -n "$release_id" ]] || { echo "错误：Release 创建失败；请运行 scripts/resume-release.sh ${target_version}。" >&2; exit 1; }

for asset in "$dmg" "$updater_archive" "$updater_signature" "$latest_json"; do
  gitee_upload --request POST "$gitee_api/$release_id/attach_files" --form "file=@$asset" >/dev/null || {
    echo "错误：附件上传失败；请运行 scripts/resume-release.sh ${target_version}。" >&2
    exit 1
  }
done

release_json="$(gitee_curl --get "$gitee_api/tags/$tag")"
node -e 'const r=JSON.parse(process.argv[1]); const expected=process.argv.slice(2); const notes=expected.pop(); const names=new Set((r.assets || []).map(a => a.name)); if (r.body !== notes || !expected.every(name => names.has(name))) process.exit(1);' \
  "$release_json" "$(basename "$dmg")" "$(basename "$updater_archive")" "$(basename "$updater_signature")" "$(basename "$latest_json")" "$release_notes" || {
  echo "错误：线上 Release 核验失败；请运行 scripts/resume-release.sh ${target_version}。" >&2
  exit 1
}
for attempt in 1 2 3 4 5; do
  manifest="$(curl --fail --silent --location "$expected_updater_endpoint" 2>/dev/null || true)"
  node -e 'const r=JSON.parse(process.argv[1]); const p=r.platforms?.["darwin-aarch64"]; if (r.version !== process.argv[2] || r.notes !== process.argv[3] || !p?.url || !p?.signature) process.exit(1);' "$manifest" "$target_version" "$release_notes" && break
  [[ "$attempt" == 5 ]] && { echo "错误：Raw 更新清单核验失败。" >&2; exit 1; }
  sleep 2
done

echo "发布完成：$tag"
echo "Release：https://gitee.com/$repo/releases/tag/$tag"
