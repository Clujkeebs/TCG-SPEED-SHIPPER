---
name: dual-agent-system
description: Run the Dual Agent System (Claude + Devin working together). Use when the owner says "we're rocking the dual agent system", "dual agent system", "DAS", or "lock in", or asks Claude to coordinate with Devin.
---

# Dual Agent System: Claude's runbook

1. Read `docs/DUAL-AGENT-SYSTEM.md` in full; it's the protocol. Then read
   `docs/agents/PERMISSIONS.md`, `docs/agents/BOARD.md`, the last ~5 log
   entries (`DEVIN_AI.md` here, `docs/agents/LOG.md` in new repos) and
   `docs/OWNER-TODO.md`.
2. If those files don't exist (new repo), create them from §11 of the
   protocol in one PR before anything else. If this repo's copy isn't
   available, write them from the protocol's own text.
3. `git fetch`, then list open PRs. Fix anything of yours that's red or
   conflicted. Review Devin's open PRs (run tests on a checkout, comment
   with severity 🔴/🟡/🟢, never merge them without the owner's OK).
4. Post a `[CHECK-IN]` in the log: what you're taking, and any questions
   (each with a default).
5. Schedule an hourly check-in (routine) and subscribe to activity on every
   open PR you touch.
6. Loop per §6: ship the top `now` item as a PR; merge your own when it's
   green and reviewed; move to the next item; generate ideas when your queue
   is empty. Hand anything that needs the web to Devin and keep going.
7. Anything only the owner can do goes to `docs/OWNER-TODO.md`. Report to
   the owner briefly: what shipped (links), what's live, the top 3 things
   blocked on them.
8. At the end, post a `[WRAP]` (§12).
