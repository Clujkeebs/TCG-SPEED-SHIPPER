# Agent proxy: built, switched off

Why: the Agent needs a model API key. A key inside the extension or a web page can be copied by anyone.
So the key lives on our server only, and the extension talks to a small proxy that checks who is asking,
enforces limits, and forwards the request.

**Status (2026-10-16): built and tested, OFF.** Code: `agent-proxy.js` (mounted in `server.js`), tables and
functions: `docs/db/2026-10-16-agent-usage.sql` (applied), tests: `test/agent-proxy.test.js`. It does nothing until
the owner sets the variables in "Settings" below. Until then the Agent runs on its scripted test model.
The Agent code in `suite/agent/` has the other half: `adapters/anthropic.js` (the model call), `limits.js`
(per-run and per-day caps) and `protocol.js` (side panel messages).

## Flow
```
side panel  --(agent.ask)-->  Agent engine in the extension  --(HTTPS + login token)-->  /api/agent/messages
                                  runs tools on the seller's device                          checks user + limits
                                  (orders, stock stay local)                                 adds our key, forwards
                                                                                             counts tokens and cost
```
Tools run on the seller's device. Only the conversation (questions, tool results) goes to the proxy.

## How to call it (Agent and Extension sessions)
```
POST /api/agent/messages        Authorization: Bearer <the user's site login token>
{ "messages": [...], "tools": [...] }          JSON, at most 60 KB
```
- **A conversation is one question** and what the Agent did to answer it:
  `[user question, assistant (with tool_use), user (tool_results), assistant, user (tool_results), ...]`, always ending
  on a user message. The first message is plain text. Each set of tool results answers exactly the tools the assistant
  used. A request with one message starts a run; the message count says which step it is (at most 8).
- `tools` are the registry's specs as they are (`name`, `description`, `input_schema`). Names with dots
  (`orders.search`) are fine: the provider only accepts letters, digits, `_` and `-`, so the server renames `.` to `__`
  on the way out and back on the way in. A tool name that already contains `__` is refused.
- Do **not** send `model`, `max_tokens` or `system`. The server sets all three and ignores yours. Anything else not
  listed here (`cache_control`, `tool_choice`, images, ...) is dropped.
- Reply (200): `{ content: [text | tool_use blocks], stopReason, usage: { inputTokens, outputTokens },
  costCents (whole cents, rounded up), costMillicents, remaining: { runsToday, centsToday, centsMonth } }`.
- Errors are `{ error: "plain words for the seller", code }`:

| Status | code | Meaning |
|---|---|---|
| 400 | `bad_request` | the request is not shaped as above |
| 401 | | not logged in |
| 402 | `plan` | the plan does not include the Agent |
| 403 | `blocked` | switched off for this account |
| 413 | `too_big` | over 60 KB |
| 429 | `runs` `calls` `day` `month` `global` `steps` `busy` | over a limit; `resetsAt` (UTC) says when it comes back; `busy` = one request at a time per user |
| 502 | `model_error` | the model could not answer (nothing from the provider is passed on) |
| 503 | `off` `try_again` | switched off or not configured; or a temporary problem |

`GET /api/agent/status` (logged in, spends nothing) returns `{ available, code?, limits, remaining }`, so the panel can say
"3 runs left" before asking. From an extension service worker with host permission for the site no CORS setup is needed;
a web page on another origin would need an allowlist added first.

## Settings (Railway variables; only the key is a secret)
| Variable | Default | Meaning |
|---|---|---|
| `AGENT_PROXY` | off | `on` switches it on. Anything else is off. **This is the kill switch** (Railway redeploys in about a minute). |
| `ANTHROPIC_API_KEY` | none | the key (owner only, never in the repo or a log) |
| `ANTHROPIC_MODEL` | none | the model id |
| `AGENT_CENTS_PER_MILLION_IN` / `_OUT` | none | the provider's current price, in cents per million tokens, input and output (check the price list; $3 is 300). Both are required: a missing price would make every call look free, so it stays off |
| `AGENT_PLANS` | `premium,pro` | plans that get the Agent |
| `AGENT_RUNS_PER_DAY` | 5 | questions per user per UTC day |
| `AGENT_CENTS_PER_DAY` / `_PER_MONTH` | 25 / 150 | spend per user |
| `AGENT_GLOBAL_CENTS_PER_DAY` | 500 | spend for everyone together: **the most a day can ever cost** |
| `AGENT_STEPS_PER_RUN` | 8 | model calls per question |
| `AGENT_MAX_TOKENS` | 1024 | answer length cap per call |
| `AGENT_MAX_INFLIGHT` | 20 | requests being answered at once |
| `AGENT_TIMEOUT_MS` | 40000 | give up on the provider after this long |

A bad value falls back to the default shown, never to "unlimited". `/api/health` shows `agent_proxy` as `off`, `on` or
`on_not_configured` (a variable is missing) and never a value.

## How it counts
- Money is kept in millicents (1/1000 cent). Before each model call the server **reserves the worst case** (one token per 3
  bytes in, `AGENT_MAX_TOKENS` out) and after the call **settles to the real cost** from the provider's own token counts.
  Both happen under one database lock, so two requests at once, or two copies of the server during a deploy, cannot both
  pass a limit that has room for one. Tested on a real Postgres with 12 requests at once against room for one: exactly one won.
- The provider refuses the call (error, busy): nothing was produced, so the call, the run and the money are taken back.
  The call is lost (timeout, unreadable answer): it may have been billed, so the worst case stays charged. A crash between
  reserve and settle also leaves it charged. Every failure leans toward the owner's money.
- Limits are per UTC day (runs, calls = runs x steps, spend), per month (spend) and for everyone per day (spend).
  Honest caveat: a client that lies about its history can dodge the *run* count, never the *money*: calls and spend are
  counted on every request, so the worst a forged client can do is the same 25 cents a day.
- Only counts and cost are stored. Never the conversation, never the buyer's words. Nothing from a request is logged, and the
  key is never logged or returned; a provider error shows the seller a plain sentence and the log gets the HTTP status and
  error type only.
- Switch one person off: add a row to `tcgss_agent_blocks` (user id, reason). Switch everyone off: `AGENT_PROXY` to `off`.

## Key handling
- The key is one environment variable on the server (owner sets it; secrets are owner-only per `docs/agents/PERMISSIONS.md`).
- Never sent to a browser, never logged, never in the repo or in an error message. The adapter reads it from the environment only.
- If it leaks: rotate it in the provider console, set the new value, done. No code change.
- Server-side kill switch: one env flag turns the proxy off for everyone (503). A per-user switch is a column on the usage table.

## Per-user limits (proposed numbers, the owner decides)
| Limit | Proposal | Why |
|---|---|---|
| Plan | Premium only at first | cost, see below |
| Runs per day | 5 | a "run" is one question and everything the Agent does to answer it |
| Spend per day | 25 cents | the hard stop, counted from real token usage |
| Spend per month | 150 cents | about a third of what Premium brings in per month ($59 a year) |
| Model calls per run | 8 | matches `maxSteps` in `loop.js` |
| Request size | 60 KB | tool results are trimmed before sending |
| Concurrent runs | 1 per user | `protocol.js` already allows one at a time |
| Output tokens per call | 1,024 | adapter default |

The extension also enforces these locally (`limits.js`) so the panel can say "you have 3 runs left"
without a round trip. The server is the one that counts: the extension is only a convenience.

## Cost per run (an estimate, not a measurement)
Formula: `cost = (input tokens × input price + output tokens × output price) ÷ 1,000,000`, summed over every model call in the run.

Illustration only, assumptions stated: a run makes 3 model calls; each call sends about 4,000 tokens
(tool list, conversation so far, tool results) and gets back about 300. That is 12,000 in and 900 out.
If input costs $3 and output costs $15 per million tokens (**an assumed price list; check the current
one before trusting any number here**):
- input 12,000 × $3 ÷ 1M = 3.6 cents; output 900 × $15 ÷ 1M = 1.35 cents; **about 5 cents a run**.
- 5 runs a day for a month is about $7.50, **more than Base ($2.99 a month) brings in and more than Premium ($59 a year) allows**. Hence the monthly cap above: 150 cents is roughly 30 runs a month.
- Savings to try (measure each): keep the tool list short, reply caching for the unchanged start of the conversation, trim tool results, and use the cheapest model that picks tools correctly.

What to measure first, with a real model and a small budget the owner sets: tokens per run for the 24
scenarios in `AGENT-EVAL.md`, tool-choice accuracy, and how often a run hits the step limit. The proxy
records tokens and cost per run so these are real numbers after one week.

## Privacy
- Orders and stock stay on the device. The proxy never sees them except as far as tool results are part of the conversation.
- Tool results use `buyerKey`, not names or addresses. `support.draftReply` returns `{{first_name}}` and the device fills the name in (fixed 2026-10-15, tested), so no buyer name reaches the model.
- The server stores, per call: user id, time, token counts, cost, outcome. **Not** the conversation text.
- Terms and privacy text need a sentence saying a question and tool results are sent to a model provider.

## What is left
1. **Agent session:** a `proxy` adapter next to `adapters/anthropic.js` that posts `{ messages, tools }` to the endpoint with the
   login token and returns `{ content, costCents }` like the other adapter; show `remaining` and the plain-words errors (`code`,
   `resetsAt`). Do not send `system` or a model name. Tests against a stub, like the others. Keep `adapters/anthropic.js` for
   local experiments only: the real model must go through the proxy.
2. **Extension session:** get the site login token to the service worker (through the bridge) and use the proxy adapter; the side
   panel shows what is left.
3. **Owner, later, when the Agent is ready for a real-model test (costs money, bounded by the numbers above):** make a key in the
   provider's console with its own spend limit, then put `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, the two prices and
   `AGENT_PROXY=on` into Railway. Decide the limits table above (the defaults are the proposal).
4. Terms and privacy text need one sentence: a question and tool results are sent to a model provider.
