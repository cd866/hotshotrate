#!/usr/bin/env python3
"""Build the public Hotshot feed from an internal monthly data.json.

The internal export includes who paid each expense and reimbursement
balances. This site is public, so those fields are never written.

Each run converts ONE month (the shape of the attached dashboard file)
and merges it into data/feed.json. Months already in the feed stay put,
which is what makes week-over-week and month-over-month trends work
after the next month is exported.

Usage (from the repo root):

    python3 scripts/make_feed.py /path/to/data.json
    python3 scripts/make_feed.py /path/to/data.json -o data/feed.json

Source shape (only the fields below are read):

    {
      "month": "2026-10",
      "fee_pct": 13,
      "loads": [{
        "date", "delivery_date", "desc", "lane", "weight_lb",
        "loaded_mi", "deadhead_mi", "miles_estimate", "gross",
        "broker", "load_no", "notes"
      }],
      "expenses": [{
        "date", "vendor", "amount", "category", "gallons",
        "capex", "deadhead_for", "notes"
      }],
      "cancelled": [{
        "date", "status", "broker", "load_no", "gross",
        "tonu", "deadhead_fuel", "notes"
      }],
      "day_notes": [{"date", "text"}]
    }

Ignored on purpose: paid_by, reimburse, reimbursed, photo, photo_caption,
and any note that names a person or a private admin matter (bank
application, notary, ownership share, reimbursement). Capex lines are
omitted; they are balance-sheet items, not operating expenses.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

SCHEMA = 1

# Word-boundary names that must not appear on the public site.
NAME_RE = re.compile(
    r"\b(?:Meshach|Claudio|Ben|Riley|Dias|Smokovich|Esther)\b",
    re.IGNORECASE,
)

# Clauses matching this are dropped whole.
SENSITIVE_RE = re.compile(
    r"reimburse|zelle|notari|admission|bluevine|payable|ownership|"
    r"whatsapp|%\s*each|33\s*(?:%|⅓)|visa\b|receipt\s*#",
    re.IGNORECASE,
)

# Final backstop over the serialized feed.
BANNED_RE = re.compile(
    r"meshach|claudio|smokovich|\briley\b|\bdias\b|\bben\b|esther|"
    r"zelle|bluevine|reimburse|paid_by|notari|whatsapp",
    re.IGNORECASE,
)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUT = os.path.join(ROOT, "data", "feed.json")


def clean_text(text):
    """Return operational wording with people and private admin removed."""
    if not text:
        return ""
    text = NAME_RE.sub("", str(text))
    text = re.sub(r"\bDispatcher\b", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\(\s*confirmed\b;?\s*", "(", text, flags=re.IGNORECASE)
    parts = re.split(r"\s*;\s*", text)
    kept = []
    for part in parts:
        if SENSITIVE_RE.search(part):
            continue
        part = re.sub(r"\s+confirmed\b", "", part, flags=re.IGNORECASE)
        part = re.sub(r"\(\s*\)", "", part)
        part = re.sub(r"\(\s*$", "", part)
        part = re.sub(r"^\s*\)\s*", "", part)
        part = re.sub(r"\.\s+\(", " (", part)
        part = re.sub(r"\(\s+", "(", part)
        part = re.sub(r"\s+\)", ")", part)
        part = re.sub(r"\s{2,}", " ", part)
        part = re.sub(r"\s+([,.;:])", r"\1", part)
        part = part.strip(" \t-–—;,")
        if part:
            kept.append(part)
    out = "; ".join(kept)
    out = re.sub(r"\s{2,}", " ", out).strip(" ;")
    if out:
        out = out[0].upper() + out[1:]
    return out


def clean_vendor(vendor):
    vendor = NAME_RE.sub("", str(vendor or ""))
    vendor = re.sub(
        r"\s*\([^)]*(?:receipt|visa|session|auth|card)[^)]*\)",
        "",
        vendor,
        flags=re.IGNORECASE,
    )
    vendor = re.sub(r"\s{2,}", " ", vendor).strip(" -")
    return vendor


def money(value):
    return round(float(value) + 0.0, 2)


def opt_str(row, key):
    value = row.get(key)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def convert_month(source):
    month = str(source.get("month") or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}", month):
        raise SystemExit("data.json needs a month like 2026-10")

    try:
        fee_raw = float(source.get("fee_pct", 13))
    except (TypeError, ValueError):
        raise SystemExit("fee_pct must be a number")
    fee_pct = int(fee_raw) if fee_raw == int(fee_raw) else round(fee_raw, 2)

    loads = []
    for row in source.get("loads") or []:
        item = {
            "date": row.get("date"),
            "desc": clean_text(row.get("desc")) or "Load",
            "lane": clean_text(row.get("lane")) or "",
            "weight_lb": row.get("weight_lb"),
            "loaded_mi": row.get("loaded_mi"),
            "gross": money(row.get("gross") or 0),
        }
        if row.get("delivery_date"):
            item["delivery_date"] = row["delivery_date"]
        if isinstance(row.get("deadhead_mi"), (int, float)):
            item["deadhead_mi"] = row["deadhead_mi"]
        if row.get("miles_estimate"):
            item["miles_estimate"] = True
        broker = opt_str(row, "broker")
        if broker:
            item["broker"] = clean_text(broker)
        load_no = opt_str(row, "load_no")
        if load_no:
            item["load_no"] = load_no
        notes = clean_text(row.get("notes"))
        if notes:
            item["notes"] = notes
        loads.append(item)

    expenses = []
    for row in source.get("expenses") or []:
        if row.get("capex"):
            continue
        item = {
            "date": row.get("date"),
            "vendor": clean_vendor(row.get("vendor")) or "Expense",
            "amount": money(row.get("amount") or 0),
            "category": (row.get("category") or "other").strip() or "other",
        }
        if isinstance(row.get("gallons"), (int, float)):
            item["gallons"] = row["gallons"]
        deadhead_for = opt_str(row, "deadhead_for")
        if deadhead_for:
            item["deadhead_for"] = deadhead_for
        notes = clean_text(row.get("notes"))
        if notes:
            item["notes"] = notes
        expenses.append(item)

    cancelled = []
    for row in source.get("cancelled") or []:
        item = {
            "date": row.get("date"),
            "status": clean_text(row.get("status")) or "cancelled",
            "gross": money(row.get("gross") or 0),
        }
        for key in ("broker", "load_no", "tonu"):
            text = opt_str(row, key)
            if text:
                item[key] = clean_text(text) if key != "load_no" else text
        if isinstance(row.get("deadhead_fuel"), (int, float)):
            item["deadhead_fuel"] = money(row["deadhead_fuel"])
        notes = clean_text(row.get("notes"))
        if notes:
            item["notes"] = notes
        cancelled.append(item)

    day_notes = []
    for row in source.get("day_notes") or []:
        text = clean_text(row.get("text"))
        if not text:
            continue
        day_notes.append({"date": row.get("date"), "text": text})

    dates = []
    for row in loads + expenses + cancelled + day_notes:
        if row.get("date"):
            dates.append(row["date"])
        if row.get("delivery_date"):
            dates.append(row["delivery_date"])
    as_of = max(dates) if dates else month + "-01"

    loads.sort(key=lambda row: (row.get("date") or "", row.get("load_no") or ""))
    expenses.sort(key=lambda row: (row.get("date") or "", row.get("vendor") or ""))
    cancelled.sort(key=lambda row: row.get("date") or "")
    day_notes.sort(key=lambda row: row.get("date") or "")

    return {
        "month": month,
        "as_of": as_of,
        "fee_pct": fee_pct,
        "loads": loads,
        "expenses": expenses,
        "cancelled": cancelled,
        "day_notes": day_notes,
    }


def load_existing_months(path):
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as handle:
        data = json.load(handle)
    months = data.get("months")
    if not isinstance(months, list):
        raise SystemExit("existing feed has no months array: " + path)
    return months


def assert_public(feed):
    blob = json.dumps(feed, ensure_ascii=False)
    match = BANNED_RE.search(blob)
    if match:
        raise SystemExit(
            "refusing to write feed; personal marker still present: "
            + match.group(0)
        )


def build_feed(months):
    months = sorted(months, key=lambda row: row.get("month") or "")
    latest_fee = 13
    if months:
        latest_fee = months[-1].get("fee_pct", 13)
    return {
        "schema": SCHEMA,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "company": "Sand Lily Pad LLC",
        "dba": "Black Ram Towing",
        "authority": "Leased onto Totni Enterprise",
        "fee_pct": latest_fee,
        "rig": {
            "truck": "2026 Ram 3500 dually",
            "trailer": "40 ft Big Tex gooseneck",
            "deck_capacity_lb": 15000,
        },
        "months": months,
    }


def main(argv):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="internal monthly data.json")
    parser.add_argument(
        "-o",
        "--output",
        default=DEFAULT_OUT,
        help="feed path to merge into (default: data/feed.json)",
    )
    args = parser.parse_args(argv)

    with open(args.source, "r", encoding="utf-8") as handle:
        source = json.load(handle)

    converted = convert_month(source)
    months = [
        row
        for row in load_existing_months(args.output)
        if row.get("month") != converted["month"]
    ]
    months.append(converted)
    feed = build_feed(months)
    assert_public(feed)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(feed, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    fuel = sum(
        row["amount"]
        for row in converted["expenses"]
        if row.get("category") == "fuel"
    )
    other = sum(
        row["amount"]
        for row in converted["expenses"]
        if row.get("category") != "fuel"
    )
    gross = sum(row["gross"] for row in converted["loads"])
    print(
        "wrote {path} month={month} loads={loads} gross={gross:.2f} "
        "fuel={fuel:.2f} other={other:.2f} months_in_feed={count}".format(
            path=args.output,
            month=converted["month"],
            loads=len(converted["loads"]),
            gross=gross,
            fuel=fuel,
            other=other,
            count=len(feed["months"]),
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
