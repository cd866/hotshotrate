# Black Ram Towing

Installable phone app for Sand Lily Pad LLC’s hotshot business, doing business as **Black Ram Towing**, leased onto Totni Enterprise’s MC authority. Rig: 2026 Ram 3500 dually and a 40 ft Big Tex gooseneck.

**Live:** https://cd866.github.io/hotshotrate/

Static HTML, CSS, and JavaScript. No build step. GitHub Pages serves the repository root.

## Tabs

1. **Load check.** Enter a rate, loaded miles, deadhead miles, weight, optional length, optional cities, tarp, and optional hours. Net EST is the rate times 0.87, minus $1.64 per loaded mile and $0.30 per deadhead mile. The verdict is TAKE, MAYBE, or PASS against a $500 net EST bar ($300 for a same-day run under 250 total miles).
2. **Searches.** The latest Truckstop and Direct Freight scan from Jacksonville, sorted by net EST, with a chart first. Each load shows board, lane, miles, windows, equipment, weight, length, posted rate, rate per mile, net EST, the math, fit flags, verdict, broker (company, MC, DOT), load number, and a link to the board. The public file has no contact names, phone numbers, or emails. Data is `data/load_searches.json`, refreshed with the box script `/workspace/bigtex/dashboard/update_load_searches.py`.
3. **Stops.** Love's and TA, TA Express, and Petro on an OpenStreetMap map. Filter by brand. Near me sorts the closest stops by miles using the phone's location. Along a route takes a pickup and delivery (typed, copied from Load check, or a saved load on the feed), routes it, and lists stops within 5, 10, or 25 miles of the road in order. Tap a stop for the address, a call button, tire care / truck service when the locator lists it, and Apple Maps and Google Maps. The list is `data/stops.json`, so it still opens when the map tiles are slow.
4. **Reports.** Month numbers from `data/feed.json`: gross, Totni fees, fuel, other expenses, net, $/loaded mile, loads, cancelled loads, and day notes. Each load shows paid, paid short, unpaid, or in transit, and an EST mark when the miles or the amount still owed is an estimate. A chip row lists every month in the feed plus All time. All time adds the months together and lists every load, newest first, with what has been collected and what is still owed. The choice is remembered on the phone. Fresh fetch on open, pull to refresh, last-updated time, and an offline copy.
5. **KPIs.** The same chips, then revenue per loaded mile and per all-miles, deadhead %, loads per week, truck utilization, net margin, fuel per mile, Totni fees, break-even against the trailer payment, insurance, and truck note, plus week-over-week and month-over-month charts. All time compares net with one month of fixed costs for every month in the feed. Short history says “Not enough data.”

## Defaults

Saved on the phone (localStorage):

| Setting | Default |
|---|---|
| Totni fee | 13% |
| Loaded cost | $1.64 / mi (fuel+DEF $1.14 + driver $0.50) |
| Deadhead cost | $0.30 / mi |
| Min net EST | $500 ($300 for a same-day run under 250 total miles) |
| Chain min | $1,000 total, no losing leg |
| Trailer payment | $434.84 / month |
| Insurance | $1,221.62 / month |
| Truck note (other fixed) | $1,573.04 / month |
| Deck warning | at or over 16,000 lb, or over 40 ft |
| MPG | 9, estimate, badged **EST** (shown as a fuel check only) |
| Diesel | $6.04 / gal, estimate, badged **EST** |

Net EST = rate x 0.87 - $1.64 per loaded mile - $0.30 per deadhead mile. TAKE if it clears the bar and fits the deck. MAYBE if it clears the bar but weight or length is tight. PASS if it is under the bar, or will not fit (18,000 lb or more, or longer than 48 ft).

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

`scripts/build_feed.py` is the ops-box copy that rebuilds the whole feed, including pay status, from the private ledger. It is not run in this repo.

GitHub Pages publishes `main` with the existing pages deployment. `.nojekyll` keeps `data/feed.json` as a real file. The service worker asks the network for the feed, the load-search list, and the stop list first and falls back to the cached copy offline. After the push, open Reports or Searches and pull to refresh.

## How load searches get updated

Scan CSVs live on the ops box in `/workspace/hotshot-routes/`. This site is public, so the converter drops contact names, phone numbers, and emails.

```bash
python3 /workspace/bigtex/dashboard/update_load_searches.py
# writes /workspace/hotshot-rate-feed/load_searches.json

python3 /workspace/bigtex/dashboard/update_load_searches.py --deploy
# commits data/load_searches.json to this repo's main branch (GitHub Pages)
```

Optional: `--truckstop PATH` and `--df PATH` override the newest `scan_*_truckstop.csv` and `scan_*_df.csv`.

## Truck stop list

`data/stops.json` is a copy of the public Love's store locator and the TA/Petro location download. Refresh it with the standard library only:

```bash
python3 scripts/refresh_stops.py
```

The file records the source URLs and the date it was fetched. The Stops tab shows that date. Place search from the phone uses OpenStreetMap Nominatim (one request at a time, results saved on the phone) and the public OSRM demo server for the route. Both are for light use. Map tiles are OpenStreetMap and need a connection; the stop list does not, after one visit. Leaflet 1.9.4 is vendored under `vendor/leaflet/` (BSD 2-Clause).

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
