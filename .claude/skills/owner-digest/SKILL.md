---
name: owner-digest
description: Refresh docs/OWNER-TODO.md against reality and send the owner one short digest. Use for the daily digest, the morning note, or when the owner asks "what do I need to do".
---

# Owner digest

The owner reads on an iPad, in plain words. Give steps, not file paths.

1. Check reality, in parallel:
   - the `health-check` skill (short form)
   - the `funnel` skill
   - Gmail replies:
     `in:inbox newer_than:2d -from:me`
   - Railway `domain-status` for www
2. Edit `docs/OWNER-TODO.md`:
   - Tick off anything now true.
   - Reorder "🏠 When you get home" so blockers come first. The mailing
     address blocks all marketing email.
   - Keep each item to what + where to click + time.
3. Ship it (the `ship` skill; a docs PR is fine).
4. `SendUserFile` `docs/OWNER-TODO.md` with status `proactive` and a
   one-line caption.
5. In chat, send at most 6 lines: what shipped, the numbers, and the top
   3 to-dos.
