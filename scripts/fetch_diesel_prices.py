#!/usr/bin/env python3
"""Fetch EIA weekly on-highway diesel prices and stamp fuel fields
onto load_searches.json. Love's, Pilot, and TA do not offer a public
unauthenticated price feed (Love's API is OAuth-only; Pilot does not
post pump prices on the web), so the pipeline uses the EIA Gasoline
and Diesel Fuel Update by PADD, mapped to each load's origin state.
$1.14/loaded mi + $0.30/empty mi remains the fallback.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    from zoneinfo import ZoneInfo
    CT = ZoneInfo("America/Chicago")
except Exception:
    CT = None

# Loaded MPG from the company ledger, 10/12-11/16/2026 work period:
# 7 fills with receipt gallons = 130.95 gal at a $5.96/gal average.
# The other diesel purchases in that window ($2,710) imply 454.6 gal
# at that same average, for 585.5 gal in all. Delivered loaded miles
# were 2,966 (plus 96 recorded deadhead). Raw gallons/loaded-miles is
# ~5.2 mpg because most empty miles between loads were never written
# down. Two tighter stretches with complete fuel and loaded miles
# (10/13-14 Pooler-Chattanooga-Memphis, and 11/3-6 Houston-Florida)
# come out around 7-9 mpg once a modest empty allowance is included.
# Use 8.0 mpg loaded as the ledger-backed figure.
LOADED_MPG = 8.0
# DEF spend in the same window was $159.75. Implied miles at 8.0 mpg
# x 585.5 gal = 4,684 mi, so DEF is $0.034/mi.
DEF_PER_MI = 0.034
FALLBACK_LOADED = 1.14
FALLBACK_DEADHEAD = 0.30
FEE = 0.13

EIA_XLSX = (
    "https://www.eia.gov/petroleum/gasdiesel/includes/"
    "dieselfuel_recent_prices_and_SEs.xlsx"
)
EIA_PAGE = "https://www.eia.gov/petroleum/gasdiesel/"

PADD_NAME = {
    "US": "United States",
    "PADD1": "East Coast (PADD 1)",
    "PADD1A": "New England (PADD 1A)",
    "PADD1B": "Central Atlantic (PADD 1B)",
    "PADD1C": "Lower Atlantic (PADD 1C)",
    "PADD2": "Midwest (PADD 2)",
    "PADD3": "Gulf Coast (PADD 3)",
    "PADD4": "Rocky Mountain (PADD 4)",
    "PADD5": "West Coast (PADD 5)",
    "CA": "California",
    "PADD5XCA": "West Coast less California",
}
NAME_TO_CODE = {v: k for k, v in PADD_NAME.items()}

STATE_TO_PADD = {
    "ME": "PADD1A", "NH": "PADD1A", "VT": "PADD1A", "MA": "PADD1A",
    "RI": "PADD1A", "CT": "PADD1A",
    "NY": "PADD1B", "NJ": "PADD1B", "PA": "PADD1B", "DE": "PADD1B",
    "MD": "PADD1B", "DC": "PADD1B",
    "WV": "PADD1C", "VA": "PADD1C", "NC": "PADD1C", "SC": "PADD1C",
    "GA": "PADD1C", "FL": "PADD1C",
    "ND": "PADD2", "SD": "PADD2", "NE": "PADD2", "KS": "PADD2", "OK": "PADD2",
    "MN": "PADD2", "IA": "PADD2", "MO": "PADD2", "WI": "PADD2", "IL": "PADD2",
    "IN": "PADD2", "MI": "PADD2", "OH": "PADD2", "KY": "PADD2", "TN": "PADD2",
    "NM": "PADD3", "TX": "PADD3", "AR": "PADD3", "LA": "PADD3", "MS": "PADD3",
    "AL": "PADD3",
    "MT": "PADD4", "ID": "PADD4", "WY": "PADD4", "UT": "PADD4", "CO": "PADD4",
    "WA": "PADD5XCA", "OR": "PADD5XCA", "NV": "PADD5XCA", "AZ": "PADD5XCA",
    "AK": "PADD5XCA", "HI": "PADD5XCA",
    "CA": "CA",
}

STATE_NAMES = {
    "ALABAMA": "AL", "ALASKA": "AK", "ARIZONA": "AZ", "ARKANSAS": "AR",
    "CALIFORNIA": "CA", "COLORADO": "CO", "CONNECTICUT": "CT",
    "DELAWARE": "DE", "FLORIDA": "FL", "GEORGIA": "GA", "HAWAII": "HI",
    "IDAHO": "ID", "ILLINOIS": "IL", "INDIANA": "IN", "IOWA": "IA",
    "KANSAS": "KS", "KENTUCKY": "KY", "LOUISIANA": "LA", "MAINE": "ME",
    "MARYLAND": "MD", "MASSACHUSETTS": "MA", "MICHIGAN": "MI",
    "MINNESOTA": "MN", "MISSISSIPPI": "MS", "MISSOURI": "MO",
    "MONTANA": "MT", "NEBRASKA": "NE", "NEVADA": "NV",
    "NEW HAMPSHIRE": "NH", "NEW JERSEY": "NJ", "NEW MEXICO": "NM",
    "NEW YORK": "NY", "NORTH CAROLINA": "NC", "NORTH DAKOTA": "ND",
    "OHIO": "OH", "OKLAHOMA": "OK", "OREGON": "OR", "PENNSYLVANIA": "PA",
    "RHODE ISLAND": "RI", "SOUTH CAROLINA": "SC", "SOUTH DAKOTA": "SD",
    "TENNESSEE": "TN", "TEXAS": "TX", "UTAH": "UT", "VERMONT": "VT",
    "VIRGINIA": "VA", "WASHINGTON": "WA", "WEST VIRGINIA": "WV",
    "WISCONSIN": "WI", "WYOMING": "WY", "DISTRICT OF COLUMBIA": "DC",
}


def now_iso():
    if CT:
        return datetime.now(CT).strftime("%Y-%m-%d %H:%M CT")
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def money(n, places=2):
    return f"${n:,.{places}f}"


def state_from_text(text):
    if not text:
        return None
    s = str(text)
    m = re.search(r",\s*([A-Z]{2})(?:\s|,|$)", s)
    if m:
        return m.group(1)
    up = re.sub(r"[^A-Za-z ]", " ", s).upper()
    for name, ab in STATE_NAMES.items():
        if re.search(r"\b" + name + r"\b", up):
            return ab
    return None


def fetch_eia(path: Path):
    import urllib.request
    req = urllib.request.Request(
        EIA_XLSX,
        headers={"User-Agent": "BlackRamLogistics-fuel/1.0 (hotshot cost estimates; +https://github.com/cd866/hotshotrate)"},
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        path.write_bytes(res.read())
    return path


def parse_eia(path: Path):
    import openpyxl
    from collections import defaultdict
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    by_date = defaultdict(dict)
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        if i == 1 or not row or not row[0] or row[2] is None:
            continue
        dt, area, price = row[0], str(row[1]), float(row[2])
        day = dt.date().isoformat() if hasattr(dt, "date") else str(dt)[:10]
        code = NAME_TO_CODE.get(area)
        if not code:
            continue
        by_date[day][code] = {"name": area, "usd_gal": round(price, 3)}
    if not by_date:
        raise SystemExit("EIA workbook had no diesel rows")
    week = sorted(by_date)[-1]
    return week, by_date[week]


def fuel_per_mi(diesel):
    return round(diesel / LOADED_MPG + DEF_PER_MI, 3)


def source_label(week, region_code, regions):
    info = regions.get(region_code) or regions.get("US")
    name = info["name"] if info else "United States"
    return f"EIA {name}, week of {week}"


def fuel_for_state(st, week, regions):
    code = STATE_TO_PADD.get(st or "", "US")
    if code not in regions:
        code = "US"
    info = regions[code]
    diesel = info["usd_gal"]
    fpm = fuel_per_mi(diesel)
    return {
        "diesel_usd_gal": diesel,
        "diesel_source": source_label(week, code, regions),
        "diesel_region": code,
        "diesel_stop": None,
        "mpg": LOADED_MPG,
        "def_per_mi": DEF_PER_MI,
        "fuel_per_mi": fpm,
        "fallback": False,
    }


def compute_net(rate, trip, dh, fuel):
    if rate is None or trip is None or trip <= 0:
        return None
    after = round(float(rate) * (1 - FEE), 2)
    if fuel.get("fallback"):
        cost = round(FALLBACK_LOADED * float(trip) + FALLBACK_DEADHEAD * float(dh or 0), 2)
        fpm_txt = f"Fuel and DEF ${FALLBACK_LOADED:.2f} x {trip:,.0f} mi = {money(round(FALLBACK_LOADED * float(trip), 2))}. Empty miles ${FALLBACK_DEADHEAD:.2f} x {float(dh or 0):,.0f} mi = {money(round(FALLBACK_DEADHEAD * float(dh or 0), 2))}."
    else:
        total = float(trip) + float(dh or 0)
        cost = round(fuel["fuel_per_mi"] * total, 2)
        fpm_txt = (
            f"Diesel {money(fuel['diesel_usd_gal'], 3)}/gal ({fuel['diesel_source']}) "
            f"at {fuel['mpg']:.1f} mpg plus {money(fuel['def_per_mi'], 3)}/mi DEF "
            f"= {money(fuel['fuel_per_mi'], 3)}/mi. "
            f"Fuel {money(fuel['fuel_per_mi'], 3)} x {total:,.0f} mi (loaded+empty) = {money(cost)}."
        )
    net = round(after - cost, 2)
    fee_amt = round(float(rate) - after, 2)
    math = (
        f"Rate {money(float(rate))} x 0.87 = {money(after)} after the 13% Totni fee ({money(fee_amt)}). "
        f"{fpm_txt} Net EST {money(net)}."
    )
    return net, after, math


def apply_to_searches(data, week, regions):
    fuel_index = {
        "mpg": LOADED_MPG,
        "def_per_mi": DEF_PER_MI,
        "fallback_loaded_per_mi": FALLBACK_LOADED,
        "fallback_deadhead_per_mi": FALLBACK_DEADHEAD,
        "source": "eia_padd",
        "week": week,
    }
    data["fuel"] = fuel_index
    rules = data.setdefault("rules", {})
    rules["loaded_cost_per_mi"] = FALLBACK_LOADED
    rules["deadhead_cost_per_mi"] = FALLBACK_DEADHEAD
    rules["mpg"] = LOADED_MPG
    rules["def_per_mi"] = DEF_PER_MI
    rules["formula"] = (
        f"net EST = rate x 0.87 - (diesel/gal / {LOADED_MPG:.1f} mpg + ${DEF_PER_MI:.3f}/mi DEF) "
        f"x (loaded + empty miles). Diesel is the EIA on-highway price for the origin state's "
        f"PADD, week of {week}. Fallback is $1.14/loaded mi + $0.30/empty mi if no price is on file."
    )

    def stamp(row, state_hint=None):
        st = state_from_text(row.get("origin") or "") or state_hint
        fuel = fuel_for_state(st, week, regions)
        row["fuel"] = fuel
        trip = row.get("trip_mi") or row.get("loaded_mi") or 0
        dh = row.get("origin_dh_mi") or row.get("empty_mi_est") or row.get("deadhead_mi") or 0
        rate = row.get("posted_rate")
        out = compute_net(rate, trip, dh, fuel)
        if not out:
            return
        net, after, math = out
        row["net_est"] = net
        row["math"] = math
        hours = row.get("hours")
        if hours:
            row["per_hour"] = round(net / float(hours), 2)
        total = float(trip) + float(dh or 0)
        if total > 0:
            row["net_per_mile"] = round(net / total, 2)
        days = row.get("days")
        if days:
            row["net_per_day"] = round(net / float(days), 2)

    for row in data.get("loads") or []:
        stamp(row)
    for combo in data.get("combos") or []:
        # combo origin is first leg
        first = (combo.get("loads") or [None])[0] or {}
        st = state_from_text(first.get("origin") or data.get("origin") or "")
        fuel = fuel_for_state(st, week, regions)
        combo["fuel"] = fuel
        trip = combo.get("loaded_mi") or 0
        dh = combo.get("deadhead_mi") or 0
        after = combo.get("after_fee")
        if after is None and combo.get("posted_rate") is not None:
            after = round(float(combo["posted_rate"]) * (1 - FEE), 2)
        if after is not None and trip:
            total = float(trip) + float(dh or 0)
            cost = round(fuel["fuel_per_mi"] * total, 2)
            net = round(float(after) - cost, 2)
            combo["net_est"] = net
            combo["math"] = (
                f"Rates after the 13% Totni fee {money(float(after))}. "
                f"Diesel {money(fuel['diesel_usd_gal'], 3)}/gal ({fuel['diesel_source']}) "
                f"at {fuel['mpg']:.1f} mpg plus {money(fuel['def_per_mi'], 3)}/mi DEF "
                f"= {money(fuel['fuel_per_mi'], 3)}/mi. "
                f"Fuel {money(fuel['fuel_per_mi'], 3)} x {total:,.0f} mi (loaded+empty) = {money(cost)}. "
                f"Net EST {money(net)}."
            )
            if combo.get("hours"):
                combo["per_hour"] = round(net / float(combo["hours"]), 2)
            if total > 0:
                combo["net_per_mile"] = round(net / total, 2)
            if combo.get("days"):
                combo["net_per_day"] = round(net / float(combo["days"]), 2)
        for leg in combo.get("loads") or []:
            stamp(leg, st)
    return data


def build_prices_doc(week, regions):
    return {
        "schema": 1,
        "fetched_at": now_iso(),
        "mpg": LOADED_MPG,
        "mpg_note": (
            "8.0 loaded mpg from the company fuel ledger, 10/12-11/16/2026: "
            "585.5 gal (130.95 gal on receipts plus the rest of the diesel spend "
            "at the $5.96/gal receipt average) against 2,966 delivered loaded miles. "
            "The raw gal/loaded-mi ratio is lower because empty miles between loads "
            "were mostly not recorded; tighter stretches with complete fuel and "
            "loaded miles land around 7-9 mpg. DEF is $0.034/mi from $159.75 of DEF "
            "over the implied 4,684 miles at 8.0 mpg."
        ),
        "def_per_mi": DEF_PER_MI,
        "fallback_loaded_per_mi": FALLBACK_LOADED,
        "fallback_deadhead_per_mi": FALLBACK_DEADHEAD,
        "source": "eia_padd",
        "source_note": (
            "EIA weekly retail on-highway diesel (includes taxes), Gasoline and "
            "Diesel Fuel Update. Love's store prices need an OAuth API we do not "
            "have; Pilot does not post pump prices on the public site; TA/Petro "
            "and GasBuddy had no usable unauthenticated feed from this host. "
            "Each load uses the PADD for its origin state. When Truck is at is "
            "set, the app uses the PADD for that spot."
        ),
        "eia": {
            "week": week,
            "url": EIA_PAGE,
            "workbook": EIA_XLSX,
            "regions": regions,
        },
        "state_to_region": STATE_TO_PADD,
        "stops": [],
    }


def main():
    repo = Path(__file__).resolve().parents[1]
    data_dir = repo / "data"
    tmp = Path("/tmp/fuel/diesel.xlsx")
    tmp.parent.mkdir(parents=True, exist_ok=True)
    if len(sys.argv) > 1 and sys.argv[1] == "--reuse" and tmp.exists():
        print("reusing", tmp)
    else:
        print("fetching", EIA_XLSX)
        fetch_eia(tmp)
    week, regions = parse_eia(tmp)
    print("EIA week", week, "US", regions.get("US"))
    prices = build_prices_doc(week, regions)
    out_prices = data_dir / "diesel_prices.json"
    out_prices.write_text(json.dumps(prices, indent=2) + "\n")
    print("wrote", out_prices)

    searches_path = data_dir / "load_searches.json"
    data = json.loads(searches_path.read_text())
    scanned = data.get("scanned_at")
    as_of = data.get("as_of")
    n = len(data.get("loads") or [])
    apply_to_searches(data, week, regions)
    if data.get("scanned_at") != scanned or data.get("as_of") != as_of:
        raise SystemExit("refused to write: scan timestamps changed")
    if len(data.get("loads") or []) != n:
        raise SystemExit("refused to write: load count changed")
    searches_path.write_text(json.dumps(data, indent=2) + "\n")
    print("updated", searches_path, "loads", n)
    # example card
    for row in data["loads"]:
        if str(row.get("origin", "")).startswith("Douglas") and "Edinburg" in str(row.get("destination", "")):
            print("EXAMPLE", row["origin"], "to", row["destination"],
                  "rate", row.get("posted_rate"), "net", row.get("net_est"),
                  "fuel", row.get("fuel"))
            print("MATH", row.get("math"))
            break


if __name__ == "__main__":
    main()
