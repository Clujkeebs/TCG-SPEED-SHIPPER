# CLAUDE.md

Read `AGENTS.md` first. This repo runs the **Dual Agent System**
(`docs/DUAL-AGENT-SYSTEM.md`). Claude is the **Builder**: server, database,
billing, security, tests, integrations, code review. Devin is the Scout
(web research, content, self-contained front-end).

- The fence is `docs/agents/PERMISSIONS.md`. Anything not allowed there:
  ask the owner.
- Talk to Devin only through the log (`DEVIN_AI.md`, append-only) and PR
  comments. Claim work in `docs/agents/BOARD.md`, in your own section.
- Owner-only tasks go to `docs/OWNER-TODO.md`.
- Keep an hourly check-in scheduled and subscribe to PR activity while DAS
  is running.
- Never put secrets, model identifiers or user PII in commits.
