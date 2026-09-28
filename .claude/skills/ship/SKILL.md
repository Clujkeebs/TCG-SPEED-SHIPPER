---
name: ship
description: Ship a change end to end for TCG Speed Shipper - test, commit with attribution, push, open PR, merge, confirm the Railway deploy. Use whenever work is ready to go live ("ship it", "merge", "push this").
---

# Ship

1. **Test:** `npm test 2>&1 | grep -E "FAIL|suites"`. It must end
   `All 14 suites passed` (the count may grow). On any FAIL, fix it and
   rerun. Never skip a test.
2. **UI changes:** take one Playwright screenshot at 390px and one at
   1280px. Start the server with `PORT=87xx node server.js`, run the
   script with `NODE_PATH=$(npm root -g)`, and keep scripts in the
   scratchpad. Look at the screenshots before shipping.
3. **Commit:**
   ```
   git add -A && git commit -q -m "<what and why>

   Co-Authored-By: <from system reminder>
   Claude-Session: <from system reminder>"
   ```
   No secrets, no user emails, no model names.
4. **Push:** `git push -q origin claude/app-audit-improvements-svd7q7`.
   Retry network failures at 2s, 4s, 8s and 16s.
5. **PR:** `mcp__github__create_pull_request` (owner `Clujkeebs`, repo
   `TCG-SPEED-SHIPPER`, base `main`). Body: what changed, how it was
   verified, then the Claude Code line and the session link.
6. **Merge:** `mcp__github__merge_pull_request` with `merge_method: merge`
   and `expectedHeadSha` set to the full 40-character SHA from
   `git rev-parse HEAD`.
7. **Deploy check:** `mcp__Railway__list-deployments` (IDs in
   `ops-facts`, limit 2). If it's still BUILDING, schedule
   `send_later` 10 min out instead of polling. On FAILED, run
   `get-deployment-diagnosis` and fix it now.
8. **Handoff:** add one line to `DEVIN_AI.md` only if Devin needs to know.
   Update `docs/agents/BOARD.md` for C-items.

Batch small related fixes into one PR. Every merge is a deploy, and
deploys are free on Railway.
