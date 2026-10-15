# Hosting the Suite apps

Each Suite app gets its **own address**, not a folder on tcgspeedshipper.com. Browsers keep the storage of
each address separate, so a Suite app can never read the Shipper's sign-in data, and a bug in one cannot
touch the other. The live Shipper server never imports `suite/` and does not serve it.

## Scan test copy (private preview)
- A second Railway service in the same project (name: `suite-scan-preview`), built from `main`.
- Settings live on the service in Railway (set with `update-service`), not in a file, because the repo's root
  `railway.json` is shared by both services. That file now holds only the health check (`/api/health`, which
  both servers answer) and the restart policy. The Shipper starts with `npm start`; do not put a
  `startCommand` back in it, or it would override the preview's own start command.
- Start command: `node suite/scan/build.js suite/scan/dist && node suite/host/server.js suite/scan/dist`
  (builds Scan to a static folder, then serves it; no dependencies).
- Watch paths: `suite/scan/**`, `suite/shared/**`, `suite/host/**`, so it redeploys only when those change.
- Private: search engines are told to stay out (`X-Robots-Tag: noindex` and `robots.txt` Disallow). The address
  is not linked anywhere. Camera access is allowed for the app itself and nothing else.
- Health check: `/api/health` (also `/healthz`). Logs: Railway, service `suite-scan-preview`.
- Cost: one small Node process, well under a dollar a month of the Hobby plan's usage.
- Rollback: delete the service in Railway. Nothing else depends on it.

## Going public later
1. Pick the name (Sam's call; see SITES-PLAN.md). Add it as a custom domain on the service
   (Claude does this with `generate-domain`; Sam adds the one DNS record Railway shows at Porkbun).
2. Set `HOST_NOINDEX=0` on the service so search engines may list it.
3. Add the new address to the extension's allow-list only if the extension needs to talk to it.

## Other apps
`node suite/host/server.js <folder>` serves any built static folder. The Agent and the extension do not need
this: the extension is a zip for Chrome, and the Agent runs inside it.
