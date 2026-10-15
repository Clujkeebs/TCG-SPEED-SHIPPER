# Kickoff: Shipper HQ redesign (session "hq")

You are the **HQ builder**. The repo (`Clujkeebs/TCG-SPEED-SHIPPER`) is checked out on `main`. Your
branch: `suite/hq`. Read first: `CLAUDE.md`, `AGENTS.md`, `docs/agents/PERMISSIONS.md`,
`docs/suite/README.md`, `PLAN.md`, `WORKING-AGREEMENT.md` and the newest entries of `LOG.md`.

**Shipper HQ** is the owner's private control board: a published Artifact at
<https://claude.ai/artifact/Rkn4p1xzK8PVpV7pJaAMTh>, source in `docs/shipper-hq.html`. Today it is
a single column with a to-do list and four tabs hidden in a footer nav. The owner wants it to be
the one home for the whole business.

## Who it is for
The owner: not technical, works on an **iPad** (portrait and landscape), hates clutter and long text
("so many words", "too busy"). He wants short steps, one clear next thing, priority order with
security first, and a quick way to see what changed while he was away.

## What he asked for (night of Oct 14, tidied)
1. **Link everything** in the HQ: the marketing plan, the Google Ads kit, the meeting notes, setting
   up Granola for the meeting, "and much more".
2. **Bring the roadmap and the big-picture parts from the bottom to the top.**
3. **Improve the overall design.**
4. **Look for more things to do** (new ways to grow the business) and add them.
5. **Bring the Suite to-do list into the HQ** (Scan, Chrome extension, Agent, later one site per
   product).
6. The long game: TCG Speed Suite plus a site for each product, "a TCGplayer empire".

## How it works today (read the source first)
- `docs/shipper-hq.html`: one file with CSS, HTML and JS (about 870 lines). Tasks are JS objects
  `T.<id> = { id, title, why, steps, copy?, unlock?, hot?, min }`, grouped in `STAGES` (P1 security,
  P2 postage, P3 free growth, P4 paid growth, P5 content and decisions, P6 housekeeping, P7 Suite).
  Other tabs are built from `BUILD` (roadmap rows), a money plan and a Pitney Bowes guide. A chat
  dock ("Ask Claude") uses the `sample` capability and writes to the inbox.
- Data lives in the Artifact database (capabilities `db` and `sample`). Collections:
  `progress` (one document per task id: `{ at, done, note }`: the owner's ticks and notes) and
  `inbox` (`{ at, from: "owner"|"claude", text }`). **Never delete or overwrite these.** The page
  reads them and writes the owner's changes. Read them with the `ArtifactData` tool to see real data.
- The owner's notes sometimes contain Claude's answers appended below his words. Keep notes
  editable text.

## Target (you may improve on it; keep the goals)
Navigation at the **top**, sticky, big tap targets: **Now · Roadmap · Suite · Library · Meetings ·
Ideas**. Keep the Pitney Bowes guide and Money plan reachable (inside Roadmap or Library).

- **Now** (default): "While you were away" (the newest `inbox` posts from Claude, three lines each,
  expandable), one **Next up** card, then open tasks in priority order (security first), "Do now"
  then "After that"; Done stays collapsed. Each task keeps its why, steps, copy buttons, note box
  and tick.
- **Roadmap** (moved up from the footer): the money ladder (today about $40/month, then $100, $1k,
  $10k) with where we are, this week / next / later, the postage launch path, the Suite roadmap, and
  the long game in three lines.
- **Suite**: one card per product (Scan, Chrome extension, Agent, later the sites), each with status,
  the milestone checklist from `docs/suite/PLAN.md` section 6 (S0 to S3, X0 to X3, A0 to A4), the
  latest line from `docs/suite/LOG.md`, and the owner's Suite tasks (S1 to S5). Live data comes from a
  DB collection `suite` that the Builder session writes: document `status` =
  `{ updatedAt, products: [{ id, name, state, milestone, line }], log: [{ at, who, line }] }`.
  Show good defaults when it is empty (initial facts below) and a clear "updated <time>" stamp.
- **Library**: every important link, grouped, one line each. Most-used shortcuts first. See the list
  below. Build repo-doc links as
  `https://github.com/Clujkeebs/TCG-SPEED-SHIPPER/blob/main/<path>`; list `docs/` to find the real
  files and write a one-line description for each.
- **Meetings**: the next call (Pitney Bowes; **no date yet**, we are waiting on Linda), the five
  questions (task A15), the Granola checklist (below), a notes box that saves to a `meetings`
  collection (`{ at, title, text }`), the list of saved notes, and a line: "After the call, tell
  Claude 'call notes are in'."
- **Ideas**: a ranked list of things to do next (seed list below; research and add more, each with a
  source or a reason). Each idea: what, why in one line, impact, effort, who does it (Claude or the
  owner). Buttons: **Do this** (posts "go idea <id>" to the inbox) and **Not now** (saved in an
  `ideas` collection as `{ status }`).

## Design rules
- Calm and quiet. Fewer boxes, one accent, consistent spacing, short copy, no emoji decoration, no
  duplicate information. Dark is fine (the owner never complained about the HQ look); keep both
  themes working if you change it.
- Test at 820×1180 and 1180×820 (iPad) and 390×844 (phone). No horizontal scroll. Look at your own
  screenshots before publishing.
- The page must work with an empty database and must not break the owner's existing data.
- Load the `artifact-design` guidance and, for anything stored or uploaded, the
  `artifact-capabilities` skill. **Uploads:** if this user has the `assets` capability, add an upload
  box in the Suite tab for (a) a TCGplayer inventory export (CSV) and (b) about 50 card photos, so the
  owner can add them from his iPad. If not available, say so in the log and use a note box instead.
- Update stale text as you go: A17 is gone (closed), B11 and B12 are done, sign-up codes are on.

## New owner tasks to add (short, plain words, with steps and minutes)
- **B13 · P1 · 3 min · Test the sign-up code with a second email.** Sign-up codes went live Oct 14.
  Steps: open tcgspeedshipper.com in a private tab → Create Account with a different email (a Gmail)
  → find the 6-digit code from hello@tcgspeedshipper.com (check spam) → type it. Write "code worked"
  or what the screen said. If anything fails, Claude switches codes off in one step.
- **G12 · P2 · 10 min · Set up Granola for the Pitney Bowes call.** Steps: (1) install Granola
  (granola.ai: Mac, Windows and iPhone apps; an iPad app is unconfirmed) on the device you will take
  the call on and sign in; (2) connect your calendar so it spots the meeting; allow the microphone
  (and system audio on a computer); (3) at the start of the call say "I use an AI note-taker, OK?"
  and start Granola; jot a few words during the call; (4) in claude.ai go to Settings → Connectors →
  add a custom connector with the URL `https://mcp.granola.ai/mcp` and sign in, so Claude can read the
  notes (Claude cannot do this sign-in itself); (5) after the call write "call notes are in".
  Facts to show honestly: the connector only sees notes the owner owns, and the Basic plan gives 30
  days of history.
- **S4 · P7 · later · Send one real TCGplayer inventory export.** Why: Scan's CSV must match
  TCGplayer's real file. Steps: Seller Portal → the page where you manage your listings → Export
  (CSV) → add it in the Suite tab's upload box (an inventory export has no buyer details).
- **S5 · P7 · later · About 50 photos of cards for Scan testing.** Steps: plain surface, normal light,
  one card per photo straight on, mixed games (Magic, Pokémon, Yu-Gi-Oh!, One Piece), some foils, a
  few in sleeves or toploaders; add them in the Suite tab's upload box.
Existing Suite tasks S1 (say "go suite"), S2 (TCGplayer's rules) and S3 (testers) stay.

## Initial facts for the Suite tab (until the `suite` collection has data)
- **Scan**: S0 done (price rules, CSV writer marked unverified, search, queue, offline phone app);
  next S1 camera and OCR. **Extension**: X0 in progress (Manifest V3 skeleton, flags off, tests).
  **Agent**: A0 starting. **Sites**: not started; needs domains (owner).
- The one-page plan: <https://claude.ai/artifact/PCzahciuSwBBzRPDrABhnu>.

## Library: links to include
- Live: tcgspeedshipper.com, /admin/ (owner only), /blog/, /newsletter.html.
- Dashboards (open in a new tab): Stripe `https://dashboard.stripe.com`; Railway project
  `https://railway.com/project/21eb3344-88af-4a90-a884-da7682ad7b13`; Supabase
  `https://supabase.com/dashboard/project/lwqnsvlfffugyvwblqaz`; Resend `https://resend.com/domains`;
  Porkbun `https://porkbun.com/account/domainsSpeedy`; Google Search Console
  `https://search.google.com/search-console`; Cloudflare `https://dash.cloudflare.com`; X
  `https://x.com/TCGSPEEDSHIPPER`; Pitney Bowes `https://360.pitneybowes.com`; USPS Business Customer
  Gateway `https://gateway.usps.com`; GitHub repo `https://github.com/Clujkeebs/TCG-SPEED-SHIPPER`.
- Artifacts: Growth Plan `https://claude.ai/artifact/Bwpi2HBJ6DfTAAxTxWKtfZ`; Google Ads Kit
  `https://claude.ai/artifact/7uWBkF4HbeRisfsVjyF9Yu`; Suite plan
  `https://claude.ai/artifact/PCzahciuSwBBzRPDrABhnu`.
- Repo docs (look at `docs/`): `MARKETING-PLAN.md`, `pricing-plan.md`, `postage-go-live.md`,
  `competitors.md`, `community-channels.md`, `partner-prospects.md`, `outreach/README.md`,
  `newsletter/README.md` and the issues, `google-ads/` (README, START-HERE.html, ALL-AD-COPY.txt),
  `research/` (road-to-10k, chrome-extension, tracked-envelope-postage), `suite/` (PLAN, LOG, DATA-MODEL),
  `agents/MORNING-PLAYBOOK.md`, `OWNER-TODO.md`, `DUAL-AGENT-SYSTEM.md`.
- Do **not** put secrets, customer emails, the mailing address or the USPS Mailer ID in the page source.

## Ideas: seed list (research and extend; rank by impact over effort)
1. Welcome email series through Resend (now unblocked). Claude. 2. Move the weekly newsletter to
Resend (no Google link wrappers). Claude. 3. Charge a plan-upgrade difference at the moment of
upgrade (Rob's surprise $8.99). Claude, needs the owner's yes. 4. Free SEO tool pages: TCGplayer fee
calculator, envelope-versus-package cost calculator. Claude. 5. Weekly guides for Lorcana, One
Piece, Flesh and Blood, sports. Claude. 6. eBay and Whatnot CSV presets (needs sample files). Claude.
7. Pro plan and new prices. Claude, needs the C5 answer. 8. Partner and affiliate push to card
shops and YouTubers (`docs/partner-prospects.md`). Owner sends, Claude drafts. 9. Silent captioned
demo video. Claude, owner posts. 10. Weekly community posts. Owner posts, Claude drafts. 11. Failed
payment recovery emails and an annual-plan nudge. Claude. 12. Seller Stories application (task D4).
Owner. 13. Uptime and error alerts by email. Claude. 14. Suite landing pages and brand for Scan, Agent
and the Suite, ready for domains. Claude builds, owner buys domains. Add at least eight more, each
with a reason you can back up.

## Working rules
- You may edit `docs/shipper-hq.html` and add files under `docs/hq/` and `docs/suite/`. Do not touch
  anything else. Open a PR; you may merge it yourself (squash) only if just those files changed and
  the root `npm test` passes. Commits end with `Claude-Session: <your session link>`; no model names.
- Keep a scratchpad copy of the page in sync with the repo file and publish to the existing artifact
  URL (read it first so the publish is accepted). Check the published page once after publishing.
- $0 spend. Send no email, post nothing. Never delete the owner's data.
- Append a short entry to `docs/suite/LOG.md` when you finish. End with a summary of at most 8 lines
  for the owner, in plain words.
