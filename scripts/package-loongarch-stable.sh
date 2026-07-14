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
package_name="LA-stable-demo-${timestamp}-${commit}"
stage_parent="$(mktemp -d)"
stage="$stage_parent/$package_name"
archive="$REPO_ROOT/release/$package_name.tar.gz"
cleanup() { rm -rf "$stage_parent"; }
trap cleanup EXIT

printf '[1/4] 构建前端（%s）……\n' "$actual_node"
npm --prefix frontend run build
printf '[2/4] 整理稳定演示包……\n'
mkdir -p "$stage/backend/data/presentation" "$stage/frontend" "$stage/deploy/loongarch" "$REPO_ROOT/release"
cp backend/app.py backend/presentation_store.py backend/requirements.txt "$stage/backend/"
find backend/data -maxdepth 1 -type f -name '*.json' -exec cp {} "$stage/backend/data/" \;
find backend/data/presentation -maxdepth 1 -type f -name '*.json' -exec cp {} "$stage/backend/data/presentation/" \;
cp -a frontend/dist "$stage/frontend/"
find "$stage/frontend/dist" -type f -name '*:Zone.Identifier' -delete
cp -a deploy/loongarch/scripts "$stage/deploy/loongarch/"
cp Docs/loongarch-stable-demo-deployment-guide.md "$stage/DEPLOYMENT-GUIDE.md"
printf 'package=%s\ncommit=%s\nbuilt_at=%s\nnode=%s\nmode=prebuilt-dist-plus-flask\n' "$package_name" "$(git rev-parse HEAD)" "$(date --iso-8601=seconds)" "$actual_node" >"$stage/VERSION"
find "$stage/deploy/loongarch/scripts" -type f -name '*.sh' -exec chmod 755 {} +
if find "$stage" -type f \( -name '*.db' -o -name '*.pyc' -o -name '*:Zone.Identifier' \) | grep -q .; then printf '发布包中出现了不应包含的运行时文件。\n' >&2; exit 1; fi
printf '[3/4] 生成 tar.gz……\n'
tar -C "$stage_parent" -czf "$archive" "$package_name"
(cd "$REPO_ROOT/release" && sha256sum "$package_name.tar.gz" >"$package_name.tar.gz.sha256")
printf '[4/4] 校验压缩包……\n'
tar -tzf "$archive" >/dev/null
(cd "$REPO_ROOT/release" && sha256sum -c "$package_name.tar.gz.sha256")
printf '\n发布包：%s\n校验文件：%s.sha256\n' "$archive" "$archive"
