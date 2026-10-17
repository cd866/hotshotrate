# Black Ram Towing

Installable phone app for Sand Lily Pad LLC’s hotshot business, doing business as **Black Ram Towing**, leased onto Totni Enterprise’s MC authority. Rig: 2026 Ram 3500 dually and a 40 ft Big Tex gooseneck.

**Live:** https://cd866.github.io/hotshotrate/

Static HTML, CSS, and JavaScript. No build step. GitHub Pages serves the repository root.

## Tabs

1. **Load check.** Enter a rate, loaded miles, deadhead miles, weight, optional cities, tarp, and optional hours. The verdict is TAKE IT, NEGOTIATE, or PASS, with all-miles $/mi, loaded $/mi, the Totni fee, estimated fuel, net kept, and net per hour.
2. **Reports.** Month-to-date numbers from `data/feed.json`: gross, Totni fees, fuel, other expenses, net, $/loaded mile, loads, cancelled loads, and day notes. Fresh fetch on open, pull to refresh, last-updated time, and an offline copy.
3. **KPIs.** Revenue per loaded mile and per all-miles, deadhead %, loads per week, truck utilization, net margin, fuel per mile, Totni fees, break-even against the trailer payment and insurance, plus week-over-week and month-over-month charts. Short history says “Not enough data.”

## Defaults

Saved on the phone (localStorage):

| Setting | Default |
|---|---|
| Totni fee | 13% |
| Pass / negotiate floor | $2.40 per all-miles (deadhead counts) |
| Take line | $3.00 per all-miles |
| Trailer payment | $434.84 / month |
| Insurance | $0, badged **Set this** until you enter it |
| Deck warning | over 15,000 lb |
| MPG and diesel | estimates, badged **EST** |

Under the floor is PASS. From the floor up to the take line is NEGOTIATE. At or above the take line is TAKE IT. MPG, diesel price, and hours inferred from miles are estimates.

## How the feed gets updated

The internal dashboard file (`data.json`) includes who paid each expense. This site is public, so that file is not published. `scripts/make_feed.py` (Python 3 standard library only) converts one month and merges it into `data/feed.json`.

Kept: loads, fuel, other operating expenses, cancelled loads, and notes that are not personal. Dropped: `paid_by`, reimbursement flags, per-person balances, photos, capex payables, and notes that name people or private admin (bank, notary, ownership).

Other months already in the feed stay, which is what makes month-over-month work after the next export.

```bash
python3 scripts/make_feed.py /path/to/data.json
git add data/feed.json
git commit -m "Update hotshot feed"
git push origin main
```

GitHub Pages publishes `main` with the existing pages deployment. `.nojekyll` keeps `data/feed.json` as a real file. The service worker asks the network for the feed first and falls back to the cached copy offline. After the push, open Reports and pull to refresh.

## Add to an iPhone

1. Open https://cd866.github.io/hotshotrate/ in Safari.
2. Tap the Share button.
3. Tap **Add to Home Screen**, then **Add**.
4. Open **Black Ram** from the home screen.

The icon is the ram mark. The app runs full screen (no Safari toolbar). After that first online visit, the shell and the last feed work offline. Load-check settings never leave the phone.

## Local preview

```bash
python3 -m http.server 4173
```

Open http://127.0.0.1:4173

## Brand

Background `#0E0E10`, cards `#2A2A2E`, gold `#D4A62A`, highlight `#F2C94C`, cream text `#F5F1E6`, alert `#8C1C13`. Oswald (self-hosted, SIL Open Font License in `fonts/OFL.txt`) for headings and numbers. System sans for body text. Logos in `brand/`. Home-screen icons in `icons/`.
