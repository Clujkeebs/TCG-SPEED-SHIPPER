# TCG Speed Suite: working agreement for every suite session

You are one of several Claude sessions building the Suite. The **Builder session** is the original
chat that runs the live product; it reviews anything that touches production, keeps the owner's
board up to date and owns `suite/shared/`. Read `PLAN.md` first, then this file.

The owner is not technical, works on an iPad, and dislikes clutter and long text. Plain words,
short summaries.

## Read before you start (in this order)
1. `CLAUDE.md`, `AGENTS.md`, `docs/agents/PERMISSIONS.md` (the fence). Ignore the line about an
   hourly check-in: the owner does not want hourly check-ins. Do not create schedules or triggers.
2. `docs/suite/README.md`, `PLAN.md`, this file, `DATA-MODEL.md`.
3. Your kickoff file in `docs/suite/kickoff/`.
4. The last entries of `docs/suite/LOG.md`.

## Scope: where you may write
- Allowed: `suite/<your folder>/`, your own docs under `docs/suite/`, and `docs/suite/LOG.md`
  (append only).
- **Not allowed** without the Builder: `server.js`, `public/`, `test/`, the root `package.json`,
  `netlify/`, `railway.json`, `docs/shipper-hq.html`, `docs/agents/`, `DEVIN_AI.md`, `CLAUDE.md`,
  `AGENTS.md`, `suite/shared/`, and another session's folder. If you need a change there, write it
  in the log under **Needs Builder**, with the exact change you want, and keep going.
- The live site must keep working. The live server never imports from `suite/`.

## Git
- Work on your branch (given in your kickoff). Small commits. Open a PR to `main` at each milestone.
- You may merge **your own** PR (squash) only when all of these are true: every changed file is under
  `suite/` or `docs/suite/`; your folder's tests pass (`cd suite && npm test`); the root `npm test`
  still passes; no secrets, no real buyer data, no model names in the diff. Otherwise leave the PR
  open and say so in the log.
- After a squash merge, restart your branch from `main`
  (`git fetch origin main && git checkout -B <branch> origin/main`). A force-with-lease push is fine
  for **your own** branch only.
- Commit messages end with `Claude-Session: <your session link>`. No model names or identifiers in
  commits, PRs, code or comments. Merging to `main` deploys the live site automatically, so docs
  and `suite/` changes are safe and anything else is not yours to merge.

## Safety and money
- $0 spend. Do not sign up for services, buy data, or call paid APIs. List what you need in the log
  under **Needs owner**, in a sentence a non-technical person understands.
- No keys, tokens or passwords in the repo or in chat. Tests never need them.
- Tests are offline: fixtures and fake data only. Never call TCGplayer from code or tests. Provider
  APIs (Scryfall and similar) only from clearly named dev scripts, with a cache and polite rate
  limits, and only if their terms allow it.
- **TCGplayer gate.** Code that automates TCGplayer pages stays off (feature flag) and is built
  against saved or synthetic HTML fixtures until the Builder writes "TOS OK" in the log.
- Buyer details are sensitive: made-up names and addresses only.
- Do not add analytics, telemetry or third-party scripts.

## The log (`docs/suite/LOG.md`)
Append-only; newest at the bottom. Add an entry at every milestone, whenever you are blocked, and
before you stop. Use this shape:

```
### 2026-10-15 · scan · S0 · done
What changed (2-4 lines).
Numbers: tests 42 pass; ...
Needs Builder: (exact change, or "none")
Needs owner: (one plain sentence, or "none")
Next: (one line)
```

## Quality bar
- A milestone is done when its tests pass, there is a short "how to try it" in your folder's README,
  the log entry is written, and the PR is merged or waiting for the Builder.
- Prefer boring and small: no build tools unless needed, pinned dependencies, no remote code.
- Keep what you measure: accuracy, speed, test counts. The owner decides on numbers.
- Keep going through your milestone list. Stop only at a gate that needs the owner or the Builder, or
  when your list is done. Keep your context small (read big files in parts): you are far cheaper than
  the Builder session, which is why the heavy work happens in these sessions.

## When you stop
End with a summary for the owner in plain words, at most 8 lines: what works, what you measured,
what you need from them, what is next.
