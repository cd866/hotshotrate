#!/usr/bin/env python3
"""Build feed.json from the same ledger the daily/weekly reports use."""
import json, re, sys
sys.path.insert(0, "/workspace/hotshot-rate-feed/remote")
import make_feed as mf

LEDGER = "/workspace/bigtex/dashboard/data.json"
CARD_RE = re.compile(r"\s*(?:,\s*)?\b(?:AmEx|Amex|AMEX|US Debit|Visa|debit)\b[^;,.)]*?\d{4}\b[^;.)]*", re.I)

def scrub(o):
    if isinstance(o, dict):
        return {k: scrub(v) for k, v in o.items()}
    if isinstance(o, list):
        return [scrub(v) for v in o]
    if isinstance(o, str):
        s = CARD_RE.sub("", o)
        s = re.sub(r"\(\s*\)", "", s); s = re.sub(r"\s{2,}", " ", s)
        return s.strip(" ;,")
    return o

oct_src = json.load(open(LEDGER))
nov_src = json.load(open("/workspace/hotshot-rate-feed/nov-source.json"))
octm = mf.convert_month(oct_src)
novm = mf.convert_month(nov_src)

# Pay status per load (from Totni/Flex settlements on file + 10/30 unpaid review)
pay = {
  "PO 2771215": dict(pay_status="paid", net_due=522.00, net_received=522.00, pay_note="Flex Solutions settlement 10/9-10/16"),
  "4710856":    dict(pay_status="paid", net_due=1044.00, net_received=1044.00, pay_note="Flex Solutions settlement 10/9-10/16"),
  "171297":     dict(pay_status="unpaid", net_due=1479.00, net_received=0.0, pay_note="No settlement on file; Totni checking"),
  "158756":     dict(pay_status="paid_short", net_due=870.00, net_received=820.00, pay_note="Paid $820: $50 Totni insurance add-on deducted (logged as insurance expense)"),
  "9935849":    dict(pay_status="unpaid", net_due=870.00, net_received=0.0, pay_note="No settlement on file; Totni checking"),
  "U008069":    dict(pay_status="in_transit", net_due=957.00, net_received=0.0, net_due_est=True, pay_note="Not delivered yet; $957 = $1,100 less 13%, EST until Totni confirms the fee on this load"),
}
for m in (octm, novm):
    for l in m["loads"]:
        l.update(pay.get(l.get("load_no"), {}))
        if l.get("loaded_mi") and l.get("gross"):
            l["rate_per_mi"] = round(l["gross"] / l["loaded_mi"], 2)
# carry amount_estimate flags (convert_month drops them)
for src, m in ((oct_src, octm), (nov_src, novm)):
    est = {(x["date"], x["amount"]) for x in src["expenses"] if x.get("amount_estimate")}
    for x in m["expenses"]:
        if (x["date"], x["amount"]) in est:
            x["est"] = True
octm["as_of"] = "2026-10-31"
novm["as_of"] = "2026-11-03"

feed = mf.build_feed([octm, novm])
feed["schema"] = 1
feed["rig"]["trailer"] = "2027 Big Tex 25GN 40 ft gooseneck"
feed["rig"]["truck"] = "2026 Ram 3500 dually"
feed["fixed_costs"] = {
  "as_of": "2026-11-03",
  "monthly_total": 3229.50,
  "items": [
    {"name": "Truck note (Chase, 84 mo)", "monthly": 1573.04, "source": "loan terms in capital model; Oct payment confirmed paid 10/23"},
    {"name": "Trailer note (Synchrony, 84 mo)", "monthly": 434.84, "source": "trailer financing terms"},
    {"name": "Commercial auto insurance (Progressive via TAP)", "monthly": 1221.62,
     "source": "Policy bound 10/30/2026, term 10/30/2026-10/30/2027. Plan matching the $2,383.81 initial payment: 11 payments, 16.67% down, mail/online billing: $2,383.81 down + 9 x $1,221.62 + 1 x $1,221.61 ($35 installment fee in each).",
     "premium_12mo": 14250.00, "initial_payment": 2383.81, "initial_paid": "2026-10-30",
     "installments": {"count": 10, "amount": 1221.62, "last_amount": 1221.61, "due_dates_known": False},
     "total_cash_12mo": 14600.00, "avg_monthly_incl_down": 1216.67,
     "unconfirmed": "Installment due dates (payment schedule not on file); whether premium drops after own DOT; dashcam (Snapshot Pro) cost"}
  ],
  "per_load_deductions": [
    {"name": "Totni insurance add-on", "amount": 50.00, "seen_on": "158756", "recurring": "UNCONFIRMED (one-time vs per load)"}
  ]
}
LOAD_NOTES = {
  "PO 2771215": "Signed rate con: $600, 73.63 mi; PU 10/12, DEL 10/13",
  "4710856": "Signed rate con: $895.08 linehaul + $304.92 fuel = $1,200, 363 mi; PU 10/13, DEL 10/14",
  "171297": "Signed rate con $1,700. Rate con lists no miles: about 300 mi EST; PU 10/14, DEL 10/15",
  "158756": "Totni rate con: $870 net after 13% = $1,000 gross (derived), 303 mi; PU 10/21, DEL 10/22",
  "9935849": "Rate con: $1,000 flat, 460 mi, 12,000 lb structural steel; PU 10/24, DEL 10/26",
}
for l in octm["loads"]:
    if l.get("load_no") in LOAD_NOTES: l["notes"] = LOAD_NOTES[l["load_no"]]
for x in octm["expenses"]:
    x.pop("notes", None)
    x["vendor"] = re.sub(r"\s*\((?:auth|pump|prepay|diesel pump|tkt|Unit)[^)]*\)", "", x["vendor"]).strip()
    if x["vendor"].startswith("Love's Mile 65"): x["vendor"] = "Love's El Dorado KS"
    if x["vendor"].startswith("RecNation"): x["vendor"] = "RecNation Texas City TX (overnight truck/trailer parking)"
    if x["vendor"].startswith("Diesel prepay"): x["vendor"] = "Diesel prepay (station not shown on receipt)"
    if x["vendor"].startswith("Ram dealer oil change"): x["vendor"] = "Ram dealer oil change (pre-invoice EST)"
    if x["vendor"].startswith("Totni insurance"): x["vendor"] = "Totni insurance add-on (deducted from load 158756 pay)"
octm["cancelled"] = [{"date":"2026-10-15","status":"Cancelled (broker double-booked)","gross":0.0,"load_no":"2776333",
  "tonu":"$150 TONU paid, net $143.25 after 4.5% fee (not counted in gross)","deadhead_fuel":260.0,
  "notes":"Load gone on arrival; $260 fuel was deadhead for this cancelled load"}]
octm["day_notes"] = [
  {"date":"2026-10-16","text":"No loads; signed rate cons for loads 1-3 on file"},
  {"date":"2026-10-20","text":"No loads; $1,600 Texas load passed (needed a trailer with no ramps)"},
  {"date":"2026-10-21","text":"No loads; working on commercial insurance for truck registration"},
  {"date":"2026-10-22","text":"Load 158756 delivered Springfield MO"},
  {"date":"2026-10-23","text":"No loads; October truck note paid"},
  {"date":"2026-10-24","text":"Load 9935849 picked up Kansas City MO"},
  {"date":"2026-10-26","text":"Load 9935849 delivered Trenton TX; oil change at 4,074 mi (about $265 EST)"},
  {"date":"2026-10-28","text":"No loads; truck empty since 10/26"},
  {"date":"2026-10-30","text":"Commercial auto policy bound 10/30/2026-10/30/2027; $2,383.81 initial payment (not counted as an operating expense)"},
]
mf.assert_public(feed)
json.dump(feed, open("/workspace/hotshot-rate-feed/feed.json", "w"), ensure_ascii=False, indent=2)
open("/workspace/hotshot-rate-feed/feed.json", "a").write("\n")

for m in feed["months"]:
    g = sum(l["gross"] for l in m["loads"]); fee = sum(round(l["gross"]*m["fee_pct"]/100, 2) for l in m["loads"])
    fuel = sum(x["amount"] for x in m["expenses"] if x["category"] == "fuel")
    oth = sum(x["amount"] for x in m["expenses"] if x["category"] != "fuel")
    print(m["month"], "loads", len(m["loads"]), "gross", g, "fee", fee, "fuel", round(fuel,2), "other", round(oth,2), "net", round(g-fee-fuel-oth,2))
