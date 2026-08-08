# Pass 1 — extract and classify

You are reading one week of a delivery programme's records. Your job in this
pass is to find every finding the records support, decide what type each one
is, and attach the evidence. **You do not score anything in this pass.** A
second pass scores what you produce here.

Classification precedes scoring because type determines the scale (D-05). If
you score first, everything ends up on the wrong scale and an issue gets a
probability it cannot have.

---

## Inputs

You are given four things and no others.

1. `transcript` — this week's meeting, speaker-labelled by role, with line
   numbers, timestamps and per-workstream airtime in seconds.
2. `tickets` — the ticket export, all rows created on or before this week's
   meeting date, with `ticket_id`, `workstream`, `title`, `status`,
   `assignee_role`, `created_date`, `status_changed_date`, `due_date`,
   `blocked_by`.
3. `board` — the RAG status reported per workstream for this week and the
   weeks before it.
4. `prior_register` — last week's **accepted** register, or null in week 1.

**No source is privileged.** The board is a reported record, not an observed
one. The transcript is what people said, not what is true. The export is what
the tooling knows, which is not everything. The gap between them is the most
valuable thing you can find, and privileging one source destroys it (D-08).

---

## Classification tests

Every finding is exactly one of these four. Apply the tests in order and take
the first that fits.

| Type | Test |
|---|---|
| **assurance gap** | The control that would reveal this workstream's state has failed. You cannot tell what is happening, and the reason you cannot tell is itself the finding. |
| **issue** | It has already happened, or it is certain on current evidence. There is no probability left in it. |
| **dependency** | Progress is contingent on a party outside the workstream. Both parties are nameable. |
| **risk** | Uncertain and in the future. Something might happen; it has not yet. |

Three rules that override judgement:

- **A workstream with under 2 minutes of airtime, or zero ticket transitions
  this week, produces an assurance gap reporting its coverage — never a
  scored risk** (CLS-05). You do not know enough about that workstream to
  score it, and pretending otherwise is the failure mode this tool exists to
  prevent. Do not name workstreams you are looking for; apply the rule to
  whatever the numbers show.
- **A dependency is blocking** when a source states that work cannot proceed
  without it, **or** when a ticket in the waiting workstream carries a
  `blocked_by` reference to the counterparty (CLS-03).
- **Something already happening is an issue, not a near-certain risk.** If you
  find yourself wanting to write likelihood 5, stop and reclassify.

---

## Reclassification

An item may change type between weeks. When it does, record it:

```json
"reclassified": { "week": 2, "from_type": "risk", "from_id": "RK-01",
                  "trigger": "the milestone date passed with the environment unprovisioned" }
```

Match against the **`lineage`** field in `prior_register`, not against the
prose and not against the id. The same finding will be described differently
each week; the lineage is what makes it the same finding. Reuse the prior
lineage exactly. Mint a new one only when nothing in the prior register is
the same finding.

---

## Evidence

**Every item carries at least one typed source. An item with no source is
dropped, not softened** (EVI-01). Four source shapes, and no others:

```json
{ "type": "transcript", "week": 3, "line": 14, "timestamp": "00:11:22",
  "speaker": "Integration lead", "quote": "verbatim, exactly as spoken" }

{ "type": "ticket", "ticket_id": "INT-114", "field": "status_changed_date",
  "value": "2026-07-06", "observation": "what this field shows, stated plainly" }

{ "type": "board", "workstream": "integration", "status": "green",
  "date": "2026-07-27", "observation": "what was reported" }

{ "type": "metadata", "measure": "airtime_seconds", "value": "0",
  "observation": "a run-level observation about coverage, not about content" }
```

Quotes are verbatim. Do not tidy grammar, do not paraphrase, do not merge two
lines into one quote.

### Contradiction

Where two or more sources cover the same item and disagree, say so
explicitly, cite all of them, and route it:

```json
"contradiction": {
  "present": true,
  "statement": "the board reports green; the lead states work is stopped; the blocking ticket has not moved in 21 days",
  "source_types": ["ticket", "transcript", "board"],
  "precedence": "ticket",
  "routed_to": "Delivery manager, as owner of the reported board"
}
```

Precedence is fixed: **ticket export, then spoken claim, then board status**
(EVI-03). Conflict does not weaken an item. It raises the attention it needs.

### Three detections that require nobody to have said anything

Run these over the export alone. They are the point of the tool — a summary
of the meeting inherits the meeting's blind spots (EVI-04).

1. **Staleness.** Any non-closed ticket whose `status_changed_date` is more
   than 10 days before this week's meeting date. Report by workstream. Raise
   an item where a workstream has three or more; below that, note it and move
   on.
2. **Scope growth.** A workstream where tickets opened exceed tickets closed
   for two consecutive weeks. Raise it where the excess is three or more in
   each of those weeks; below that the signal is noise at this data volume.
3. **Progress claimed with no transition.** A workstream that spoke about
   progress this week and has zero ticket transitions in the same week.

Both thresholds above are configurable assumptions, not derived facts. Four
weeks of data cannot calibrate them.

---

## Owners and mitigations

- **Owners are never invented** (SCO-06). Take the stated owner. If nobody is
  stated, default to whoever raised it and say that is the basis. If neither,
  emit `"role": null, "stated": false`.
- **Mitigations are never generated** (SCO-07). Capture what was stated, with
  its owner and date where given. If nothing was stated, the control is
  nothing stated. Do not write what someone ought to do.

---

## Hedge terms

Match case-insensitively against the claim text. **Exactly this list, no
synonyms, no sentiment judgement** (D-09):

> assuming · should be · hopefully · likely · I think · probably · if X then ·
> in theory · realistically · we expect · all being well · more or less ·
> ought to

Where a claim's only supporting evidence carries one of these, record it:

```json
"hedge": { "present": true, "terms": ["should be", "all being well"],
           "quote": "should be fine for cycle two, all being well" }
```

Pass 2 applies the cap. You only mark it.

---

## What to leave out

Anything you cannot trace to a source goes in `gaps` with a reason, not in
`items` (EVI-05):

```json
{ "ref": "RK-04", "subject": "adoption readiness for go-live",
  "reason": "no source this week; the workstream did not attend and its tickets show no relevant transition. Held out rather than carried forward on week 1's quote." }
```

An item that was in last week's register and has no evidence this week is
**held out and named here**. It is never carried forward on last week's quote.

---

## Output

Emit JSON only. No prose before or after.

```json
{
  "week": 3,
  "date": "2026-07-27",
  "pass": "1-extract-classify",
  "items": [
    {
      "lineage": "contract-release-risk",
      "type": "risk",
      "title": "short, specific, readable in a list",
      "statement": "one sentence a delivery manager could read aloud at a steering group",
      "workstream": "integration",
      "owner": { "role": "Integration lead", "stated": true },
      "sources": [ ... ],
      "control": { "stated": false, "text": null, "owner": null, "date": null },
      "hedge": { "present": false },
      "contradiction": { "present": false },
      "counterparty": null,
      "waiting_workstream": null,
      "week_started": null,
      "blocking": null,
      "coverage": null,
      "reclassified": null
    }
  ],
  "gaps": [ ... ]
}
```

Set the type-specific fields only where the type calls for them; leave the
rest null. Dependencies require `counterparty`, `waiting_workstream`,
`week_started` and `blocking`. Assurance gaps require `coverage` with
`airtime_seconds` and `transitions` at minimum.

**Do not emit any number that is a score.** No impact, no likelihood, no
proximity, no criticality, no attention, no totals. That is pass 2.
