# Chrome Web Store listing: draft (nothing is submitted)

Draft for Sam. Plain words. Do not submit until: the owner has a developer account, the privacy page is public, and (for any TCGplayer helper) "TOS OK" is in `docs/suite/LOG.md`. Checklist: `suite/extension/STORE-CHECKLIST.md`.

## Name
TCG Speed Suite

## Short description (under 132 characters)
Helpers for trading-card sellers: an assistant that plans, remembers and asks before it changes anything. You always click.

## Long description
TCG Speed Suite is a set of helpers for people who sell trading cards.

**The assistant.** Open the side panel and tell it what you want done, in plain words: "reprice my cards 5% under market", "what needs restocking?", "who are my repeat buyers?". It shows you its plan, does the looking-up part, and then stops and shows a card whenever something would change. The card says what will change, why, and how to undo it. Nothing happens until you press Approve.

**Insights from your own order file.** Drop in the order export you already download from TCGplayer. The extension reads it on your computer and shows plain numbers: your repeat buyers (first name and last initial only), where you ship most, your busiest days, your average order and this week against last week. The file is never sent anywhere.

**Five big buttons.** "What should I do today?", "Who are my repeat buyers?", "Where do I ship most?", "Write my weekly summary" and "Draft a reply". No typing needed.

**It remembers your shop.** Tell it "remember that I ship on Tuesdays". You can see every fact it keeps and press Forget on any of them.

**Background jobs.** Save a job (for example, a morning stock check). It runs on its own schedule, leaves you a short report, and puts anything that would change something on a card for you. A small number on the toolbar icon shows how many cards are waiting.

**Weekly list.** Five things worth doing this week, each with the real numbers behind it.

**You stay in control.** A Stop button is always one tap away. Everything stays on your own computer. There are no ads, no tracking and no pop-up notifications.

**Practice mode.** This first version works on a made-up shop so you can see how it behaves before it touches anything real. It does not work on any other website yet.

## One line per permission, and why
- **storage**: remembers your switches and the assistant's notes on your own computer.
- **sidePanel**: shows the assistant next to the page you are on.
- **alarms**: wakes the extension once a minute so a saved job can run on schedule.
- **tcgspeedshipper.com**: lets our own website hand the extension your tracking numbers, to keep on your computer. The website cannot read anything back.
- **seller.tcgplayer.com (optional, asked only if you switch a TCGplayer helper on; not available yet)**: so a helper can fill in a form you already have open, when you click.

## What data stays on the device
All of it. Settings, the orders you import (kept in your browser only), the assistant's memory, waiting approvals, saved jobs and reports, the history of what it did, and any orders or tracking numbers the website hands over are stored in your browser on your computer. Nothing is sent to us or to anyone else. One button in Settings, **Clear everything**, erases all of it. Full text: `suite/extension/PRIVACY.md`.

## Single purpose (store form)
Help trading-card sellers run their shop from one place: an assistant that plans, remembers and asks before it changes anything, and passes their own order and tracking data between our tools on their computer.

## Screenshots to take later (1280x800, with made-up data only)
1. Side panel with a plan and an approval card (what, why, undo).
2. The "five things worth doing this week" list.
3. The memory list with Forget buttons.
3b. The Insights tab after importing a made-up order file (no real buyers).
3c. The five big buttons on the Assistant tab.
4. A background job's report with the toolbar number showing.
5. Settings page with Clear everything.

## Category and language
Productivity · English.
