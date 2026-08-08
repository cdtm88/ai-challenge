#!/usr/bin/env python3
"""Validate the four weekly registers against schema/register.schema.json
and against the invariants JSON Schema cannot express (ING-07).

    python3 validate.py            # all four weeks
    python3 validate.py 3          # one week

Exits 0 when every check passes, 1 otherwise.

No third-party dependency: this file carries a small draft-07 subset
validator covering only the keywords the schema uses. If the `jsonschema`
package happens to be installed it is used as a cross-check and any
disagreement between the two is itself reported as a failure.
"""

import argparse
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ROOT, "tools"))

from corpus_stats import compute as corpus_compute  # noqa: E402

HEDGE_TERMS = [
    "assuming", "should be", "hopefully", "likely", "i think", "probably",
    "if x then", "in theory", "realistically", "we expect", "all being well",
    "more or less", "ought to",
]
BANDS = [(15, 25, "critical"), (10, 14, "high"), (5, 9, "medium"), (1, 4, "low")]
WEIGHTS = {"proximity": 0.35, "blast_radius": 0.25, "control_status": 0.25,
           "evidence_confidence": 0.15}


# --------------------------------------------------------------------------
# draft-07 subset validator
# --------------------------------------------------------------------------

TYPES = {
    "object": dict, "array": list, "string": str, "boolean": bool,
    "number": (int, float), "integer": int, "null": type(None),
}


def _is_type(value, name):
    if name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if name == "boolean":
        return isinstance(value, bool)
    py = TYPES.get(name)
    return isinstance(value, py) if py else True


def _resolve(root, ref):
    node = root
    for part in ref.lstrip("#/").split("/"):
        node = node[part]
    return node


def _validate(node, schema, root, path, errors):
    if schema is True or schema == {}:
        return
    if schema is False:
        errors.append(f"{path}: schema is false")
        return
    if "$ref" in schema:
        _validate(node, _resolve(root, schema["$ref"]), root, path, errors)
        return

    if "type" in schema:
        names = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(_is_type(node, n) for n in names):
            errors.append(f"{path}: expected type {'/'.join(names)}, got {type(node).__name__}")
            return
    if "const" in schema and node != schema["const"]:
        errors.append(f"{path}: expected const {schema['const']!r}, got {node!r}")
    if "enum" in schema and node not in schema["enum"]:
        errors.append(f"{path}: {node!r} not in {schema['enum']}")

    if isinstance(node, str):
        if "minLength" in schema and len(node) < schema["minLength"]:
            errors.append(f"{path}: shorter than minLength {schema['minLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], node):
            errors.append(f"{path}: {node!r} does not match {schema['pattern']}")
    if isinstance(node, (int, float)) and not isinstance(node, bool):
        if "minimum" in schema and node < schema["minimum"]:
            errors.append(f"{path}: {node} below minimum {schema['minimum']}")
        if "maximum" in schema and node > schema["maximum"]:
            errors.append(f"{path}: {node} above maximum {schema['maximum']}")

    if isinstance(node, list):
        if "minItems" in schema and len(node) < schema["minItems"]:
            errors.append(f"{path}: fewer than minItems {schema['minItems']}")
        if "items" in schema:
            for i, el in enumerate(node):
                _validate(el, schema["items"], root, f"{path}[{i}]", errors)

    if isinstance(node, dict):
        for key in schema.get("required", []):
            if key not in node:
                errors.append(f"{path}: missing required property {key!r}")
        props = schema.get("properties", {})
        for key, sub in props.items():
            if key in node:
                _validate(node[key], sub, root, f"{path}.{key}", errors)
        addl = schema.get("additionalProperties", True)
        if addl is not True:
            extra = sorted(set(node) - set(props))
            if addl is False:
                for key in extra:
                    errors.append(f"{path}: unexpected property {key!r}")
            else:
                for key in extra:
                    _validate(node[key], addl, root, f"{path}.{key}", errors)

    for sub in schema.get("allOf", []):
        _validate(node, sub, root, path, errors)
    if "anyOf" in schema:
        if not any(_ok(node, s, root) for s in schema["anyOf"]):
            errors.append(f"{path}: matched none of anyOf")
    if "oneOf" in schema:
        matches = [s for s in schema["oneOf"] if _ok(node, s, root)]
        if len(matches) != 1:
            errors.append(f"{path}: matched {len(matches)} of oneOf, expected exactly 1")
    if "not" in schema and _ok(node, schema["not"], root):
        errors.append(f"{path}: matched a forbidden 'not' schema")
    if "if" in schema:
        branch = "then" if _ok(node, schema["if"], root) else "else"
        if branch in schema:
            _validate(node, schema[branch], root, path, errors)


def _ok(node, schema, root):
    errs = []
    _validate(node, schema, root, "", errs)
    return not errs


def schema_errors(doc, schema):
    errors = []
    _validate(doc, schema, schema, "$", errors)
    return errors


def cross_check(doc, schema):
    """If jsonschema is installed, confirm it agrees with the built-in validator."""
    try:
        import jsonschema
    except ImportError:
        return None
    validator = jsonschema.Draft7Validator(schema)
    return [f"$.{e.json_path[2:]}: {e.message}" if e.json_path else e.message
            for e in validator.iter_errors(doc)]


# --------------------------------------------------------------------------
# invariants JSON Schema cannot express
# --------------------------------------------------------------------------

def band_for(exposure):
    for lo, hi, name in BANDS:
        if lo <= exposure <= hi:
            return name
    return None


def check_invariants(doc, week, stats, failures):
    def fail(msg):
        failures.append(f"week {week}: {msg}")

    ids = [i["id"] for i in doc["items"]]
    if len(set(ids)) != len(ids):
        fail("duplicate item ids")
    lineages = [i["lineage"] for i in doc["items"]]
    if len(set(lineages)) != len(lineages):
        fail("duplicate lineages in one week")

    ws = stats["weeks"][week - 1]
    cov = doc["coverage"]
    for key, derived in (
        ("airtime_seconds", ws["airtime_seconds"]),
        ("transitions", ws["transitions"]),
    ):
        if cov[key] != derived:
            fail(f"coverage.{key} disagrees with tools/corpus_stats.py")
    for key, derived in (
        ("airtime_total_seconds", ws["airtime_total_seconds"]),
        ("transitions_total", ws["transitions_total"]),
        ("workstreams_reporting", ws["workstreams_reporting"]),
        ("workstreams_total", ws["workstreams_total"]),
        ("meeting_duration_seconds", ws["meeting_duration_seconds"]),
    ):
        if cov[key] != derived:
            fail(f"coverage.{key} is {cov[key]}, corpus says {derived}")
    # ING-02
    if cov["airtime_total_seconds"] > cov["meeting_duration_seconds"]:
        fail("airtime exceeds the meeting duration (ING-02)")
    if cov["unverified_count"] != len(doc["gaps"]):
        fail(f"coverage.unverified_count {cov['unverified_count']} != len(gaps) {len(doc['gaps'])}")

    for item in doc["items"]:
        tag = f"{item['id']}"

        # EVI-01
        if not item["sources"]:
            fail(f"{tag}: no source — should have been dropped, not softened (EVI-01)")

        # EVI-02: evidence confidence follows from the source types present.
        types = {s["type"] for s in item["sources"]}
        disagree = item.get("contradiction", {}).get("present", False)
        expected = 5 if len(types) < 2 else (1 if disagree else 2)
        got = item["attention_factors"]["evidence_confidence"]
        if got != expected:
            fail(f"{tag}: evidence_confidence {got}, expected {expected} "
                 f"({len(types)} source types, disagree={disagree}) (EVI-02)")

        # control.score must be the control_status attention factor.
        if item["control"]["score"] != item["attention_factors"]["control_status"]:
            fail(f"{tag}: control.score != attention_factors.control_status")

        # SCO-06
        if item["owner"]["role"] is None and item["owner"]["stated"]:
            fail(f"{tag}: unowned but marked as stated")

        # SCO-08
        hedge = item.get("hedge", {})
        if hedge.get("present") and hedge.get("cap_applied"):
            if item.get("likelihood") is not None and item["likelihood"] > 3:
                fail(f"{tag}: hedged evidence but likelihood {item['likelihood']} > 3 (SCO-08)")
        if hedge.get("present"):
            quote = (hedge.get("quote") or "").lower()
            if not any(t in quote for t in hedge.get("terms", [])):
                fail(f"{tag}: hedge terms not found in the quoted text")
            for term in hedge.get("terms", []):
                if term not in HEDGE_TERMS:
                    fail(f"{tag}: {term!r} is not in the fixed hedge list (D-09)")

        # SCO-01 / SCO-02 arithmetic, recomputed here independently of score.py.
        comp = item["computed"]
        if item["type"] == "risk":
            exp = item["impact"] * item["likelihood"]
            if comp.get("exposure") != exp:
                fail(f"{tag}: exposure {comp.get('exposure')} != {item['impact']}x{item['likelihood']}")
            if comp.get("band") != band_for(exp):
                fail(f"{tag}: band {comp.get('band')} wrong for exposure {exp}")
            if item["proximity"] != item["attention_factors"]["proximity"]:
                fail(f"{tag}: item proximity != attention factor proximity")
        att = round(sum(item["attention_factors"][k] * w for k, w in WEIGHTS.items()), 2)
        if abs(comp["attention"] - att) > 1e-9:
            fail(f"{tag}: attention {comp['attention']} != recomputed {att}")
        terms = {t["factor"]: t for t in comp["attention_terms"]}
        if set(terms) != set(WEIGHTS):
            fail(f"{tag}: attention_terms do not cover the four factors")
        for name, weight in WEIGHTS.items():
            t = terms.get(name)
            if not t:
                continue
            if t["weight"] != weight:
                fail(f"{tag}: {name} weight {t['weight']} != {weight}")
            if abs(t["product"] - round(t["score"] * weight, 4)) > 1e-9:
                fail(f"{tag}: {name} product does not equal score x weight")

        # CLS-03
        if item["type"] == "dependency" and item["blocking"]:
            stated = any(
                s["type"] == "ticket" and "blocked_by" in s.get("field", "")
                for s in item["sources"]
            ) or any(s["type"] == "transcript" for s in item["sources"])
            if not stated:
                fail(f"{tag}: marked blocking with neither a blocked_by ticket nor a spoken source (CLS-03)")

        # EVI-03
        con = item.get("contradiction", {})
        if con.get("present"):
            if len({s["type"] for s in item["sources"]}) < 2:
                fail(f"{tag}: contradiction raised from fewer than two source types")
            if not con.get("routed_to"):
                fail(f"{tag}: contradiction not routed (EVI-03)")
            if not con.get("precedence"):
                fail(f"{tag}: contradiction states no precedence (EVI-03)")

    # CLS-05: a workstream under the airtime floor or with no transitions must
    # produce an assurance gap and must not carry a scored risk that week.
    quiet = set(ws["assurance_triggers"]["low_airtime"]) | set(ws["assurance_triggers"]["zero_transitions"])
    gapped = {i["workstream"] for i in doc["items"] if i["type"] == "assurance-gap"}
    for w in quiet:
        if w not in gapped:
            fail(f"{w} is under the coverage floor but has no assurance gap (CLS-05)")
    for item in doc["items"]:
        if item["type"] == "risk" and item["workstream"] in quiet:
            fail(f"{item['id']}: scored risk on {item['workstream']}, which is under the coverage floor (CLS-05)")

    # SCO-04: register order is exposure band descending, then attention descending.
    from score import order_key  # noqa: E402
    ordered = sorted(doc["items"], key=order_key)
    if [i["id"] for i in ordered] != [i["id"] for i in doc["items"]]:
        fail("items are not stored in register order (SCO-04)")
    for n, item in enumerate(doc["items"], 1):
        if item["computed"]["rank"] != n:
            fail(f"{item['id']}: rank {item['computed']['rank']} != position {n}")

    # RPT-09: assurance gaps precede everything else.
    seen_other = False
    for item in doc["items"]:
        if item["type"] != "assurance-gap":
            seen_other = True
        elif seen_other:
            fail(f"{item['id']}: assurance gap appears after a scored item (RPT-09)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("weeks", nargs="*", type=int, default=[1, 2, 3, 4])
    args = ap.parse_args()

    with open(os.path.join(ROOT, "schema", "register.schema.json"), encoding="utf-8") as fh:
        schema = json.load(fh)
    stats = corpus_compute()

    failures = []
    agreed = True
    for week in args.weeks:
        path = os.path.join(ROOT, "runs", f"week-{week}-register.json")
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)

        errs = schema_errors(doc, schema)
        failures.extend(f"week {week}: schema: {e}" for e in errs)

        external = cross_check(doc, schema)
        if external is not None:
            if bool(external) != bool(errs):
                agreed = False
                failures.append(
                    f"week {week}: built-in validator and jsonschema disagree "
                    f"(built-in {len(errs)} errors, jsonschema {len(external)}): "
                    + "; ".join(external[:3])
                )
        check_invariants(doc, week, stats, failures)

        status = "FAIL" if any(f.startswith(f"week {week}:") for f in failures) else "ok"
        print(f"week {week}: {len(doc['items'])} items, {len(doc['gaps'])} gaps ... {status}")

    if failures:
        print(f"\n{len(failures)} failure(s):", file=sys.stderr)
        for f in failures:
            print(f"  - {f}", file=sys.stderr)
        return 1
    print("\nall weeks valid"
          + ("" if agreed else "")
          + (" (cross-checked against jsonschema)" if cross_check({}, {"type": "object"}) is not None else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
