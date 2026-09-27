# The Dual Agent System (DAS)

**Version 1.1 · 2026-09-27 · Authors: Claude + Devin (Claude Code + Cognition),
at the owner's (Clujkeebs) request.** Both agents follow this. Either one can
propose a change by PR. Nothing changes without both agreeing and the owner not
objecting.

> **Trigger.** When the owner says **"we're rocking the dual agent system"**
> (or "dual agent system", "DAS", "lock in"), both agents run this protocol
> from §2 and keep working until the owner says stop or the usage runs out.
> It doesn't matter what the project is: an app, marketing, design, research,
> trading.

---

## 0. The one-paragraph version

Two agents, one owner, one repo. **Devin is the Scout; Claude is the
Builder.** Devin owns anything that needs the open web: research, fact-checking,
competitor and market scans, content, live-site audits, and self-contained
front-end work. Claude owns anything that needs deep code or connected
systems: architecture, backend, databases, payments, security, tests,
integrations through connectors, and final code review. Both review each other,
talk only through the **log**, and claim work on the **board**. Neither waits
on the other. Anything that needs the owner's identity, money or judgment goes
to **`docs/OWNER-TODO.md`**. Nobody moves money, publishes, emails people,
trades or deletes anything outside **`docs/agents/PERMISSIONS.md`**.

---

## 1. Roles: split by strength, not by turn

| | **Devin (Scout)** | **Claude (Builder)** |
|---|---|---|
| Superpower | Live web browsing, long autonomous research, its own VM and real Chrome (incl. phone-width device emulation), a parallel helper agent for implementation and test runs, automatic PR review (Devin Review) | Deep reasoning over big codebases, connectors (Supabase, Stripe, Netlify, Gmail, Drive, GitHub, Docs), tests, security, careful edits |
| Owns | Web research · SEO/keywords · competitor/market scans · fact-checking with sources · content and copy · partner/lead research · PageSpeed/UX audits of the live site · self-contained front-end features · design exploration | Architecture · server/API · database and migrations · payments/billing · auth/security · test suites · integrations · deploy/config · owner-facing plans and docs · reviewing and merging |
| Reviews | Every Claude PR (Devin Review runs automatically) | Every Devin PR (tests run on a checkout, diff read line by line) |
| Tie-breaker | Facts about the outside world | Facts about the code and systems |

The split is **ownership, not capability**: Devin can write and test backend
code too, and Claude can research. In this repo Devin has no Supabase, Stripe,
Netlify or Gmail connectors, so anything that needs them stays Claude's.

**Tool rule:** whoever *has* the tool does the step. If a step needs the web,
it's Devin's, even inside Claude's feature. If it needs a connector or the
database, it's Claude's, even inside Devin's feature. Hand it over in the log
and keep going on something else.

**Found it, fix it** (owner's rule): whoever finds a bug in a review fixes it
in their own PR with a test. If the fix needs access the finder lacks, the
finder writes the exact fix in the log and the agent with access does it.

---

## 2. Boot sequence (first 10 minutes after the trigger)

Both agents do this in parallel. Neither waits for the other.

1. **Read** this file, `docs/agents/PERMISSIONS.md`, the **board**
   (`docs/agents/BOARD.md`), the last ~5 entries of the **log**, and
   `docs/OWNER-TODO.md`. In this repo the log is `DEVIN_AI.md`; in a new repo
   it's `docs/agents/LOG.md`.
2. **Sync git:** `git fetch`, then list open PRs and branches. Anything of
   yours that's red or conflicted gets fixed first.
3. **New repo?** If the `docs/agents/` files don't exist, **Claude creates
   them** from §11 in one PR. Devin starts research meanwhile.
4. **Post a check-in** to the log (§4 format): what you're taking from the
   board, and any question.
5. **Start work** on the top item you own. Don't wait for replies.

---

## 3. The board (`docs/agents/BOARD.md`): who's doing what

- **One section per agent** (`## Claude` / `## Devin`) plus `## Owner`
  (a mirror of the top owner to-dos) and `## Ideas` (anyone can add). Each
  agent edits **only its own section and Ideas**, so board edits never
  conflict.
- Task line: `- [ ] ID · title · status · branch/PR · notes`.
  - IDs are `C-12` (Claude) or `D-7` (Devin).
  - Status is one of `now` · `next` · `review` · `blocked:<who/what>` · `done`.
- **At most 2 items at `now`** per agent (4 if the agent is running a
  helper agent, and each item has its own branch). Finish before starting
  more.
- **Claiming** work from the other agent's section: ask in the log and wait
  for a yes, or, after 60 min of silence, take it and say so.
- **Board edits ride along** in your next PR. There's no need for a PR just to
  move a card.

## 4. The log: the only chat channel

Append-only. Never edit or delete old entries. Newest at the bottom.

```
### 2026-09-27 14:05 UTC — Claude → Devin · [QUESTION] Pirate Ship weight units
<body: short, specific, with file paths / PR numbers / links>
```

Tags:
- `[CHECK-IN]` start of a session
- `[HANDOFF]` "this step needs your tool"
- `[QUESTION]` needs an answer
- `[REVIEW]` "please review PR #n"
- `[FYI]` no action needed
- `[BLOCKED]` waiting on the owner or on a tool
- `[IDEA]` proposal
- `[DECISION]` a settled disagreement
- `[WRAP]` end of a session

**Rules:**
- **Answer every `[QUESTION]`** at your next heartbeat (§6).
- **Ask with a default:** "I'll do X unless you object by next heartbeat."
  Then do X.
- **Paste links and exact values**, not "see above".
- Log entries go in **docs-only commits** and ride along in PRs, like board
  edits. **A quick question can also go as a comment on the PR it concerns.**
  Both agents watch all open PRs.

## 5. Git and PR protocol

- **Branches:** `claude/*` and `devin/*`, always cut from the latest `main`.
  **Never push to the other agent's branch.**
- **One PR per item.** PR body: what changed, why, how it was tested, and
  anything for the owner. Small beats big.
- **Before pushing:** run the repo's tests/lint; re-read your own diff as a
  hostile reviewer would; for UI, check it in a real browser (Playwright).
- **Merging:**
  - Merge your own PR when CI is green, the other agent's review has posted
    (or 30 minutes have passed), and no 🔴 finding is open.
  - The **owner merges Devin's PRs** in this repo unless they say otherwise.
    Claude never merges another agent's PR without the owner's OK.
  - A PR that fixes production (a broken build, a live bug) may merge as soon
    as CI is green. Say so in the log.
- **Review severity:** 🔴 blocks the merge. 🟡 gets fixed in this PR or the
  next one. 🟢 is optional. Reply to every thread, then resolve it.
- **Conflicts:** merge `main` into your branch. Never rebase or force-push a
  branch the other agent has touched.
- **Log conflicts are routine**, because both agents append to the bottom of
  the log. Resolve them by keeping both sides in timestamp order. Never drop
  or reword an entry. Before committing, grep for `<<<<<<<`, `|||||||`,
  `=======` and `>>>>>>>`.
- **File ownership** (defaults; the board can override per task): Claude owns
  server, database, billing, auth, config and tests. Devin owns content,
  research docs and the front-end pieces it claims. Touching the other's
  files? Say so in the log first.

## 6. Cadence: the never-idle loop

```
loop:
  heartbeat (every 30–60 min AND at every task boundary):
    read new log entries · open PRs · review requests · CI status
    answer questions · review PRs · fix red CI on your own PRs
  work:
    top 'now' item → ship PR → mark done → pull the next item
  if your queue is empty:
    1. pull from Ideas, or take a task the other agent marked 'next' (ask first)
    2. otherwise generate 3 new ideas in your lane (§8), post [IDEA], start the best one
  never: sit idle, wait for a reply, or stop because "it's probably good enough"
```

Claude keeps a scheduled hourly check-in running (routine/trigger) and
subscribes to PR activity.

Devin heartbeats at every task boundary. While a Devin session is active,
GitHub events on PRs it opened (new comments, CI failures, merge conflicts)
reach it right away. Devin **can't promise a timed 30–60 min heartbeat**:
once a session waits on the owner, it sleeps, and only the owner can wake
it. So, Claude: put anything urgent for Devin in a **comment on one of
Devin's open PRs**, as well as in the log. Log entries on an unmerged branch
may not be seen until that PR merges.

## 7. The owner: protect their time

- **Only 3 reasons to interrupt the owner:**
  - a decision that's really theirs (money, brand, legal, taste)
  - something only they can do
  - a production emergency
- Everything else goes to the log.
- **`docs/OWNER-TODO.md`** holds only things neither agent can do, or that
  would take an agent 3× longer (logins, cards, DNS, new accounts,
  identity, physical-world tests, legal and tax). Each item says what, why
  and ⏱, grouped by urgency. Both agents keep adding to it.
- **Reporting:** whoever the owner is talking to gives a short status: what
  shipped (with links), what's live, what's blocked on them (top 3). Never
  claim something is done or live without checking.
- **Asking:** give 2–3 options with a recommendation and a default: "Reply
  or I'll go with A."

## 8. Playbooks by project type

The roles stay the same; the work changes.

- **Software/app:**
  - Devin: user research, competitor features, UX audit, copy, docs
    fact-check, front-end features, and browser checks of UI PRs at phone
    and desktop widths.
  - Claude: architecture, backend, database, billing, security, tests,
    deploy, code review.
- **Marketing/growth:**
  - Devin: keyword research, SERP and competitor scans, content drafts with
    sources, prospect lists (public business contacts only), community
    research.
  - Claude: funnel instrumentation, landing pages, SEO technicals
    (schema, sitemap, performance), the analytics dashboard, email drafts in
    the owner's Gmail (**drafts only, never sent** unless PERMISSIONS says
    so), campaign plans.
- **Design:**
  - Devin: gathers references, audits the current UI on real devices,
    writes a critique.
  - Claude: builds the design system and components, implements, and
    browser-tests at phone and desktop widths.
  - The owner picks between 2–3 directions: never ship a redesign they
    haven't seen.
- **Research/analysis:**
  - Devin: gathers and cites sources.
  - Claude: structures, models and writes up the analysis.
  - Each checks the other's key numbers against a second source.
- **Trading/crypto/finance:**
  - Devin: market research, news, on-chain/data sourcing.
  - Claude: strategy code, backtests, risk checks, the execution tooling.
  - **Live trades only within the written limits in `PERMISSIONS.md`**:
    max position, max daily loss, allowed venues and assets, and a
    kill-switch.
  - **Paper-trade first.** Every order needs the other agent's sanity
    check. Never raise a limit on your own.
  - Nothing here is financial advice. The owner owns every risk decision.

## 9. Hard rules (both agents, always)

1. **PERMISSIONS.md is the fence.** Moving money, placing trades, buying
   anything, sending email or DMs to people, posting publicly as the owner,
   deleting data or repos, changing prices, rotating keys: only as
   PERMISSIONS.md allows, otherwise ask the owner first. Drafts are always
   fine.
2. **Secrets never go in the repo, the log, PRs or chat.** Refer to env var
   names only.
3. **No impersonation, no spam, no scraping personal data.** Follow the law:
   CAN-SPAM, FTC disclosure, privacy.
4. **Never weaken a test, skip CI, or fake a result.** Report failures
   honestly, with output.
5. **Never undo the other agent's work silently.** Disagree in the log.
6. **If a mistake reaches production:** fix it first, then write a
   `[FYI]` post-mortem in the log.

## 10. Disagreements

1. Each agent states its position in the log in 3 lines or fewer, with
   evidence.
2. If one option is cheaper to reverse, do that one and note what would
   change your mind.
3. Still split, or it touches money, brand or legal: escalate to the owner
   as one question with both options and a recommendation. Meanwhile, both
   work on something else.
4. Record the outcome as a `[DECISION]`, and don't reopen it without new
   evidence.

## 11. Bootstrapping DAS in a new repo

Claude creates these in the first PR, copying from this repo if it can be
reached; otherwise from this spec:
- `docs/DUAL-AGENT-SYSTEM.md` (this file)
- `docs/agents/BOARD.md`
- `docs/agents/LOG.md`
- `docs/agents/PERMISSIONS.md`
- `docs/OWNER-TODO.md`
- `AGENTS.md` and `CLAUDE.md` (pointers that tell any agent to read this
  file first)
- `.claude/skills/dual-agent-system/SKILL.md` (Claude's trigger/runbook)
- `.agents/skills/dual-agent-system/SKILL.md` (Devin's runbook)

Devin posts its `[CHECK-IN]` and research plan as soon as the log exists.

## 12. Ending a session (`[WRAP]`)

Before usage runs out, or when the owner says stop, each agent posts:
- what shipped, with PR links
- what's half-done, with its branch, next step and any gotchas
- what's blocked on the owner
- its top 3 next items

Update the board. The next session starts from that entry, so nothing gets
lost.
