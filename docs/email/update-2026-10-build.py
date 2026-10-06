import json,sys
ADDR="<MAILING ADDRESS from the Gmail draft>"
URL="https://tcgspeedshipper.com/?utm_source=email&utm_campaign=update-2026-10"
G="#1b4332"; G2="#2d6a4f"; MINT="#d8f3dc"; INK="#1c1b18"; MUTED="#5f5b52"; CREAM="#f7f5f0"
def li(title,txt):
    return f'''<tr><td style="padding:0 0 14px 0;vertical-align:top;width:28px"><div style="width:20px;height:20px;border-radius:10px;background:{MINT};color:{G2};font:bold 13px/20px Arial,sans-serif;text-align:center">&#10003;</div></td>
<td style="padding:0 0 14px 0;font:15px/1.55 Arial,Helvetica,sans-serif;color:{INK}"><b>{title}</b> {txt}</td></tr>'''
def card(tag,title,txt):
    return f'''<tr><td style="padding:0 0 12px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e0d6;border-radius:12px;background:#ffffff"><tr><td style="padding:16px 18px">
<div style="font:bold 11px Arial,sans-serif;letter-spacing:1.5px;color:{G2};text-transform:uppercase">{tag}</div>
<div style="font:bold 19px/1.3 Georgia,'Times New Roman',serif;color:{INK};margin-top:6px">{title}</div>
<div style="font:15px/1.55 Arial,Helvetica,sans-serif;color:{MUTED};margin-top:6px">{txt}</div></td></tr></table></td></tr>'''
def build(plan):
    plan_line={"free":"You're on the free plan, which still gets 10 labels a month, no card needed.",
               "base":"You're on Base. Your price and your 500 labels a month stay exactly the same.",
               "premium":"You're on Premium. Your price and unlimited labels stay exactly the same."}[plan]
    html=f'''<!doctype html><html><body style="margin:0;padding:0;background:{CREAM}">
<div style="display:none;max-height:0;overflow:hidden">Thermal label + slip, paste-anything addresses, and postage with tracking on the way.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:{CREAM}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e4e0d6">
<tr><td style="background:{G};padding:28px 32px 26px">
 <div style="font:bold 12px Arial,sans-serif;letter-spacing:3px;color:#74c69d">TCG SPEED SHIPPER</div>
 <div style="font:normal 30px/1.15 Georgia,'Times New Roman',serif;color:#f4f1ea;margin-top:12px">What's new, and what's coming next</div>
 <div style="font:15px/1.5 Arial,sans-serif;color:rgba(244,241,234,.75);margin-top:10px">October update · from Sam</div>
</td></tr>
<tr><td style="padding:28px 32px 6px;font:16px/1.6 Arial,Helvetica,sans-serif;color:{INK}">
 Hey,<br><br>
 Sam here, the TCGplayer seller behind TCG Speed Shipper. The last two weeks were busy, and almost everything below started as an email from someone using the app. So thank you.
</td></tr>
<tr><td style="padding:18px 32px 4px"><div style="font:bold 12px Arial,sans-serif;letter-spacing:2px;color:{G2}">LIVE NOW</div></td></tr>
<tr><td style="padding:12px 32px 4px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
{li("Thermal printers: label, slip, label, slip.","Add TCGplayer's Packing Slip PDF and each order's slip prints on its own 4x6, right behind its label.")}
{li("Label + packing slip on one page.","One 8.5x11 sheet per order. Cut on the line, done.")}
{li("Bold return address.","Plus a no-divider option if you run a postage meter.")}
{li("Paste addresses from anywhere.","eBay, Whatnot, PayPal, an email. City, state and ZIP can even be on separate lines.")}
</table></td></tr>
<tr><td style="padding:14px 32px 6px"><div style="font:bold 12px Arial,sans-serif;letter-spacing:2px;color:{G2}">COMING NEXT</div></td></tr>
<tr><td style="padding:10px 32px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">
{card("The big one","Postage with tracking, right in the app","Buy USPS postage the way you do on eBay or Whatnot, and it lands in the same PDF as your labels and slips. Tracked letters for envelope orders, Ground Advantage for $49.99+ orders, and tracking numbers filled in for TCGplayer. I'm testing it with real postage on my own orders first, then I'll open it up.")}
{card("Safer accounts","A quick human check and email verification","Keeps bots and fake sign-ups out, nothing extra for you to do.")}
{card("For heavy shippers","A Pro plan","The lowest postage fees plus a few time-savers. More soon.")}
</table></td></tr>
<tr><td style="padding:10px 32px 0;font:15px/1.55 Arial,Helvetica,sans-serif;color:{INK}"><div style="background:{MINT};border-radius:10px;padding:12px 16px">{plan_line}</div></td></tr>
<tr><td align="center" style="padding:26px 32px 8px"><a href="{URL}" style="display:inline-block;background:{G2};color:#ffffff;text-decoration:none;font:bold 16px Arial,sans-serif;padding:14px 28px;border-radius:10px">Open TCG Speed Shipper</a></td></tr>
<tr><td style="padding:18px 32px 28px;font:16px/1.6 Arial,Helvetica,sans-serif;color:{INK}">
 What slows down your shipping day? Just hit reply. I read every one.<br><br>
 Sam<br><span style="color:{MUTED};font-size:14px">Clujkeebs · TCG Speed Shipper</span>
</td></tr>
<tr><td style="background:{CREAM};padding:20px 32px;border-top:1px solid #e4e0d6;font:12px/1.6 Arial,Helvetica,sans-serif;color:{MUTED}">
 <a href="https://x.com/TCGSPEEDSHIPPER" style="color:{G2};font-weight:bold;text-decoration:none">Follow us on X: @TCGSPEEDSHIPPER</a> &nbsp;·&nbsp; <a href="https://tcgspeedshipper.com/support.html" style="color:{G2};text-decoration:none">Help</a><br><br>
 You're getting this one-time update because you have a TCG Speed Shipper account. Don't want updates? Reply "unsubscribe" and you won't hear from us again.<br>
 TCG Speed Shipper · {ADDR}
</td></tr>
</table></td></tr></table></body></html>'''
    text=f'''Hey,

Sam here, the TCGplayer seller behind TCG Speed Shipper. The last two weeks were busy, and almost everything below started as an email from someone using the app. So thank you.

LIVE NOW
- Thermal printers: label, slip, label, slip. Add TCGplayer's Packing Slip PDF and each order's slip prints on its own 4x6, right behind its label.
- Label + packing slip on one 8.5x11 page.
- Bold return address, plus a no-divider option for postage meters.
- Paste addresses from anywhere: eBay, Whatnot, PayPal, an email.

COMING NEXT
- Postage with tracking, right in the app. Tracked letters for envelope orders, Ground Advantage for $49.99+ orders, tracking filled in for TCGplayer. I'm testing it with real postage on my own orders first, then I'll open it up.
- A quick human check and email verification at sign-up.
- A Pro plan for heavy shippers: the lowest postage fees plus a few time-savers.

{plan_line}

Open TCG Speed Shipper: {URL}

What slows down your shipping day? Just hit reply. I read every one.

Sam
Clujkeebs · TCG Speed Shipper

--
Follow us on X: https://x.com/TCGSPEEDSHIPPER
You're getting this one-time update because you have a TCG Speed Shipper account. Reply "unsubscribe" and you won't hear from us again.
TCG Speed Shipper · {ADDR}'''
    return html,text
for plan in ("free","base","premium"):
    h,t=build(plan); open(f"{plan}.html","w").write(h); open(f"{plan}.txt","w").write(t)
print("ok")
