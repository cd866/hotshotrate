# HotshotRate

Free all-miles truck rate calculator + load dashboard for owner-operators  
(built for **Sand Lily Pad LLC** / hotshot O/Os · free for anyone to use).

**Live URL:** https://brewpage.app/hotshotrate/EY9IBADue1  

> Privacy-first: all math and saved loads stay in the browser (`localStorage`). No signup. No backend.  
> Brand: **HotshotRate** (not truckratelab.com).

## What’s improved vs TruckRateLab

| Feature | TruckRateLab | HotshotRate |
|---|---|---|
| All-miles RPM + deadhead/fuel/tolls | Yes | Yes |
| Lease-on % + factoring % | No | Yes (defaults 5% / 0%) |
| Fixed costs (truck note, insurance, trailer, ELD, maint $/mi) | No | Yes |
| TAKE IT / MARGINAL / PASS | TAKE IT / PASS | + MARGINAL (±10%) |
| Target basis (before fee / after fee / net fixed) | Gross only | 3 bases |
| Sand Lily Pad preset | No | Yes (~$1573 note, 5% lease, $1.20 target) |
| Load history + dashboard + CSV | No | Yes (localStorage) |
| Offline PWA shell | Claimed | Service worker + manifest |
| Ads / tracking | AdSense mentioned | None from us |

## Sample math (verified)

Inputs: rate **$1800**, DH **85**, loaded **520**, fuel **$3.89**, MPG **6.5**, tolls **$45**, lease **5%**, factoring **0%**

| Output | Value |
|---|---|
| Total miles | 605 |
| All-miles RPM | **$2.98/mi** |
| Fuel | 93.1 gal → **$362.07** |
| Lease fee | **$90.00** |
| Rate after fees | **$1,710** → **$2.83/mi** |
| True contribution | **$1,302.93** |
| Net after fixed (note $1573/mo @ 8k mi + $0.10 maint) | **$1,123.47** → **$1.86/mi** |
| Verdict vs $1.20 after-fee target | **TAKE IT** |

Screenshots: `screenshot-sample.png`, `screenshot-desktop.png`, `screenshot-live.png`

## Local files

```
/workspace/hotshot-rate/
  index.html
  styles.css
  app.js
  sw.js
  manifest.json
  README.md
  DEPLOY.json          # host metadata + refresh token (do not publish)
```

## Local preview

```bash
cd /workspace/hotshot-rate
python3 -m http.server 4173
# open http://127.0.0.1:4173
```

## Update / redeploy

### Refresh current BrewPage URL (same link)

```bash
cd /workspace/hotshot-rate
python3 - <<'PY'
import zipfile, os
root='.'; out='/tmp/hotshotrate.zip'
skip={'DEPLOY.json','manifest.webmanifest','screenshot-sample.png','screenshot-desktop.png','screenshot-live.png'}
with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
  for dp,_,fs in os.walk(root):
    for f in fs:
      if f in skip or f.startswith('.'): continue
      p=os.path.join(dp,f); z.write(p, os.path.relpath(p, root))
print('wrote', out)
PY

# Owner token is in DEPLOY.json → primary.ownerToken
curl -X PUT "https://brewpage.app/api/sites/hotshotrate/EY9IBADue1?ttl=30" \
  -H "User-Agent: HotshotRateDeploy/1.0" \
  -H "X-Owner-Token: <OWNER_TOKEN>" \
  -F "archive=@/tmp/hotshotrate.zip;type=application/zip"
```

**Note:** BrewPage free TTL max is **30 days** (expires ~2026-10-28). Refresh before then, or move to a permanent host below.

### Permanent hosts (when authenticated)

**GitHub Pages** (preferred once `gh` / GitHub is connected):

```bash
gh auth login
gh repo create hotshotrate --public --source=/workspace/hotshot-rate --push
# Settings → Pages → Deploy from branch main /
```

**Surge.sh**

```bash
npx surge /workspace/hotshot-rate your-name.surge.sh
```

**Netlify / Cloudflare / Vercel**

```bash
npx netlify deploy --dir=/workspace/hotshot-rate --prod
# or: npx wrangler pages deploy /workspace/hotshot-rate --project-name hotshotrate
# or: npx vercel --prod /workspace/hotshot-rate
```

## Deploy status (this build)

- `gh` CLI: **not logged in**
- GitHub MCP: **needsAuth**
- Netlify Drop API: 401 / daily limit without signup
- PagedNet: site create OK, upload IP-blocked from this network
- Surge: requires account token
- **Live now:** BrewPage (above URL)

Connect GitHub (or Surge/Netlify) for a permanent `*.github.io` / custom domain, then swap the share link.
