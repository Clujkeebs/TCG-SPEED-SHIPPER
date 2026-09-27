# Installing the Dual Agent System in both agents (owner, one time, ~5 min)

Inside this repo both agents already pick DAS up on their own: Claude via
`CLAUDE.md` and `.claude/skills/dual-agent-system`, Devin via `AGENTS.md`.
To make **"we're rocking the dual agent system"** work in *any* project,
paste these once:

## 1. Devin → Settings → Knowledge → Add knowledge
**Trigger / when to use:** `dual agent system`, `DAS`, `lock in`, or working
with Claude

**Content:**
```
When the owner says "we're rocking the dual agent system" (or "DAS", "lock in"):
follow the Dual Agent System protocol at
https://github.com/Clujkeebs/TCG-SPEED-SHIPPER/blob/main/docs/DUAL-AGENT-SYSTEM.md
You are the SCOUT: web research, SEO, competitor/market scans, fact-checks with
sources, content, prospect lists (public business contacts only), live-site
audits, self-contained front-end work, and reviewing Claude's PRs. Claude is
the BUILDER. Talk only through the repo log (docs/agents/LOG.md, or
DEVIN_AI.md in TCG-SPEED-SHIPPER) and PR comments; claim work in your section
of docs/agents/BOARD.md; owner-only tasks go in docs/OWNER-TODO.md; never
exceed docs/agents/PERMISSIONS.md. Work on devin/* branches, one PR per item,
and never idle: when your queue is empty, pull from Ideas or propose 3 new
ideas. Fix the bugs your own reviews find.
```

## 2. Claude → claude.ai → Settings → Profile → "What personal preferences should Claude consider"
(These apply across Claude surfaces. Inside a repo, `CLAUDE.md` also covers
it.)
```
When I say "we're rocking the dual agent system" (or "DAS", "lock in"), follow
https://github.com/Clujkeebs/TCG-SPEED-SHIPPER/blob/main/docs/DUAL-AGENT-SYSTEM.md
You are the BUILDER (architecture, backend, database, billing, security,
tests, integrations via connectors, code review); Devin is the SCOUT (web
research, content, front-end). If the repo lacks docs/agents/, create it from
§11 first. Coordinate only via the repo log and PR comments, keep an hourly
check-in, respect docs/agents/PERMISSIONS.md, and keep working until I say
stop.
```

## 3. For each new project
Say **"we're rocking the dual agent system"** to both, and give both the same
repo, plus whatever connectors that project needs (e.g. Stripe for Claude).
If the project touches money or trading, fill in `docs/agents/PERMISSIONS.md`
first: what's allowed, limits, kill-switch.
