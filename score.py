#!/usr/bin/env python3
"""Compute the two totals, the movement and the register order (SCO-01 to
SCO-05, D-07). The model emits factor scores against the anchors in PRD
section 5 and nothing else; every number below is arithmetic, done here.

    python3 score.py            # recompute and rewrite runs/week-*-register.json
    python3 score.py --check    # recompute and fail if the committed files differ
    python3 score.py 3          # one week

--check is what makes SCO-09 testable: the ordering is a pure function of
the committed factor scores, so repeated runs cannot disagree.
"""

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))

WEIGHTS = [
    ("proximity", 0.35),
    ("blast_radius", 0.25),
    ("control_status", 0.25),
    ("evidence_confidence", 0.15),
]
BANDS = [(15, 25, "critical"), (10, 14, "high"), (5, 9, "medium"), (1, 4, "low")]
BAND_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}
TYPE_ORDER = {"assurance-gap": 0, "risk": 1, "issue": 2, "dependency": 3}


def band_for(exposure):
    for lo, hi, name in BANDS:
        if lo <= exposure <= hi:
            return name
    raise ValueError(f"exposure {exposure} outside 1..25")


def attention(factors):
    """SCO-02. Weighted composite of four factors, each 0..5, yielding 0..5."""
    terms = []
    for name, weight in WEIGHTS:
        score = factors[name]
        terms.append({
            "factor": name,
            "score": score,
            "weight": weight,
            "product": round(score * weight, 4),
        })
    return round(sum(t["product"] for t in terms), 2), terms


def order_key(item):
    """SCO-04 for risks: exposure band descending, then attention descending.
    Attention never modifies exposure — it only orders within a band.

    A group never interleaves with another, because RPT-03 forbids a reader
    comparing an issue to a risk on one number, and assurance gaps lead the
    register whatever their attention (RPT-09). Within the other groups the
    primary key is that group's own scale: impact for issues, criticality for
    dependencies with blocking first, and attention alone for assurance gaps,
    which carry no score. The final tie-break is the id, so the order is
    total and repeat runs cannot differ (SCO-09).
    """
    comp = item["computed"]
    kind = item["type"]
    if kind == "risk":
        primary = (BAND_ORDER[comp["band"]],)
    elif kind == "issue":
        primary = (-item["impact"],)
    elif kind == "dependency":
        primary = (0 if item["blocking"] else 1, -item["criticality"])
    else:
        primary = ()
    return (TYPE_ORDER[kind],) + primary + (-comp["attention"], item["id"])


def measure_for(item):
    """SCO-05. The measure movement is computed against, by type."""
    if item["type"] == "risk":
        return "exposure", item["computed"]["exposure"]
    if item["type"] == "issue":
        return "impact", item["impact"]
    if item["type"] == "dependency":
        return "criticality", item["criticality"]
    if item["type"] == "assurance-gap":
        # Assurance gaps carry no score, so the measure is the thing that
        # actually deteriorates: how much this gap leaves unverifiable. Weeks
        # absent is deliberately not the measure — age never produces
        # movement (PRD section 5).
        cov = item["coverage"]
        return "unverifiable", cov.get("carried_unverifiable", 0) + cov.get("downstream_unconfirmed", 0)
    return None, None


def compute_movement(item, prior_by_lineage, earlier_lineages, week):
    """PRD section 5, movement rules. Evaluated in order; first match wins.

    Changes in proximity, control status, evidence confidence or age never
    produce movement, which is why only the measure above is compared.
    """
    lineage = item["lineage"]
    prior = prior_by_lineage.get(lineage)
    measure, value = measure_for(item)
    mv = {"measure": measure, "from": None, "to": value, "note": None}

    if item.get("reclassified", {}).get("week") == week:
        r = item["reclassified"]
        mv["state"] = "reclassified"
        mv["note"] = f"was a {r['from_type']} in week {r['week'] - 1}; {r['trigger']}"
        if prior:
            mv["from"] = measure_for(prior)[1] if prior["type"] == item["type"] else None
        return mv

    if item.get("resolved"):
        mv["state"] = "resolved"
        mv["from"] = measure_for(prior)[1] if prior else None
        return mv

    if prior is None and lineage in earlier_lineages:
        mv["state"] = "returned"
        mv["note"] = f"absent from week {week - 1}; last seen in week {earlier_lineages[lineage]}"
        return mv

    if prior is None:
        mv["state"] = "new"
        if week == 1:
            mv["note"] = "no prior register exists"
        return mv

    prior_measure, prior_value = measure_for(prior)
    mv["from"] = prior_value
    if prior_measure != measure or prior_value is None or value is None:
        mv["state"] = "stable"
    elif value > prior_value:
        mv["state"] = "worsening"
    elif value < prior_value:
        mv["state"] = "improving"
    else:
        mv["state"] = "stable"

    if item["type"] == "dependency":
        mv["weeks_waiting"] = week - item["week_started"] + 1
    return mv


def score_week(doc, prior_doc, earlier_lineages):
    week = doc["week"]
    prior_by_lineage = {i["lineage"]: i for i in (prior_doc["items"] if prior_doc else [])}

    for item in doc["items"]:
        factors = item["attention_factors"]
        att, terms = attention(factors)
        computed = {"attention": att, "attention_terms": terms}
        if item["type"] == "risk":
            exposure = item["impact"] * item["likelihood"]
            computed["exposure"] = exposure
            computed["band"] = band_for(exposure)
        item["computed"] = computed

    for item in doc["items"]:
        item["movement"] = compute_movement(item, prior_by_lineage, earlier_lineages, week)

    doc["items"].sort(key=order_key)
    group_seen = {}
    for n, item in enumerate(doc["items"], 1):
        group_seen[item["type"]] = group_seen.get(item["type"], 0) + 1
        item["computed"]["rank"] = n
        item["computed"]["group_rank"] = group_seen[item["type"]]

    doc["coverage"]["unverified_count"] = len(doc["gaps"])
    return doc


def load(week):
    with open(os.path.join(ROOT, "runs", f"week-{week}-register.json"), encoding="utf-8") as fh:
        return json.load(fh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("weeks", nargs="*", type=int, default=[1, 2, 3, 4])
    ap.add_argument("--check", action="store_true",
                    help="do not write; exit 1 if a committed file differs from the recomputation")
    args = ap.parse_args()

    differences = []
    prior = None
    earlier_lineages = {}
    for week in [1, 2, 3, 4]:
        doc = load(week)
        before = json.dumps(doc, sort_keys=True)
        scored = score_week(doc, prior, dict(earlier_lineages))
        after = json.dumps(scored, sort_keys=True)

        if week in args.weeks:
            if args.check:
                if before != after:
                    differences.append(week)
                    print(f"week {week}: committed file differs from recomputation", file=sys.stderr)
                else:
                    top5 = [i["id"] for i in scored["items"][:5]]
                    print(f"week {week}: ok   top 5 {' '.join(top5)}")
            else:
                path = os.path.join(ROOT, "runs", f"week-{week}-register.json")
                with open(path, "w", encoding="utf-8") as fh:
                    json.dump(scored, fh, indent=2, ensure_ascii=False)
                    fh.write("\n")
                print(f"week {week}: scored {len(scored['items'])} items -> {os.path.relpath(path, ROOT)}")

        for item in scored["items"]:
            earlier_lineages[item["lineage"]] = week
        prior = scored

    return 1 if differences else 0


if __name__ == "__main__":
    sys.exit(main())
