# Measuring what the Agent costs per question

The estimate in `AGENT-PROXY.md` is about 5 cents a question. It is a guess on assumed prices. This plan replaces it with
numbers from a real model, for a few cents. Nothing here is switched on yet.

## What we run
Six of the 24 offline scenarios, in this order (`eval/measure.js`, `FIRST_SCENARIOS`):

| # | Question | Why it is in the first six |
|---|---|---|
| 1 | Who are my repeat customers? | one obvious tool: the baseline |
| 2 | How often do I ship, and where to? | one tool, with a near-miss tool next to it |
| 3 | What should I restock? | must pick the restock tool, not a generic search |
| 4 | What should I list Lightning Bolt (M11) at? | two steps in a row: search, then price |
| 5 | Give me this week's summary | two good tools; either counts as right |
| 6 | Buyer on ORD-1010 asks where their order is | a draft tool, and it must find the order number in the sentence |

Left for later: the sync, deal and "asked to email a buyer" scenarios. The trap scenario that names a tool that does not
exist cannot be measured with a real model.

## The three numbers (plus the cost)
1. **Tokens per question** (in and out, from the server's own counts). Tells us the real price. Tool descriptions alone are
   roughly 2,300 tokens on every call. If a question averages over about 12,000 tokens, send fewer or shorter tools.
2. **Chose the right tools** (share of questions). Under 90% means fix the tool descriptions first, before anything else.
3. **Hit the 8-step limit** (share of questions). More than 1 in 20 means a tool is confusing the model.

The report also shows the cents the server counted per question, to compare with the 5 cent guess.

## Cost and limits
Six questions at the 5 cent guess is about 30 cents. The default limit is 5 questions and 25 cents per person per day, so
**day one runs five questions and the sixth waits for tomorrow**. For one measuring day the owner could raise
`AGENT_RUNS_PER_DAY` to 10 and `AGENT_CENTS_PER_DAY` to 100, then put them back. The 500 cent "everyone together" cap stays
as it is. The script also has its own budget (`--budget-cents`, default 10) and stops by itself when it is used up or the
server says a limit is reached.

## How to run it
```
node suite/agent/eval/measure.js --stub                 safe: a stand-in server, invented numbers, spends nothing
node suite/agent/eval/measure.js --live --base-url https://tcgspeedshipper.com --budget-cents 25 --yes-spend-money --out measure.md
```
`--live` needs `AGENT_LOGIN_TOKEN` (the site login token) in the environment. It is never printed or written down.
Tests only use the stand-in. The script only asks questions: it sends nothing to a buyer and changes no listing.

## Report format (this example is from the stand-in: the numbers are invented)
```
6 questions measured, 14.55 cents of a 50 cent budget used.
1. Tokens per question: 6870 on average (median 6180; 6567 in, 303 out).
2. Chose the right tools: 100% of questions.
3. Hit the 8-step limit: 0% of questions.
Cost the server counted: 2.43 cents per question on average, 3.6 at most.
```
Then one table row per question: steps, tokens in/out, cents, tools called, right tools yes/no, step limit yes/no.

## For the owner, when the time comes
"Turn on a real model (costs money)": make a key with its own spend limit, set the five Railway variables in `AGENT-PROXY.md`,
then ask the Agent session to run the six questions. Expect well under a dollar.
