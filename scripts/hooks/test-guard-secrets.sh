#!/usr/bin/env bash
# Exercise guard-secrets.mjs against the real scenarios. Uses a scratch git repo
# + PROJECT_DIR so nothing here touches the actual index.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

pass=0; fail=0
run() { # name expected_exit cmd...
  local name="$1" want="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [[ "$rc" == "$want" ]]; then
    echo "  PASS  $name (exit $rc)"; pass=$((pass+1))
  else
    echo "  FAIL  $name (exit $rc, wanted $want)"; echo "$out" | sed 's/^/        /'; fail=$((fail+1))
  fi
}

# --- scratch repo with a realistic config.json ---
cd "$SCRATCH"
git init -q . && git config user.email t@t && git config user.name t
mkdir -p app data
cat > config.json <<'JSON'
{"league_id": 6121, "espn_s2": "ABCdefREALtoken1234567890XYZ%3D%3D", "swid": "{03JFJHW-FWFWF-044G-realvalue}"}
JSON
cat > app/.dev.vars <<'VARS'
TURNSTILE_SECRET_KEY=0x1secretturnstilekey
ADMIN_API_KEY=live-admin-key-9f2a7c
CREDENTIALS_ENCRYPTION_KEY=deadbeefcafebabe0123456789abcdef
VARS
printf '# nothing to see\n' > README.md
echo '{"ok":true}' > clean.json
echo 'const KEY = "live-admin-key-9f2a7c";' > leaked-from-devvars.ts
echo 'Cookie: espn_s2=ABCdefREALtoken1234567890XYZ%3D%3D; SWID=x' > leaked-cookie.txt
echo 'Plain file with no secrets at all.' > innocent.md
git add -A >/dev/null 2>&1; git commit -qm init >/dev/null 2>&1

export PROJECT_DIR="$SCRATCH"
G="node $ROOT/scripts/hooks/guard-secrets.mjs"

echo "== value-leak detection =="
run "espn_s2 copied into a source file blocks" 1 $G --strict "$SCRATCH/leaked-cookie.txt"
run "ADMIN_API_KEY from .dev.vars blocks"        1 $G --strict "$SCRATCH/leaked-from-devvars.ts"
run "innocent file passes"                       0 $G --strict "$SCRATCH/innocent.md"
run "clean json passes"                          0 $G --strict "$SCRATCH/clean.json"
run "advisory mode exits 0 despite a leak"       0 $G "$SCRATCH/leaked-cookie.txt"

echo "== secret-bearing file force-added =="
echo '{"espn_s2":"ANOTHERtokenAAAABBBBCCCC1234"}' > app/.dev.vars.bak
cp app/.dev.vars app/dev.vars.force
run "force-added .dev.vars blocks"               1 $G --strict "$SCRATCH/app/dev.vars.force"
cp config.json config.force.json
run "force-added config copy under another name passes (value scan only)" 0 $G --strict "$SCRATCH/config.force.json"

echo "== placeholder values must NOT trip the guard =="
cat > config.json <<'JSON'
{"league_id": 0, "espn_s2": "", "swid": "{PASTE-YOUR-SWID-COOKIE-HERE}"}
JSON
cat > app/.dev.vars <<'VARS'
TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
ADMIN_API_KEY=dev-admin-key-change-me
VARS
echo "no real secrets here, just docs" > docs.md
run "placeholder-only config allows clean file" 0 $G --strict "$SCRATCH/docs.md"

echo "== staged sweep (--staged) =="
cat > config.json <<'JSON'
{"league_id": 6121, "espn_s2": "ABCdefREALtoken1234567890XYZ%3D%3D", "swid": "{03JFJHW-FWFWF-044G-realvalue}"}
JSON
echo 'oops: live-admin-key-9f2a7c got pasted here' > oops.md
git add oops.md >/dev/null 2>&1
run "--staged catches a leak among staged files" 1 $G --strict --staged
git rm -q --cached oops.md >/dev/null 2>&1; rm -f oops.md
echo "harmless" > fine.md; git add fine.md >/dev/null 2>&1
run "--staged passes when staged set is clean"   0 $G --strict --staged

echo
echo "passed=$pass failed=$fail"
[[ $fail -eq 0 ]]
