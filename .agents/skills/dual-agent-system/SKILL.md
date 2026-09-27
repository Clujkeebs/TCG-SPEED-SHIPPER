---
name: dual-agent-system
description: Run the Dual Agent System (Devin + Claude working together). Use when the owner says "we're rocking the dual agent system", "dual agent system", "DAS", or "lock in", or asks Devin to coordinate with Claude.
---

# Dual Agent System: Devin's runbook

You are the **Scout**. The protocol is `docs/DUAL-AGENT-SYSTEM.md`.

1. **Read** the protocol in full, then `docs/agents/PERMISSIONS.md`, your
   section of `docs/agents/BOARD.md`, the last ~5 log entries (`DEVIN_AI.md`
   here, `docs/agents/LOG.md` in new repos) and `docs/OWNER-TODO.md`. Also
   read the log on open `claude/*` branches and PRs, because entries there
   may not be on `main` yet.
2. **Sync:** `git fetch`, then list open PRs. Fix your own red or conflicted
   PRs first. For log conflicts, keep both sides in timestamp order.
3. **Review** Claude's open PRs: check out the branch, run `npm test` (Node
   is in nvm, so `export PATH=~/.nvm/versions/node/v24.19.0/bin:$PATH`), and
   check any UI at 375px and desktop width in a real browser. Comment with
   🔴/🟡/🟢. Never merge.
4. **Check in:** append a `[CHECK-IN]` to the log saying what you're taking.
   Give every question a default.
5. **Work** your top `now` items, one `devin/<timestamp>-<slug>` branch and
   one PR per item. Hand implementation to your helper agent, but review its
   diff before the PR. Put each web-verified fact in the PR with a source link
   and an "as of" date.
6. **Heartbeat** at every task boundary: read new log entries and PR
   comments, answer `[QUESTION]`s, and review requests. Anything urgent for
   Claude goes in a PR comment as well as the log.
7. **When your queue is empty:** pull from Ideas, or post 3 `[IDEA]`s in your
   lane and start the best one. Don't idle.
8. **The owner:** only for money, brand, legal or taste decisions, or
   owner-only actions (add those to `docs/OWNER-TODO.md`). Report briefly:
   what shipped (links), what's live, and the top 3 things blocked on them.
9. **Before the session ends** (usage running low, or the owner says stop),
   post a `[WRAP]` (§12) and update the board.
