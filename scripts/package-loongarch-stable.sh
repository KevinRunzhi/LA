#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
expected_node="v$(tr -d '[:space:]' < .nvmrc)"
actual_node="$(node -v)"
if [[ "$actual_node" != "$expected_node" ]]; then printf 'Node 版本不符合：需要 %s，当前 %s\n' "$expected_node" "$actual_node" >&2; exit 1; fi
if ! git diff --quiet || ! git diff --cached --quiet; then printf '工作区存在未提交修改。请先提交，确保发布包可追溯。\n' >&2; exit 1; fi

commit="$(git rev-parse --short=8 HEAD)"
timestamp="$(date +%Y%m%d-%H%M%S)"
package_name="LA-formal-demo-${timestamp}-${commit}"
package_name="${PACKAGE_NAME_OVERRIDE:-$package_name}"
stage_parent="$(mktemp -d)"
stage="$stage_parent/$package_name"
release_dir="${RELEASE_DIR_OVERRIDE:-$REPO_ROOT/release}"
archive="$release_dir/$package_name.tar.gz"
cleanup() { rm -rf "$stage_parent"; }
trap cleanup EXIT

printf '[1/4] 构建前端（%s）……\n' "$actual_node"
npm --prefix frontend run build
printf '[2/4] 整理稳定演示包……\n'
mkdir -p "$stage/backend/data/presentation" "$stage/frontend" "$stage/deploy/loongarch" "$release_dir"
cp backend/app.py backend/presentation_store.py backend/requirements.txt "$stage/backend/"
find backend/data -maxdepth 1 -type f -name '*.json' -exec cp {} "$stage/backend/data/" \;
find backend/data/presentation -maxdepth 1 -type f -name '*.json' -exec cp {} "$stage/backend/data/presentation/" \;

manual_catalog="$REPO_ROOT/backend/data/presentation/manual_sources.json"
manual_list="$(python3 -c '
import json
import sys

with open(sys.argv[1], encoding="utf-8") as file:
    items = json.load(file)["items"]
paths = [item.get("file") for item in items]
if not paths or any(not isinstance(path, str) or not path for path in paths):
    raise SystemExit("manual_sources.json 中存在无效文件路径")
if len(paths) != len(set(paths)):
    raise SystemExit("manual_sources.json 中存在重复文件路径")
print("\n".join(paths))
' "$manual_catalog")"
mapfile -t manual_paths <<<"$manual_list"
info_root="$(realpath -e "$REPO_ROOT/Info")"
: >"$stage/MANUALS.txt"
for manual_path in "${manual_paths[@]}"; do
  source_path="$REPO_ROOT/$manual_path"
  if [[ ! -f "$source_path" ]]; then printf '登记的检修手册不存在：%s\n' "$manual_path" >&2; exit 1; fi
  resolved_path="$(realpath -e "$source_path")"
  if [[ "$manual_path" != Info/* || "$resolved_path" != "$info_root/"* ]]; then printf '检修手册路径必须位于 Info 目录：%s\n' "$manual_path" >&2; exit 1; fi
  if [[ "$(head -c 4 "$source_path")" != '%PDF' ]]; then printf '检修手册不是有效 PDF：%s\n' "$manual_path" >&2; exit 1; fi
  mkdir -p "$(dirname "$stage/$manual_path")"
  cp "$source_path" "$stage/$manual_path"
  printf '%s\n' "$manual_path" >>"$stage/MANUALS.txt"
done
manual_count="${#manual_paths[@]}"
packaged_manual_count="$(find "$stage/Info" -type f -iname '*.pdf' | wc -l)"
if [[ "$packaged_manual_count" -ne "$manual_count" ]]; then printf '检修手册复制数量不一致：登记 %s，实际 %s\n' "$manual_count" "$packaged_manual_count" >&2; exit 1; fi
printf '已收录 %s 份登记检修手册。\n' "$manual_count"

cp -a frontend/dist "$stage/frontend/"
find "$stage/frontend/dist" -type f -name '*:Zone.Identifier' -delete
cp -a deploy/loongarch/scripts "$stage/deploy/loongarch/"
cp Docs/loongarch-stable-demo-deployment-guide.md "$stage/DEPLOYMENT-GUIDE.md"
printf 'package=%s\ncommit=%s\nbuilt_at=%s\nnode=%s\nrelease_type=formal-demo\nmode=prebuilt-dist-plus-flask\nmanual_count=%s\n' "$package_name" "$(git rev-parse HEAD)" "$(date --iso-8601=seconds)" "$actual_node" "$manual_count" >"$stage/VERSION"
find "$stage/deploy/loongarch/scripts" -type f -name '*.sh' -exec chmod 755 {} +
if find "$stage" -type f \( -name '*.db' -o -name '*.pyc' -o -name '*:Zone.Identifier' \) | grep -q .; then printf '发布包中出现了不应包含的运行时文件。\n' >&2; exit 1; fi
printf '[3/4] 生成 tar.gz……\n'
tar -C "$stage_parent" -czf "$archive" "$package_name"
(cd "$release_dir" && sha256sum "$package_name.tar.gz" >"$package_name.tar.gz.sha256")
printf '[4/4] 校验压缩包……\n'
tar -tzf "$archive" >/dev/null
(cd "$release_dir" && sha256sum -c "$package_name.tar.gz.sha256")
printf '\n发布包：%s\n校验文件：%s.sha256\n' "$archive" "$archive"
