# Black Ram Towing

Installable phone app for Sand Lily Pad LLC’s hotshot business, doing business as **Black Ram Towing**, leased onto Totni Enterprise’s MC authority. Rig: 2026 Ram 3500 dually and a 40 ft Big Tex gooseneck.

**Live:** https://cd866.github.io/hotshotrate/

Static HTML, CSS, and JavaScript. No build step. GitHub Pages serves the repository root.

The native iPhone project is in `ios/`. Building it does not change the website.

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

## Native iPhone app (TestFlight)

The home-screen shortcut above still works. This is the separate app you install from TestFlight, and later from the App Store. The name under the icon is Black Ram. The icon is the gold ram on black. The bundle id is `com.blackramtowing.hotshotrate`. That id is a placeholder. Change it in `ios/Config/Signing.xcconfig` before the first upload if you want a different one. After Apple has the first build, the bundle id cannot change.

The app is the same load check, reports, and KPIs. Xcode copies the website into the app when you archive, so you do not install Node or any other build tool. The calculator works with no service. Reports open the copy that shipped inside the app when you are offline, and they download the public feed when you have service.

You need the Apple Developer Program to put the app on a phone that is not plugged into your Mac. It costs $99 per year. Enroll at https://developer.apple.com/programs/ as Sand Lily Pad LLC if you have a D-U-N-S number, or in your own name. Signing is not locked to a team. The team starts blank.

### One-time setup in App Store Connect

1. Sign in at https://appstoreconnect.apple.com and accept the latest agreements.
2. Create an app. Name: Black Ram. Bundle ID: com.blackramtowing.hotshotrate. SKU: hotshotrate.
3. On the privacy questions, say the app does not collect data. Load-check settings stay on the phone. The app only downloads the public reports feed.

### From a Mac

1. Install Xcode from the Mac App Store. In Xcode, open Settings, Accounts, and sign in with the Apple ID on the developer account.
2. Open `ios/BlackRam.xcodeproj`.
3. Click the BlackRam project, then the BlackRam target, then Signing & Capabilities.
4. Turn on Automatically manage signing and choose your team. You can instead put the 10-character Team ID on the `DEVELOPMENT_TEAM` line in `ios/Config/Signing.xcconfig`.
5. At the top of the window, set the destination to Any iOS Device (arm64). The scheme is BlackRam.
6. Choose Product, then Archive.
7. When the Organizer opens, click Distribute App, then App Store Connect, then Upload.
8. Wait until the build finishes processing in TestFlight. Then add Claudio, Ben, and Meshach.
   Internal testers must already be users on the App Store Connect team. They can install as soon as processing finishes.
   External testers only need an email and the TestFlight app. The first build you send outside the team goes through a short Beta App Review.
9. On the iPhone, install TestFlight from the App Store, open the invite, and install Black Ram.

To try it on your own phone without TestFlight, plug the phone in, choose it as the run destination, set the team, and press Run. If the phone says the developer is not trusted, open Settings, General, VPN & Device Management, and trust the certificate.

The version in the project is 1.0.0 and the build number starts at 1. Raise the build number in Xcode before each new upload. TestFlight will not accept the same build number twice.

### From GitHub, if you do not want to archive on a Mac

The iOS workflow already builds the app for the iOS Simulator on every pull request, with signing turned off, so you can see that the project compiles.

To upload from GitHub:

1. In App Store Connect, open Users and Access, then Integrations, then App Store Connect API. Make a key with Admin or App Manager access. Download the AuthKey file once. Write down the Key ID, the Issuer ID, and the 10-character Team ID from your membership page.
2. In this GitHub repo, open Settings, then Secrets and variables, then Actions. Add these secrets:
   - `APPLE_TEAM_ID`
   - `APP_STORE_CONNECT_KEY_ID`
   - `APP_STORE_CONNECT_ISSUER_ID`
   - `APP_STORE_CONNECT_API_KEY` (paste the whole .p8 file, including the BEGIN and END lines)
3. Open Actions, choose iOS, then Run workflow, and check Upload a Release build to TestFlight.
4. When the workflow is green, the build shows up in TestFlight. Install it the same way as above.

That upload uses version 1.0.0 and a build number of 1000 plus the GitHub run number, so it does not collide with build 1 from Xcode. Create the app record in App Store Connect before the first upload, or the upload has nowhere to land.

Defaults match the website: Totni fee 13%, trailer payment $434.84 per month, take line $3.00 per all-miles (deadhead counts). Insurance stays $0 until you type it on the phone. The field keeps the Set this badge until then.

## Local preview

```bash
python3 -m http.server 4173
```

Open http://127.0.0.1:4173

## Brand

Background `#0E0E10`, cards `#2A2A2E`, gold `#D4A62A`, highlight `#F2C94C`, cream text `#F5F1E6`, alert `#8C1C13`. Oswald (self-hosted, SIL Open Font License in `fonts/OFL.txt`) for headings and numbers. System sans for body text. Logos in `brand/`. Home-screen icons in `icons/`.
