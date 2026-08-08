#!/usr/bin/env python3
"""Derive per-week coverage numbers and the three export-only detections
(EVI-04) from the committed corpus.

This is corpus arithmetic, not judgement. It exists so that the numbers
quoted in runs/*.json are computed from data/ rather than asserted, and so
they can be re-derived at any time:

    python3 tools/corpus_stats.py            # human-readable
    python3 tools/corpus_stats.py --json     # machine-readable

Derivation rules, stated because tickets.csv is a single snapshot:
  * A ticket counts as a TRANSITION in week W if status_changed_date falls
    inside W's window.
  * A ticket counts as OPENED in W if created_date falls inside W's window.
  * A ticket counts as CLOSED in W if its status is a closed status and its
    status_changed_date falls inside W's window.
  * STALENESS at W is (W's meeting date - status_changed_date) in days, for
    tickets created on or before W's meeting date and not in a closed status.
Only rows created on or before a week's meeting date are visible to that week.
"""

import argparse
import csv
import json
import os
from datetime import date, timedelta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLOSED_STATUSES = {"Done"}
STALE_DAYS = 10  # EVI-04; asserted, not derived — see PRD section 10.
LOW_AIRTIME_SECONDS = 120  # CLS-05

WEEKS = [
    {"week": 1, "date": "2026-07-13"},
    {"week": 2, "date": "2026-07-20"},
    {"week": 3, "date": "2026-07-27"},
    {"week": 4, "date": "2026-08-03"},
]


def d(s):
    return date.fromisoformat(s)


def load_tickets():
    with open(os.path.join(ROOT, "data", "tickets.csv"), newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def load_transcript(week):
    with open(os.path.join(ROOT, "data", "transcripts", f"week-{week}.json"), encoding="utf-8") as fh:
        return json.load(fh)


def load_board():
    with open(os.path.join(ROOT, "data", "board.json"), encoding="utf-8") as fh:
        return json.load(fh)


def window(week_date):
    end = d(week_date)
    return end - timedelta(days=6), end


def compute():
    tickets = load_tickets()
    board = load_board()
    workstreams = list(board["workstreams"].keys())
    out = {"workstreams": board["workstreams"], "weeks": []}

    prior_growth = {ws: 0 for ws in workstreams}

    for wk in WEEKS:
        start, end = window(wk["date"])
        tr = load_transcript(wk["week"])
        airtime = tr["airtime_seconds"]
        visible = [t for t in tickets if d(t["created_date"]) <= end]

        transitions, opened, closed, stale = {}, {}, {}, {}
        for ws in workstreams:
            rows = [t for t in visible if t["workstream"] == ws]
            transitions[ws] = sum(1 for t in rows if start <= d(t["status_changed_date"]) <= end)
            opened[ws] = sum(1 for t in rows if start <= d(t["created_date"]) <= end)
            closed[ws] = sum(
                1
                for t in rows
                if t["status"] in CLOSED_STATUSES and start <= d(t["status_changed_date"]) <= end
            )
            stale[ws] = sorted(
                (
                    {
                        "ticket_id": t["ticket_id"],
                        "status": t["status"],
                        "status_changed_date": t["status_changed_date"],
                        "days": (end - d(t["status_changed_date"])).days,
                    }
                    for t in rows
                    if t["status"] not in CLOSED_STATUSES
                    and (end - d(t["status_changed_date"])).days > STALE_DAYS
                ),
                key=lambda r: -r["days"],
            )

        # EVI-04 detection 2: open count exceeding closures for two consecutive weeks.
        growth_streak = {}
        for ws in workstreams:
            growing = opened[ws] > closed[ws]
            growth_streak[ws] = prior_growth[ws] + 1 if growing else 0
        prior_growth = dict(growth_streak)

        # EVI-04 detection 3: progress claimed in the meeting with zero transitions.
        spoke = {ws: any(l.get("workstream") == ws for l in tr["lines"]) for ws in workstreams}
        claimed_no_transition = [
            ws for ws in workstreams if spoke[ws] and airtime.get(ws, 0) > 0 and transitions[ws] == 0
        ]

        # CLS-05: assurance-gap triggers.
        low_airtime = [ws for ws in workstreams if airtime.get(ws, 0) < LOW_AIRTIME_SECONDS]
        zero_transitions = [ws for ws in workstreams if transitions[ws] == 0]
        reporting_ok = [
            ws
            for ws in workstreams
            if airtime.get(ws, 0) >= LOW_AIRTIME_SECONDS and transitions[ws] > 0
        ]

        out["weeks"].append(
            {
                "week": wk["week"],
                "date": wk["date"],
                "window": [start.isoformat(), end.isoformat()],
                "meeting_duration_seconds": tr["duration_seconds"],
                "airtime_seconds": airtime,
                "airtime_total_seconds": sum(airtime.values()),
                "transitions": transitions,
                "transitions_total": sum(transitions.values()),
                "opened": opened,
                "closed": closed,
                "growth_streak": growth_streak,
                "stale": stale,
                "detections": {
                    "staleness": {ws: v for ws, v in stale.items() if v},
                    "scope_growth": {ws: n for ws, n in growth_streak.items() if n >= 2},
                    "progress_claimed_no_transition": claimed_no_transition,
                },
                "assurance_triggers": {
                    "low_airtime": low_airtime,
                    "zero_transitions": zero_transitions,
                },
                "workstreams_reporting": len(reporting_ok),
                "workstreams_total": len(workstreams),
                "board": next(b["status"] for b in board["weeks"] if b["week"] == wk["week"]),
            }
        )
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()
    stats = compute()
    if args.json:
        print(json.dumps(stats, indent=2))
        return
    for w in stats["weeks"]:
        mins, secs = divmod(w["airtime_total_seconds"], 60)
        print(f"\n=== Week {w['week']} ({w['date']}) window {w['window'][0]}..{w['window'][1]} ===")
        print(f"  airtime {mins}m {secs:02d}s / {w['meeting_duration_seconds'] // 60}m"
              f"   transitions {w['transitions_total']}"
              f"   reporting {w['workstreams_reporting']} of {w['workstreams_total']}")
        print(f"  airtime      {w['airtime_seconds']}")
        print(f"  transitions  {w['transitions']}")
        print(f"  opened       {w['opened']}")
        print(f"  closed       {w['closed']}")
        print(f"  growth streak{w['growth_streak']}")
        print(f"  assurance triggers: {w['assurance_triggers']}")
        print("  detections:")
        for ws, rows in w["detections"]["staleness"].items():
            ids = ", ".join(f"{r['ticket_id']} {r['days']}d" for r in rows)
            print(f"    stale       {ws}: {ids}")
        for ws, n in w["detections"]["scope_growth"].items():
            print(f"    growth      {ws}: {n} consecutive weeks "
                  f"(opened {w['opened'][ws]} / closed {w['closed'][ws]})")
        for ws in w["detections"]["progress_claimed_no_transition"]:
            print(f"    no-movement {ws}: spoke for {w['airtime_seconds'][ws]}s, 0 transitions")


if __name__ == "__main__":
    main()
