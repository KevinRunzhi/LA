#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE_BASENAME="79012840作品"
OUTPUT_DIR="${1:-$REPO_ROOT/output/submission}"
ARCHIVE="$OUTPUT_DIR/$PACKAGE_BASENAME.zip"
CHECKSUM="$ARCHIVE.sha256"

cd "$REPO_ROOT"
if ! git diff --quiet || ! git diff --cached --quiet; then
  printf '存在未提交的源码修改。请先完成提交，保证作品运行包可追溯。\n' >&2
  exit 1
fi

temp_root="$(mktemp -d)"
runtime_root="$temp_root/$PACKAGE_BASENAME"
cleanup() { rm -rf "$temp_root"; }
trap cleanup EXIT
mkdir -p "$OUTPUT_DIR"

printf '[1/5] 生成龙芯稳定演示运行目录……\n'
PACKAGE_NAME_OVERRIDE="$PACKAGE_BASENAME" RELEASE_DIR_OVERRIDE="$temp_root" \
  "$REPO_ROOT/scripts/package-loongarch-stable.sh"
rm -f "$temp_root/$PACKAGE_BASENAME.tar.gz.sha256"
tar -xzf "$temp_root/$PACKAGE_BASENAME.tar.gz" -C "$temp_root"
rm -f "$temp_root/$PACKAGE_BASENAME.tar.gz"

printf '[2/5] 增加一键安装与运行入口……\n'
cat >"$runtime_root/install-and-start.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ ! -x "$ROOT/backend/.venv/bin/python" ]]; then
  "$ROOT/deploy/loongarch/scripts/install.sh"
fi
"$ROOT/deploy/loongarch/scripts/start.sh"
"$ROOT/deploy/loongarch/scripts/healthcheck.sh"
EOF

cat >"$runtime_root/stop.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$ROOT/deploy/loongarch/scripts/stop.sh"
EOF

cat >"$runtime_root/healthcheck.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$ROOT/deploy/loongarch/scripts/healthcheck.sh"
EOF

cat >"$runtime_root/reset-demo.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
"$ROOT/deploy/loongarch/scripts/reset-demo.sh"
EOF

chmod 755 "$runtime_root/install-and-start.sh" "$runtime_root/stop.sh" \
  "$runtime_root/healthcheck.sh" "$runtime_root/reset-demo.sh"

cat >"$runtime_root/作品安装运行说明.txt" <<'EOF'
作品：LA 工业设备智能接诊系统
平台：银河麒麟高级服务器操作系统 V11 / loongarch64
默认目录：/home/vmuser/project
默认端口：8080

安装运行：
  cd /home/vmuser/project
  chmod +x *.sh deploy/loongarch/scripts/*.sh
  ./install-and-start.sh

浏览器访问：
  http://127.0.0.1:8080
  http://<龙芯机器IP>:8080

停止：./stop.sh
检查：./healthcheck.sh
重置演示：./reset-demo.sh

完整部署、旧服务处理、防火墙、数据备份和故障排查见 DEPLOYMENT-GUIDE.md。
EOF

printf 'competition_artifact=installable-executable\nfilename=%s.zip\n' "$PACKAGE_BASENAME" >>"$runtime_root/VERSION"

printf '[3/5] 生成运行包逐文件校验清单……\n'
(
  cd "$runtime_root"
  find . -type f ! -name 'MANIFEST-SHA256.txt' -print0 \
    | sort -z \
    | xargs -0 sha256sum >MANIFEST-SHA256.txt
)

printf '[4/5] 生成指定名称 ZIP……\n'
rm -f "$ARCHIVE" "$CHECKSUM"
TEMP_ROOT="$temp_root" RUNTIME_ROOT="$runtime_root" ARCHIVE="$ARCHIVE" python3 - <<'PY'
import os
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

temp_root = Path(os.environ["TEMP_ROOT"])
runtime_root = Path(os.environ["RUNTIME_ROOT"])
archive = Path(os.environ["ARCHIVE"])

with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=6, allowZip64=True) as zip_file:
    for path in sorted(runtime_root.rglob("*")):
        if path.is_file():
            zip_file.write(path, path.relative_to(temp_root))
PY

(
  cd "$OUTPUT_DIR"
  sha256sum "$PACKAGE_BASENAME.zip" >"$PACKAGE_BASENAME.zip.sha256"
)

printf '[5/5] 校验可安装运行包……\n'
ARCHIVE="$ARCHIVE" PACKAGE_BASENAME="$PACKAGE_BASENAME" python3 - <<'PY'
import os
from zipfile import ZipFile

archive = os.environ["ARCHIVE"]
prefix = os.environ["PACKAGE_BASENAME"] + "/"
with ZipFile(archive) as zip_file:
    bad_file = zip_file.testzip()
    if bad_file:
        raise SystemExit(f"ZIP 文件损坏：{bad_file}")
    names = set(zip_file.namelist())
    required = {
        prefix + "install-and-start.sh",
        prefix + "stop.sh",
        prefix + "healthcheck.sh",
        prefix + "reset-demo.sh",
        prefix + "作品安装运行说明.txt",
        prefix + "DEPLOYMENT-GUIDE.md",
        prefix + "VERSION",
        prefix + "MANIFEST-SHA256.txt",
        prefix + "frontend/dist/index.html",
        prefix + "backend/app.py",
        prefix + "backend/presentation_store.py",
        prefix + "backend/requirements.txt",
        prefix + "backend/data/presentation/manual_sources.json",
    }
    missing = sorted(required - names)
    if missing:
        raise SystemExit("运行包缺少关键文件：" + ", ".join(missing))
    manual_pdfs = [name for name in names if name.startswith(prefix + "Info/") and name.lower().endswith(".pdf")]
    if len(manual_pdfs) != 15:
        raise SystemExit(f"运行包手册数量错误：预期 15，实际 {len(manual_pdfs)}")
    forbidden_parts = ("/.git/", "/node_modules/", "/.venv/", "/__pycache__/")
    forbidden = [name for name in names if any(part in name for part in forbidden_parts) or name.endswith("presentation.db")]
    if forbidden:
        raise SystemExit("运行包中出现禁止内容：" + ", ".join(forbidden[:10]))
    print(f"运行包校验通过：{len(names)} 个文件，手册 PDF {len(manual_pdfs)} 份")
PY

printf '\n作品安装/可执行文件：%s\n校验文件：%s\n' "$ARCHIVE" "$CHECKSUM"
