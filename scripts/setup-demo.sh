#!/usr/bin/env bash
# (Re)initialize examples/demo-app as a standalone git repo.
# The parent repo tracks the demo files; the nested .git is created locally
# by this script because converge check needs git diff as input.
set -euo pipefail

DEMO="$(cd "$(dirname "$0")/.." && pwd)/examples/demo-app"
cd "$DEMO"

rm -rf .git
git init -q
git config user.name "ConvergeKit Demo"
git config user.email "demo@convergekit.local"
git add -A
git commit -qm "demo baseline: layered auth app + ConvergeKit setup (PLAN-001 closed)"
echo "demo repo initialized at $DEMO"
echo "next: bash scripts/demo.sh"
