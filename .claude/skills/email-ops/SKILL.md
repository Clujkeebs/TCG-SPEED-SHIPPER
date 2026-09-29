---
name: email-ops
description: Send or draft TCG Speed Shipper emails correctly - weekly newsletter, partner/shop outreach queue, customer replies, win-back. Enforces CAN-SPAM, one-per-recipient, unsubscribe handling. Use for any outbound email task.
---

# Email ops

## Always
- **Physical mailing address** in every marketing email footer. Read it
  from the Gmail draft titled "TCGSS mailing address (email footer)"
  (`mcp__Gmail__list_drafts`, query `subject:"TCGSS mailing address"`).
  Never put it in the repo. If the draft is missing, **draft only** and
  flag it in OWNER-TODO.
- **Before any send**, check `in:sent to:<address>`. The Sep 13–25
  campaign already emailed about 200 shops (0 replies). Never double-send.
  Shop cold email is paused (`docs/outreach/README.md`, Findings).
- **One recipient per email.** Never CC or BCC a list. Plain real links,
  never `google.com/url` wrappers.
- **Honor opt-outs:** before sending, search Gmail for
  `(unsubscribe OR "no thanks" OR stop) newer_than:30d`.
  - Newsletter: set `status='unsubscribed'`, `unsubscribed_at=now()`.
  - Outreach: mark the row `opted out`.
- **Customer replies:** follow the owner's instruction for each thread.
  mmuszak34: don't reply again.

## Newsletter (Tuesdays; routine `trig_01DggDU118SsmiK6yzmFuYv8`)
1. The issue is `docs/newsletter/YYYY-MM-DD.md`. Process and footer:
   `docs/newsletter/README.md`.
2. Recipients:
   `select email, unsub_token from tcgss_newsletter_subscribers where status='subscribed'`.
3. For each recipient:
   - Send with `mcp__Gmail__send_message`.
   - Footer: why they got it, their unsubscribe link
     `https://tcgspeedshipper.com/api/newsletter/unsubscribe?t=<token>`,
     and the mailing address.
   - Add UTM to our links: `?utm_source=email&utm_campaign=newsletter-YYYY-MM-DD`.
4. `update … set last_sent_at=now()` for everyone sent to. Log the count
   (never emails) in `DEVIN_AI.md`.
5. Run `node scripts/newsletter-pages.js`. It publishes the issue at
   `/newsletter/YYYY-MM-DD.html`, lists it on `/newsletter.html` and adds
   it to the sitemap. Ship it with the log PR. This step runs even with
   0 subscribers.

## Partner / shop outreach
1. The queue is `docs/outreach/README.md`: Template A for creators, B for
   shops. Emails are in `docs/partner-prospects.md`.
2. Send **8 a day**, top of the queue first. Put the row's hook as the
   first line.
3. Mark each row `sent YYYY-MM-DD`.
4. **Follow-up:** one short nudge after 7 days with no reply, then stop.
5. A "yes" goes to the owner, with the partner link set up the same day.
