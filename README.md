# Black Ram Towing

Installable phone app for Sand Lily Pad LLC’s hotshot business, doing business as **Black Ram Towing**, leased onto Totni Enterprise’s MC authority. Rig: 2026 Ram 3500 dually and a 40 ft Big Tex gooseneck.

**Live:** https://cd866.github.io/hotshotrate/

Static HTML, CSS, and JavaScript. No build step. GitHub Pages serves the repository root.

## Tabs

1. **Load check.** Enter a rate, loaded miles, deadhead miles, weight, optional cities, tarp, and optional hours. The verdict is TAKE IT, NEGOTIATE, or PASS, with all-miles $/mi, loaded $/mi, the Totni fee, estimated fuel, net kept, and net per hour.
2. **Stops.** Love's and TA, TA Express, and Petro on an OpenStreetMap map. Filter by brand. Near me sorts the closest stops by miles using the phone's location. Along a route takes a pickup and delivery (typed, copied from Load check, or a saved load on the feed), routes it, and lists stops within 5, 10, or 25 miles of the road in order. Tap a stop for the address, a call button, tire care / truck service when the locator lists it, and Apple Maps and Google Maps. The list is `data/stops.json`, so it still opens when the map tiles are slow.
3. **Reports.** Month numbers from `data/feed.json`: gross, Totni fees, fuel, other expenses, net, $/loaded mile, loads, cancelled loads, and day notes. Each load shows paid, paid short, unpaid, or in transit, and an EST mark when the miles or the amount still owed is an estimate. Switch months when more than one is in the feed. Fresh fetch on open, pull to refresh, last-updated time, and an offline copy.
4. **KPIs.** The same month switcher, then revenue per loaded mile and per all-miles, deadhead %, loads per week, truck utilization, net margin, fuel per mile, Totni fees, break-even against the trailer payment, insurance, and truck note, plus week-over-week and month-over-month charts. Short history says “Not enough data.”

## Defaults

Saved on the phone (localStorage):

| Setting | Default |
|---|---|
| Totni fee | 13% |
| Pass / negotiate floor | $2.82 per all-miles (deadhead counts) |
| Take line | $3.00 per all-miles |
| Trailer payment | $434.84 / month |
| Insurance | $1,221.62 / month |
| Truck note (other fixed) | $1,573.04 / month |
| Deck warning | over 15,000 lb |
| MPG | 9, estimate, badged **EST** |
| Diesel | $6.04 / gal, estimate, badged **EST** |

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

`scripts/build_feed.py` is the ops-box copy that rebuilds the whole feed, including pay status, from the private ledger. It is not run in this repo.

GitHub Pages publishes `main` with the existing pages deployment. `.nojekyll` keeps `data/feed.json` as a real file. The service worker asks the network for the feed and the stop list first and falls back to the cached copy offline. After the push, open Reports and pull to refresh.

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
