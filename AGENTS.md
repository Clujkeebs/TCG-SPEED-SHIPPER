# AGENTS.md

This repo runs the **Dual Agent System** (Claude = Builder, Devin = Scout).
**Every AI agent reads `docs/DUAL-AGENT-SYSTEM.md` before doing anything.**
Then read `docs/agents/PERMISSIONS.md`, `docs/agents/BOARD.md`, the log
(`DEVIN_AI.md`, newest entries at the bottom) and `docs/OWNER-TODO.md`.

If the owner says "we're rocking the dual agent system" (or "DAS", "lock
in"), run the boot sequence in §2 of that doc and keep working per §6 until
told to stop.

Project facts (architecture, billing rules, auth model) are in `DEVIN_AI.md`.
Tests: `npm test`.
