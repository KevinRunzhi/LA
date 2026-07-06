#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "MVP dev commands:"
echo ""
echo "Backend:"
echo "  cd \"$ROOT_DIR/backend\""
echo "  python3 -m venv .venv"
echo "  . .venv/bin/activate"
echo "  pip install -r requirements.txt"
echo "  python app.py"
echo ""
echo "Frontend:"
echo "  cd \"$ROOT_DIR/frontend\""
echo "  npm install"
echo "  npm run dev"
echo ""
echo "Open:"
echo "  http://127.0.0.1:8080"
