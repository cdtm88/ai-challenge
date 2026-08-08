# Pass 2 — score

You are given the classified, cited output of pass 1. Your job is to score
each factor against the anchors below, and **nothing else**.

You do not multiply. You do not add. You do not weight. You do not sort. You
do not decide movement. Every total, every band, every ordering and every
movement state is computed in code from the factor scores you emit (SCO-03,
D-07). This is deliberate: a model judges a factor against a written anchor
well and does consistent weighted arithmetic badly, and the arithmetic is
where confident-sounding wrongness usually enters.

If you emit `exposure`, `attention`, `band`, `rank` or `movement`, the run is
invalid.

---

## Score the type you were given

Do not reclassify in this pass. Pass 1 decided the type; the type decides the
scale. Emitting likelihood on an issue is a validation failure (CLS-02), not
a judgement call.

| Type | Emit |
|---|---|
| **risk** | `impact`, `likelihood`, `proximity`, `control`, `attention_factors` |
| **issue** | `impact`, `control`, `attention_factors` |
| **dependency** | `criticality`, `control`, `attention_factors` |
| **assurance gap** | `coverage` counts, `control`, `attention_factors` — **no score at all** |

`attention_factors` is emitted for every type, including assurance gaps
(SCO-02). It carries a `proximity` factor for every type; that is a scoring
input to the attention composite, and is not the item-level `proximity` field,
which stays risk-only.

---

## Anchors

Score against the words, not against a feeling about the words. Where a
finding sits between two anchors, take the lower unless the evidence names
the higher one.

### Impact — 1 to 5. Risks and issues.

| Score | Anchor |
|---|---|
| 1 | Absorbed within the workstream. No schedule effect. |
| 2 | A task or ticket slips. Recoverable inside the sprint. |
| 3 | A milestone moves, or another workstream has to replan. |
| 4 | The release date is at risk. |
| 5 | The release moves, or a commitment made outside the programme is broken. |

### Likelihood — 1 to 5. Risks only.

| Score | Anchor |
|---|---|
| 1 | Hypothetical. Raised as a concern with no supporting signal. |
| 2 | Possible but unlikely on current evidence. |
| 3 | Evens. Could reasonably go either way. |
| 4 | More likely than not. |
| 5 | Already happening, or certain on current evidence. **Consider whether this is now an issue.** |

### Proximity — 0 to 5. All types.

| Score | Anchor |
|---|---|
| 5 | Within 2 weeks. |
| 4 | Within 4 weeks. |
| 3 | Within 6 weeks. |
| 2 | Within 3 months. |
| 1 | Within 6 months. |
| 0 | Beyond 6 months, **or no timeframe stated**. Unknown scores 0 and is recorded in gaps. |

### Blast radius — 0 to 5. All types.

| Score | Anchor |
|---|---|
| 0 | Contained within one workstream. |
| 3 | One other workstream is affected. |
| 5 | Programme-wide, or affects a party outside the programme. |

### Control status — 0 to 5. All types.

| Score | Anchor |
|---|---|
| 0 | Mitigation stated, owned, with a date. |
| 2 | Mitigation stated and owned, no date. |
| 4 | Mitigation mentioned but unowned, or an action stated with no substance. |
| 5 | Nothing stated and no owner. |

Score this from what pass 1 captured in `control`. Do not invent a mitigation
in order to score it lower.

### Evidence confidence — 1, 2 or 5. All types. Only these three values.

| Score | Anchor |
|---|---|
| 1 | Two or more source types cover this and they **disagree**. |
| 2 | Two or more source types cover this and they **agree**. |
| 5 | A single source, uncorroborated. |

Higher means **less certain**, so it raises attention. An unverified claim
needs checking, not discounting. This follows mechanically from the
`sources` array and the `contradiction` flag pass 1 gave you — count the
distinct `type` values, and check whether a contradiction was raised.

### Criticality — 1 to 5. Dependencies only.

| Score | Anchor |
|---|---|
| 1 | Desirable. Work continues without it. |
| 3 | A milestone depends on it. |
| 5 | The release depends on it and there is no alternative path. |

### Coverage — assurance gaps only. Counts, not scores.

Airtime in seconds; ticket transitions in the period; count of carried-forward
items that cannot be verified; count of downstream dependencies left
unconfirmed. Take these from the inputs. Do not estimate them.

---

## The hedge cap — SCO-08

Where pass 1 marked `hedge.present` and the hedged quote is the **only**
supporting evidence for the claim, **likelihood cannot exceed 3**. Set it to
at most 3 and record that you did:

```json
"hedge": { "present": true, "terms": ["should be", "all being well"],
           "quote": "should be fine for cycle two, all being well",
           "cap_applied": true }
```

If corroborating evidence of another source type exists, the cap does not
apply and `cap_applied` is false.

---

## Record the anchor you used

For every factor, name the anchor sentence you scored against. The reader has
to be able to argue with the judgement rather than with the total, and they
cannot do that if the anchor is implicit.

```json
"attention_factors": {
  "proximity": 5,
  "blast_radius": 5,
  "control_status": 4,
  "evidence_confidence": 1,
  "anchors": {
    "proximity": "Within 2 weeks.",
    "blast_radius": "Programme-wide, or affects a party outside the programme.",
    "control_status": "Mitigation mentioned but unowned, or an action stated with no substance.",
    "evidence_confidence": "Two or more source types cover this and they disagree."
  }
}
```

`control.score` must equal `attention_factors.control_status`. They are the
same judgement recorded twice, once where the reader looks for it and once
where the arithmetic reads it.

---

## Output

Emit the pass 1 document back, unchanged except for the scoring fields you
have added. Preserve `lineage`, `sources`, `statement`, `contradiction` and
`reclassified` exactly as you received them. JSON only.

```json
{
  "week": 3,
  "date": "2026-07-27",
  "pass": "2-score",
  "generated_by": "…",
  "prior_register": "runs/week-2-register.json",
  "coverage": { … },
  "items": [
    {
      "id": "RK-02",
      "lineage": "contract-release-risk",
      "type": "risk",
      "title": "…",
      "statement": "…",
      "workstream": "integration",
      "owner": { … },
      "sources": [ … ],
      "impact": 4,
      "likelihood": 4,
      "proximity": 5,
      "control": { "stated": true, "text": "…", "owner": null, "date": null, "score": 4,
                   "anchor": "Mitigation mentioned but unowned, or an action stated with no substance." },
      "attention_factors": { … },
      "hedge": { "present": false },
      "contradiction": { … },
      "acceptance": { "state": "unaccepted" }
    }
  ],
  "gaps": [ … ]
}
```

Assign ids type-prefixed — `RK-`, `IS-`, `DP-`, `AG-` — reusing the id the
prior register gave this lineage where the type has not changed. When a
lineage changes type, mint a new id in the new prefix and leave the old id in
`reclassified.from_id`.

Carry `acceptance` forward from the prior register for any lineage already
adjudicated, so decided items are not re-litigated (F6, D-11). Everything
else is `"unaccepted"`.

Leave `movement` and `computed` out entirely. `score.py` writes them.
