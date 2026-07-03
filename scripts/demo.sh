#!/usr/bin/env bash
# ConvergeKit demo: "Tests passed. Closure blocked."
#
# Scenario 1 — architecture drift: an AI patch fixes a bug and passes all
#   tests, but makes the UI layer import the DB client directly.
# Scenario 2 — test weakening: an AI patch changes behavior and adapts the
#   tests to match; tests pass, but test-revert-rerun exposes it.
#
# Run from the repo root:  bash scripts/demo.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONVERGE="node $ROOT/dist/cli.js"
DEMO="$ROOT/examples/demo-app"

step() { printf '\n\033[1;36m== %s ==\033[0m\n' "$*"; }

cd "$DEMO"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || {
  echo "examples/demo-app is not a git repo. See README for setup."; exit 1; }

step "baseline: tests pass"
npm test >/dev/null 2>&1 && echo "npm test: PASS"

step "scenario 1: AI patch fixes the bug in the WRONG layer (UI imports DB)"
cat > src/ui/auth.js <<'EOF'
// UI layer — renders login results. Must not access the DB layer directly.
//
// (AI patch) Fixed uppercase-email login by normalizing the email here and
// checking credentials against the user record directly.
import { getUserByEmail } from "../db/client.js";

export function renderLogin(email, password) {
  const user = getUserByEmail(email.toLowerCase());
  if (!user || user.password !== password) {
    return "Login failed.";
  }
  return `Welcome, ${user.name}!`;
}
EOF
npm test >/dev/null 2>&1 && echo "npm test: PASS  <-- agent would claim completion here"

step "converge check"
$CONVERGE check || true

step "converge correction — the repair packet for the next agent run"
$CONVERGE correction --for claude || true

step "scenario 1 verdict: tests passed, closure BLOCKED (ui-cannot-import-db)"
git checkout -q -- src

step "scenario 2: AI patch changes behavior AND adapts the tests to match"
sed -i.bak 's/Welcome, /Hello, /' src/ui/auth.js && rm -f src/ui/auth.js.bak
sed -i.bak 's/Welcome, Alice!/Hello, Alice!/g' tests/auth.test.js && rm -f tests/auth.test.js.bak
npm test >/dev/null 2>&1 && echo "npm test: PASS  <-- tests were adapted to the implementation"

step "converge check (test-revert-rerun)"
$CONVERGE check || true

step "scenario 2 verdict: tests passed, closure BLOCKED (test-revert-rerun)"
git checkout -q -- src tests

step "demo finished — working tree restored"
