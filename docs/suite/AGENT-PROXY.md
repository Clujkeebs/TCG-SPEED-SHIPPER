# Agent proxy: design (nothing built on the server yet)

Why: the Agent needs a model API key. A key inside the extension or a web page can be copied by anyone.
So the key lives on our server only, and the extension talks to a small proxy that checks who is asking,
enforces limits, and forwards the request. This page is the plan for the Builder. The Agent code in
`suite/agent/` already has the other half: `adapters/anthropic.js` (the model call), `limits.js`
(per-run and per-day caps) and `protocol.js` (side panel messages).

## Flow
```
side panel  --(agent.ask)-->  Agent engine in the extension  --(HTTPS + login token)-->  /api/agent/messages
                                  runs tools on the seller's device                          checks user + limits
                                  (orders, stock stay local)                                 adds our key, forwards
                                                                                             counts tokens and cost
```
Tools run on the seller's device. Only the conversation (questions, tool results) goes to the proxy.

## One endpoint
`POST /api/agent/messages`, logged-in users only (the same session the site already uses).
- In: `{ messages, tools }` (the same shape the adapter sends). The **model name, token cap and system
  prompt are set by the server**, never taken from the request.
- Out: the model's reply plus `{ usage: { inputTokens, outputTokens }, costCents, remaining: { runsToday, centsToday } }`.
- Errors: 401 not logged in · 402 plan does not include the Agent · 429 over a limit (body says which and when it resets) · 503 kill switch on.

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

## What the Builder needs to do (the Agent session cannot touch these)
1. `server.js`: add the route above, behind login, with the checks and the kill switch.
2. Supabase: additive table `tcgss_agent_usage` (user id, day, runs, cents, input and output tokens), RLS on, server-only writes.
3. Owner: set the provider key and the model name as environment variables (secret values are owner-only).
4. Owner: decide the limits table, and whether the Agent is Premium only.
5. Extension session: wire `protocol.js` to `chrome.runtime` messaging and the side panel UI.
