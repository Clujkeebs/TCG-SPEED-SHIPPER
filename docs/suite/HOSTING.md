# Hosting the Suite apps

Each Suite app gets its **own address**, not a folder on tcgspeedshipper.com. Browsers keep the storage of
each address separate, so a Suite app can never read the Shipper's sign-in data, and a bug in one cannot
touch the other. The live Shipper server never imports `suite/` and does not serve it.

## Scan test copy (private preview)
- A second Railway service in the same project (name: `suite-scan-preview`), built from `main`.
- Config file: `suite/host/railway.json` (the Shipper's own `railway.json` at the repo root is not used by it).
  Start command: build Scan to a static folder, then serve it with `suite/host/server.js` (no dependencies).
- Redeploys only when something under `suite/scan/`, `suite/shared/` or `suite/host/` changes.
- Private: search engines are told to stay out (`X-Robots-Tag: noindex` and `robots.txt` Disallow). The address
  is not linked anywhere. Camera access is allowed for the app itself and nothing else.
- Health check: `/healthz`. Logs: Railway, service `suite-scan-preview`.
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
