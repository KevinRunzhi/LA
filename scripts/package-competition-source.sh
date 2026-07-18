#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_BASENAME="79012840源码"
OUTPUT_DIR="${1:-$REPO_ROOT/output/submission}"
ARCHIVE="$OUTPUT_DIR/$PACKAGE_BASENAME.zip"
CHECKSUM="$ARCHIVE.sha256"

cd "$REPO_ROOT"

expected_node="v$(tr -d '[:space:]' < .nvmrc)"
actual_node="$(node -v)"
if [[ "$actual_node" != "$expected_node" ]]; then
  printf 'Node 版本不符合：需要 %s，当前 %s\n' "$expected_node" "$actual_node" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  printf '存在未提交的源码修改。请先完成提交，保证作品源码包可追溯。\n' >&2
  exit 1
fi

stage_parent="$(mktemp -d)"
package_root="$stage_parent/$PACKAGE_BASENAME"
cleanup() { rm -rf "$stage_parent"; }
trap cleanup EXIT
mkdir -p "$package_root" "$OUTPUT_DIR"

printf '[1/5] 使用 %s 构建最新前端……\n' "$actual_node"
npm --prefix frontend run build

printf '[2/5] 收集源码、文档、数据与资料……\n'
while IFS= read -r -d '' relative_path; do
  case "$relative_path" in
    release/*) continue ;;
  esac
  mkdir -p "$package_root/$(dirname "$relative_path")"
  cp -a "$REPO_ROOT/$relative_path" "$package_root/$relative_path"
done < <(git ls-files -z)

# Info 是作品的原始资料库；整体复制可确保后续新加入但尚未登记的资料也不会漏包。
rm -rf "$package_root/Info"
cp -a "$REPO_ROOT/Info" "$package_root/Info"

# 源码包同时携带最新静态构建，便于评审环境直接使用稳定演示模式。
mkdir -p "$package_root/frontend"
rm -rf "$package_root/frontend/dist"
cp -a "$REPO_ROOT/frontend/dist" "$package_root/frontend/dist"

# 演示导出的作业卡属于作品效果样例，不提交 Git，但放入比赛源码包。
if [[ -d "$REPO_ROOT/output/pdf" ]]; then
  mkdir -p "$package_root/output"
  cp -a "$REPO_ROOT/output/pdf" "$package_root/output/pdf"
fi

find "$package_root" -type f -name '*:Zone.Identifier' -delete

source_info_pdf_count="$(find "$REPO_ROOT/Info" -type f -iname '*.pdf' | wc -l)"
packaged_info_pdf_count="$(find "$package_root/Info" -type f -iname '*.pdf' | wc -l)"
if [[ "$source_info_pdf_count" -eq 0 || "$packaged_info_pdf_count" -ne "$source_info_pdf_count" ]]; then
  printf 'Info PDF 数量不一致：源目录 %s，源码包 %s\n' "$source_info_pdf_count" "$packaged_info_pdf_count" >&2
  exit 1
fi

if [[ ! -f "$package_root/frontend/dist/index.html" ]]; then
  printf '源码包缺少 frontend/dist/index.html\n' >&2
  exit 1
fi

commit="$(git rev-parse HEAD)"
cat >"$package_root/SOURCE-PACKAGE-INFO.txt" <<EOF
作品名称：LA 工业设备智能接诊系统
提交文件：$PACKAGE_BASENAME.zip
Git 提交：$commit
打包时间：$(date --iso-8601=seconds)
Node.js：$actual_node
npm：$(npm -v)
Python：$(python3 -V 2>&1)
Info PDF 数量：$packaged_info_pdf_count

内容说明：
- frontend：React/Vite 前端源码、资源、package-lock.json 和最新 dist
- backend：Flask 后端源码、测试与 JSON 种子数据
- Docs：项目需求、设计、开发、部署和交接文档
- Info：厂商原始手册、设备资料和知识整理文件
- deploy、scripts：龙芯部署与项目辅助脚本
- output：设计验收素材及示例检修作业卡

未包含：
- .git、node_modules、Python 虚拟环境、缓存和日志
- 运行时 SQLite 数据库
- release 目录中的历史发布压缩包
EOF

printf '[3/5] 生成逐文件校验清单……\n'
(
  cd "$package_root"
  find . -type f ! -name 'MANIFEST-SHA256.txt' -print0 \
    | sort -z \
    | xargs -0 sha256sum >MANIFEST-SHA256.txt
)

printf '[4/5] 生成指定名称 ZIP……\n'
rm -f "$ARCHIVE" "$CHECKSUM"
STAGE_PARENT="$stage_parent" PACKAGE_ROOT="$package_root" ARCHIVE="$ARCHIVE" python3 - <<'PY'
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

stage_parent = Path(os.environ["STAGE_PARENT"])
package_root = Path(os.environ["PACKAGE_ROOT"])
archive = Path(os.environ["ARCHIVE"])

with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=6, allowZip64=True) as zip_file:
    for path in sorted(package_root.rglob("*")):
        if path.is_file():
            zip_file.write(path, path.relative_to(stage_parent))
PY

(
  cd "$OUTPUT_DIR"
  sha256sum "$PACKAGE_BASENAME.zip" >"$PACKAGE_BASENAME.zip.sha256"
)

printf '[5/5] 校验 ZIP 内容……\n'
ARCHIVE="$ARCHIVE" PACKAGE_BASENAME="$PACKAGE_BASENAME" EXPECTED_INFO_PDFS="$source_info_pdf_count" python3 - <<'PY'
import os
from zipfile import ZipFile

archive = os.environ["ARCHIVE"]
prefix = os.environ["PACKAGE_BASENAME"] + "/"
expected_pdfs = int(os.environ["EXPECTED_INFO_PDFS"])

with ZipFile(archive) as zip_file:
    bad_file = zip_file.testzip()
    if bad_file:
        raise SystemExit(f"ZIP 文件损坏：{bad_file}")
    names = set(zip_file.namelist())
    required = {
        prefix + "README.md",
        prefix + "frontend/package.json",
        prefix + "frontend/package-lock.json",
        prefix + "frontend/src/App.jsx",
        prefix + "frontend/dist/index.html",
        prefix + "backend/app.py",
        prefix + "backend/presentation_store.py",
        prefix + "backend/data/presentation/manual_sources.json",
        prefix + "Docs/README.md",
        prefix + "SOURCE-PACKAGE-INFO.txt",
        prefix + "MANIFEST-SHA256.txt",
    }
    missing = sorted(required - names)
    if missing:
        raise SystemExit("ZIP 缺少关键文件：" + ", ".join(missing))
    info_pdfs = [name for name in names if name.startswith(prefix + "Info/") and name.lower().endswith(".pdf")]
    if len(info_pdfs) != expected_pdfs:
        raise SystemExit(f"ZIP 中 Info PDF 数量错误：预期 {expected_pdfs}，实际 {len(info_pdfs)}")
    forbidden_parts = ("/.git/", "/node_modules/", "/.venv/", "/__pycache__/", "/release/")
    forbidden = [name for name in names if any(part in name for part in forbidden_parts) or name.endswith("presentation.db")]
    if forbidden:
        raise SystemExit("ZIP 中出现禁止内容：" + ", ".join(forbidden[:10]))
    print(f"ZIP 校验通过：{len(names)} 个文件，Info PDF {len(info_pdfs)} 份")
PY

printf '\n源码包：%s\n校验文件：%s\n' "$ARCHIVE" "$CHECKSUM"
