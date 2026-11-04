#!/usr/bin/env python3
"""Refresh data/stops.json from the public Love's and TA/Petro locators.

Nothing in the output is typed in by hand. Each run downloads:

  * Love's store locator JSON, the same feed the public store finder uses:
    https://www.loves.com/api/fetch_stores
    (linked from https://www.loves.com/en/location-and-fuel-price-search)
  * TravelCenters of America's "Download Location Data" workbook:
    https://www.ta-petro.com/api/locationsdata/download/
    (the button on https://www.ta-petro.com/location/)

One request each, with an identifying User-Agent. Python 3 standard library only.

    python3 scripts/refresh_stops.py
    python3 scripts/refresh_stops.py -o data/stops.json

The script keeps Travel Stops, Country Stores, and Love's truck-service shops,
plus TA, TA Express, and Petro. Car stops, Goasis, and Thorntons are skipped.
It refuses to replace the file if either chain comes back short, so a bad
download cannot wipe the map.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT = ROOT / "data" / "stops.json"

USER_AGENT = (
    "BlackRamTowing/1.0 (hotshot stop refresh; +https://github.com/cd866/hotshotrate)"
)
LOVES_URL = "https://www.loves.com/api/fetch_stores"
LOVES_PAGE = "https://www.loves.com/en/location-and-fuel-price-search"
TA_URL = "https://www.ta-petro.com/api/locationsdata/download/"
TA_PAGE = "https://www.ta-petro.com/location/"

# Census Bureau one-line geocoder for 6003 Murphy St, Houston, TX 77033,
# retrieved 2026-11-04. Used only to prove the two named Houston stops
# fall near that address. It is not a truck-stop coordinate.
MURPHY = (29.683751738546, -95.328112607314)

LOVES_KINDS = {"Travel Stop", "Country Store", "Truck Service", "Service Center"}
TA_BRANDS = {
    "TA": "ta",
    "TA Express": "ta-express",
    "Petro": "petro",
}
TA_TIRE = {"Tire Services"}
TA_SERVICE = {
    "Brake Svc",
    "Dot Inspections",
    "Electric Svc",
    "Engine Diagnostics",
    "Expert Truck Alignments",
    "HVAC Svc",
    "NG Certified Truck Service",
    "On-SITE Techs - Select Services",
    "Oil Changes",
    "Other Lube Services",
    "Preventative Maintenance",
    "Refrigerated Trailer Maintenance",
    "Roadside Breakdown Solutions",
    "Standard Services",
    "Tire Services",
}

STATES = {
    "Alabama": "AL",
    "Alaska": "AK",
    "Arizona": "AZ",
    "Arkansas": "AR",
    "California": "CA",
    "Colorado": "CO",
    "Connecticut": "CT",
    "Delaware": "DE",
    "District of Columbia": "DC",
    "Florida": "FL",
    "Georgia": "GA",
    "Hawaii": "HI",
    "Idaho": "ID",
    "Illinois": "IL",
    "Indiana": "IN",
    "Iowa": "IA",
    "Kansas": "KS",
    "Kentucky": "KY",
    "Louisiana": "LA",
    "Maine": "ME",
    "Maryland": "MD",
    "Massachusetts": "MA",
    "Michigan": "MI",
    "Minnesota": "MN",
    "Mississippi": "MS",
    "Missouri": "MO",
    "Montana": "MT",
    "Nebraska": "NE",
    "Nevada": "NV",
    "New Hampshire": "NH",
    "New Jersey": "NJ",
    "New Mexico": "NM",
    "New York": "NY",
    "North Carolina": "NC",
    "North Dakota": "ND",
    "Ohio": "OH",
    "Oklahoma": "OK",
    "Oregon": "OR",
    "Pennsylvania": "PA",
    "Rhode Island": "RI",
    "South Carolina": "SC",
    "South Dakota": "SD",
    "Tennessee": "TN",
    "Texas": "TX",
    "Utah": "UT",
    "Vermont": "VT",
    "Virginia": "VA",
    "Washington": "WA",
    "West Virginia": "WV",
    "Wisconsin": "WI",
    "Wyoming": "WY",
}

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REGION = ["TX", "LA", "MS", "AL", "GA", "TN", "NC", "SC"]


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=90) as res:
        if res.status != 200:
            raise SystemExit(f"{url} returned {res.status}")
        return res.read()


def clean(value) -> str:
    if value is None:
        return ""
    return " ".join(str(value).replace("\xa0", " ").replace("\u200b", "").split())


def state_code(value: str) -> str:
    text = clean(value)
    if len(text) == 2 and text.isalpha():
        return text.upper()
    return STATES.get(text, "")


def as_float(value):
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def as_int(value):
    number = as_float(value)
    if number is None:
        return None
    return int(number)


def in_north_america(lat: float, lng: float) -> bool:
    return 17.0 <= lat <= 72.5 and -170.0 <= lng <= -60.0


def store_number(value: str) -> str:
    text = clean(value)
    if text.isdigit():
        return str(int(text))
    return text


def phone_display(value: str) -> str:
    text = clean(value)
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10 and "(" not in text:
        return f"({digits[0:3]}) {digits[3:6]}-{digits[6:10]}"
    return text


def yes(value) -> bool:
    return clean(value).lower() in {"y", "yes", "true", "1"}


def loves_flag(store: dict, names: set[str]) -> bool:
    wanted = {name.lower() for name in names}
    fields = store.get("mappedCustomFields") or {}
    for group in ("amenities", "additionalAmenities"):
        for amenity in fields.get(group) or []:
            if clean(amenity.get("fieldValue")).lower() != "true":
                continue
            label = clean(amenity.get("fieldName")).lower()
            sma = clean(amenity.get("smaFieldName")).lower()
            if label in wanted or sma in wanted:
                return True
    return False


def loves_stops(payload: dict) -> list[dict]:
    stops = []
    skipped = Counter()
    for store in payload.get("stores") or []:
        kind = clean(store.get("facilitySubtypeName")) or "Travel Stop"
        if kind not in LOVES_KINDS:
            skipped[kind or "unknown"] += 1
            continue
        lat = as_float(store.get("latitude"))
        lng = as_float(store.get("longitude"))
        if lat is None or lng is None or not in_north_america(lat, lng):
            skipped["bad coordinate"] += 1
            continue
        number = store_number(store.get("number"))
        if not number:
            skipped["no number"] += 1
            continue
        state = state_code(store.get("state") or "")
        if not state:
            skipped["no state"] += 1
            continue
        tire = loves_flag(store, {"Tire Services", "TirePass In-Service Center"})
        service = loves_flag(
            store,
            {"Light Mechanical", "Commercial Truck Oil Change", "Speedco On-Site"},
        ) or kind in {"Truck Service", "Service Center"} or bool(store.get("isSpeedco"))
        row = {
            "id": f"loves-{number}",
            "brand": "loves",
            "number": number,
            "name": clean(store.get("preferredName")) or clean(store.get("city")),
            "address": clean(store.get("address1")),
            "city": clean(store.get("city")),
            "state": state,
            "zip": clean(store.get("zip")),
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "phone": phone_display(store.get("phoneNumber") or ""),
            "tireCare": tire,
            "truckService": service,
            "url": f"https://www.loves.com/locations/{number}",
        }
        highway = clean(store.get("highway"))
        exit_no = clean(store.get("exitNumber"))
        if highway:
            row["highway"] = highway
        if exit_no:
            row["exit"] = exit_no
        if kind != "Travel Stop":
            row["kind"] = "Truck Care" if kind == "Truck Service" else kind
        stops.append(row)
    print(f"Love's kept {len(stops)}; skipped {dict(skipped)}")
    return stops


def col_index(cell_ref: str) -> int:
    col = ""
    for ch in cell_ref:
        if ch.isalpha():
            col += ch
        else:
            break
    number = 0
    for ch in col:
        number = number * 26 + (ord(ch.upper()) - 64)
    return number


def xlsx_rows(blob: bytes) -> list[dict]:
    with zipfile.ZipFile(BytesIO(blob)) as book:
        shared = []
        if "xl/sharedStrings.xml" in book.namelist():
            root = ET.fromstring(book.read("xl/sharedStrings.xml"))
            for node in root.findall("m:si", NS):
                texts = [
                    (text.text or "")
                    for text in node.iter(
                        "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"
                    )
                ]
                shared.append("".join(texts))
        sheet_name = "xl/worksheets/sheet1.xml"
        root = ET.fromstring(book.read(sheet_name))

        def cell_value(cell) -> str:
            kind = cell.get("t")
            if kind == "inlineStr":
                texts = [
                    (text.text or "")
                    for text in cell.iter(
                        "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"
                    )
                ]
                return "".join(texts)
            value_node = cell.find("m:v", NS)
            raw = "" if value_node is None or value_node.text is None else value_node.text
            if kind == "s" and raw != "":
                return shared[int(raw)]
            return raw

        rows = []
        for row in root.findall("m:sheetData/m:row", NS):
            values = {}
            for cell in row.findall("m:c", NS):
                ref = cell.get("r") or ""
                values[col_index(ref)] = cell_value(cell)
            rows.append(values)
    if not rows:
        raise SystemExit("TA workbook has no rows")
    header = {index: clean(text) for index, text in rows[0].items()}
    records = []
    for values in rows[1:]:
        record = {}
        for index, text in values.items():
            name = header.get(index)
            if name:
                record[name] = text
        if record:
            records.append(record)
    return records


def ta_stops(records: list[dict]) -> list[dict]:
    stops = []
    skipped = Counter()
    for record in records:
        brand_name = clean(record.get("Brand"))
        brand = TA_BRANDS.get(brand_name)
        if not brand:
            skipped[brand_name or "blank brand"] += 1
            continue
        lat = as_float(record.get("Latitude"))
        lng = as_float(record.get("Longitude"))
        if lat is None or lng is None or not in_north_america(lat, lng):
            skipped["bad coordinate"] += 1
            continue
        number = store_number(record.get("Site ID") or "")
        if not number:
            skipped["no number"] += 1
            continue
        state = state_code(record.get("State") or "")
        if not state:
            skipped["no state"] += 1
            continue
        bays = as_int(record.get("Service Bays")) or 0
        tire = any(yes(record.get(name)) for name in TA_TIRE)
        service = bays > 0 or any(yes(record.get(name)) for name in TA_SERVICE)
        city = clean(record.get("City"))
        location = clean(record.get("Location")) or city
        row = {
            "id": f"{brand}-{number}",
            "brand": brand,
            "number": number,
            "name": location,
            "address": clean(record.get("Address")),
            "city": city,
            "state": state,
            "zip": clean(record.get("Zipcode")),
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "phone": phone_display(record.get("Phone") or ""),
            "tireCare": tire,
            "truckService": service,
        }
        directions = clean(record.get("Directions"))
        if directions:
            row["highway"] = directions
        parking = as_int(record.get("Truck Parking Spaces"))
        if parking and parking > 0:
            row["parking"] = parking
        stops.append(row)
    print(f"TA/Petro kept {len(stops)}; skipped {dict(skipped)}")
    return stops


def haversine(a_lat, a_lng, b_lat, b_lng) -> float:
    radius = 3958.7613
    lat1 = math.radians(a_lat)
    lat2 = math.radians(b_lat)
    dlat = math.radians(b_lat - a_lat)
    dlng = math.radians(b_lng - a_lng)
    half = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(half)))


def sanity(stops: list[dict]) -> None:
    ranked = sorted(stops, key=lambda stop: haversine(MURPHY[0], MURPHY[1], stop["lat"], stop["lng"]))
    print("Nearest 12 to 6003 Murphy St, Houston TX 77033:")
    wanted = {"loves-315": None, "ta-express-282": None}
    for index, stop in enumerate(ranked[:12], start=1):
        miles = haversine(MURPHY[0], MURPHY[1], stop["lat"], stop["lng"])
        print(
            f"  {index:2}. {miles:5.1f} mi  {stop['id']:18} {stop['address']}, {stop['city']} {stop['state']} {stop['zip']}"
        )
    for index, stop in enumerate(ranked, start=1):
        if stop["id"] in wanted:
            wanted[stop["id"]] = index
            miles = haversine(MURPHY[0], MURPHY[1], stop["lat"], stop["lng"])
            print(f"sanity {stop['id']} rank {index} at {miles:.1f} mi — {stop['address']}")
    missing = [key for key, rank in wanted.items() if rank is None or rank > 40]
    if missing:
        raise SystemExit("Houston sanity check failed: " + ", ".join(missing))
    loves = next(stop for stop in stops if stop["id"] == "loves-315")
    ta = next(stop for stop in stops if stop["id"] == "ta-express-282")
    if "McCarty" not in loves["address"] or loves["state"] != "TX":
        raise SystemExit("Love's #315 address does not match the locator")
    if "12602" not in ta["address"] or ta["state"] != "TX" or not ta["zip"].startswith("77047"):
        raise SystemExit("TA Express #282 address does not match the locator")
    if not loves["tireCare"] or not loves["truckService"]:
        raise SystemExit("Love's #315 should list tire care and truck service")
    region_counts = Counter((stop["state"], stop["brand"]) for stop in stops if stop["state"] in REGION)
    for state in REGION:
        loves_n = region_counts[(state, "loves")]
        ta_n = sum(region_counts[(state, brand)] for brand in ("ta", "ta-express", "petro"))
        print(f"  {state}: Love's {loves_n}, TA/Petro {ta_n}")
        if loves_n < 1 or ta_n < 1:
            raise SystemExit(f"{state} is missing Love's or TA/Petro stops")


def dedupe(stops: list[dict]) -> list[dict]:
    seen = {}
    for stop in stops:
        seen[stop["id"]] = stop
    rows = list(seen.values())
    rows.sort(key=lambda stop: (stop["state"], stop["city"], stop["brand"], stop["number"].zfill(5)))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh Black Ram truck stop locations")
    parser.add_argument("-o", "--output", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    print("Fetching Love's store locator…")
    loves_blob = fetch(LOVES_URL)
    loves_payload = json.loads(loves_blob.decode("utf-8"))
    print("Fetching TA/Petro location workbook…")
    ta_blob = fetch(TA_URL)
    records = xlsx_rows(ta_blob)

    stops = dedupe(loves_stops(loves_payload) + ta_stops(records))
    loves_n = sum(1 for stop in stops if stop["brand"] == "loves")
    ta_n = len(stops) - loves_n
    if loves_n < 400 or ta_n < 200:
        raise SystemExit(f"Refusing to write a short file (Love's {loves_n}, TA/Petro {ta_n})")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    document = {
        "schema": 1,
        "fetched_at": today,
        "count": len(stops),
        "note": (
            "Every stop is copied from the public locators in sources. "
            "Addresses, coordinates, phones, and tire/service flags are not hand-entered."
        ),
        "sources": [
            {
                "name": "Love's Travel Stops public store locator",
                "url": LOVES_URL,
                "page": LOVES_PAGE,
            },
            {
                "name": "TravelCenters of America location download (TA, TA Express, Petro)",
                "url": TA_URL,
                "page": TA_PAGE,
            },
        ],
        "stops": stops,
    }
    sanity(stops)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(document, indent=2, ensure_ascii=False) + "\n"
    args.output.write_text(text, encoding="utf-8")
    print(f"Wrote {len(stops)} stops to {args.output} ({len(text):,} bytes) dated {today}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
