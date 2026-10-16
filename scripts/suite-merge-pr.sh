#!/usr/bin/env bash
# Prepare a suite/* pull request for merging (the Builder's routine, Oct 2026).
#   scripts/suite-merge-pr.sh suite/scan      (or suite/agent, suite/extension, suite/hq)
# It merges origin/main into a scratch worktree of the branch, keeps BOTH entries when docs/suite/LOG.md
# conflicts, refreshes the Extension's vendored copies (npm run vendor), runs `cd suite && npm test` and the
# root `npm test`, and pushes the result to the branch. It does NOT merge the PR: do that with the GitHub
# tool (squash) once everything above is green. Any other conflict stops it (exit 2).
set -u
BR="${1:?usage: scripts/suite-merge-pr.sh suite/<name>}"
REPO="$(git rev-parse --show-toplevel)"
WORK="${SUITE_MERGE_DIR:-${TMPDIR:-/tmp}/suite-merge}"
NAME="$(echo "$BR" | tr '/' '-')"
WT="$WORK/wt-$NAME"
mkdir -p "$WORK"
cd "$REPO" || exit 1
git fetch -q origin main "$BR" || { echo "FETCH FAILED"; exit 1; }
rm -rf "$WT"; git worktree prune
git worktree add -q -B "tmp-$NAME" "$WT" "origin/$BR" || { echo "WORKTREE FAILED"; exit 1; }
cd "$WT" || exit 1
echo "--- changed outside suite/ and docs/suite/ (should be empty):"
git diff --name-only "origin/main...origin/$BR" | grep -vE '^(suite/|docs/suite/)' | head -5
echo "--- merging main"
git merge --no-edit origin/main >"$WORK/merge.out" 2>&1; tail -2 "$WORK/merge.out"
CONF="$(git diff --name-only --diff-filter=U)"
if [ -n "$CONF" ]; then
  echo "conflicts: $CONF"
  [ "$CONF" = "docs/suite/LOG.md" ] || { echo "UNEXPECTED CONFLICT, stop"; exit 2; }
  python3 - <<'PY'
import re
p='docs/suite/LOG.md'
s=open(p).read()
fix=lambda m: m.group(1).rstrip('\n')+'\n\n'+m.group(2).strip('\n')+'\n'
s2=re.sub(r'<<<<<<< [^\n]*\n(.*?)=======\n(.*?)>>>>>>> [^\n]*\n', fix, s, flags=re.S)
open(p,'w').write(s2)
print('LOG.md markers left:', len(re.findall(r'^(<<<<<<<|=======|>>>>>>>)', s2, flags=re.M)))
PY
  git add -A docs && git commit -q --no-edit && echo "merge committed"
fi
[ -f suite/extension/package.json ] && (cd suite/extension && npm run vendor 2>&1 | tail -1)
echo "--- changes from vendoring:"; git status --short | head -8
echo "--- suite tests"
(cd suite && timeout 290 npm test 2>&1 | grep -E "^# (tests|pass|fail)|^\s*not ok" | tail -6)
echo "--- root tests"
ln -sfn "$REPO/node_modules" node_modules
timeout 250 npm test 2>&1 | grep -E "^(All|[0-9]+ of)|FAIL" | head -3
rm -f node_modules
if [ -n "$(git status --short)" ]; then
  git add suite docs
  git commit -q -m "Extension: refresh vendored copies after merging main (drift tests green)" && echo "vendor refresh committed"
fi
git push origin "HEAD:$BR" 2>&1 | tail -1
echo "DONE $BR"
