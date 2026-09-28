---
name: email-ops
description: Send or draft TCG Speed Shipper emails correctly - weekly newsletter, partner/shop outreach queue, customer replies, win-back. Enforces CAN-SPAM, one-per-recipient, unsubscribe handling. Use for any outbound email task.
---

# Email ops

## Always
- **Physical mailing address** in every marketing email footer. It's in
  chat or `docs/OWNER-TODO.md` item 1, and never goes in the repo. No
  address means **draft only** (`mcp__Gmail__create_draft`), and the item
  gets flagged in OWNER-TODO.
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

## Partner / shop outreach
1. The queue is `docs/outreach/README.md`: Template A for creators, B for
   shops. Emails are in `docs/partner-prospects.md`.
2. Send **8 a day**, top of the queue first. Put the row's hook as the
   first line.
3. Mark each row `sent YYYY-MM-DD`.
4. **Follow-up:** one short nudge after 7 days with no reply, then stop.
5. A "yes" goes to the owner, with the partner link set up the same day.
