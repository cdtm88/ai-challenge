# Risk Radar

A delivery risk tool that reads the weekly delivery meeting transcript alongside
the ticket export and the reported RAG board, classifies what it finds, and
returns a draft register where every item cites its evidence.

Where the three records disagree, it says so. A workstream that stops reporting
is measured rather than assumed green. Nothing is accepted until a human accepts
it.

Built to [`docs/risk-radar-prd.md`](docs/risk-radar-prd.md) and
[`docs/risk-radar-design-plan.html`](docs/risk-radar-design-plan.html).

---

## Read it

Open `index.html` over any static file server:

```sh
python3 -m http.server 8765
# then http://127.0.0.1:8765/index.html#week-3
```

Or open `risk-radar.html` directly from the filesystem — the whole report as one
file, markup, stylesheet, script and data, no server needed.

Week 3 is the week to start with. It carries the contradiction between the
board, the room and the tickets; the workstream that went quiet; and the finding
nobody in the room could see.

There is no model call at view time, no server component, no credentials, and no
request to any origin but the page's own.

---

## What it does

**Six functions, and everything else is backlog.**

1. **Three sources, none privileged.** A speaker-labelled transcript with
   timestamps and per-workstream airtime, a ticket export, and the reported RAG
   board.
2. **Classify before scoring.** Every finding is typed as a risk, an issue, a
   dependency or an assurance gap against explicit tests. Type decides the
   scale, so an issue is never scored on probability.
3. **Two axes, never blended.** Risks get exposure, impact × likelihood. Every
   item gets an attention index from proximity, blast radius, control status and
   evidence confidence. Attention orders items inside an exposure band; it never
   inflates one.
4. **Cite and corroborate.** Every item carries at least one typed source. Where
   sources conflict, the conflict is stated, all sources are cited, and it is
   routed to whoever owns the reporting. Conflict raises attention rather than
   discounting the item.
5. **Track movement.** Each item is new, worsening, stable, improving, resolved,
   returned or reclassified, against the previous accepted register.
6. **Issue as a draft.** Accept, amend or reject per item. Decisions carry into
   the next run, so adjudicated items are not re-litigated.

**Three detections need nobody to have said anything.** Staleness, scope growth,
and progress claimed with no ticket transition. These run over the export alone.
The strongest finding in the demo data is one of them: reporting's intake
outgrowing its closures for three consecutive weeks, which no single person in
the room could see, and which the workstream lead denied in the same meeting it
was raised.

---

## Layout

```
docs/                       the PRD and the design plan this was built from
data/
  transcripts/week-1..4.json  four meetings, role-labelled, with airtime
  tickets.csv                 68-row export, snapshot as at week 4
  board.json                  reported RAG per workstream per week
prompts/
  1-extract-classify.md       pass 1: find it, type it, cite it. No scores.
  2-score.md                  pass 2: score each factor against an anchor. No totals.
runs/
  week-1..4-register.json     the committed run output, one per week
schema/register.schema.json   the output contract
validate.py                   schema plus the invariants schema cannot express
score.py                      both totals, the ordering and the movement
tools/
  corpus_stats.py             derives the coverage numbers and the three detections
  build_bundle.py             data.bundle.js and the single-file build
  check_report.py             the P3 browser checks
index.html styles.css app.js  the report
risk-radar.html               the report as one file (generated)
data.bundle.js                the data inlined for file:// (generated)
verify.sh                     every "done when" check in the roadmap
```

---

## Verify it

```sh
./verify.sh              # everything
./verify.sh --no-ui      # P1 and P2 only, no browser needed
```

`verify.sh` runs each roadmap criterion in order and fails on the first one that
does not hold. No dependency is required for P1 and P2 — `validate.py` carries
its own draft-07 subset validator and cross-checks against the `jsonschema`
package when that happens to be installed. The P3 checks need `playwright`.

The individual pieces:

```sh
python3 tools/corpus_stats.py     # per-week coverage and detections, derived from data/
python3 score.py                  # recompute totals, ordering and movement
python3 score.py --check          # fail if a committed file differs from the recomputation
python3 validate.py               # ING-07: all four weeks, exits 0
python3 tools/build_bundle.py     # regenerate data.bundle.js and risk-radar.html
python3 tools/check_report.py     # RPT-02..09, NFR-01, NFR-03, NFR-04
```

The report checks assert the design plan's own list: every group heading prints
its scale, every row states its five facts as words with all disclosures closed,
one item walks end to end from quote-in-context to precedence and routing, both
totals recompute from the printed factors, assurance gaps lead every week, and
at 320px and 390px in both colour schemes nothing overflows, nothing is clipped
and every text pair clears WCAG AA. Greyscaling the page is a check, not a
review note: type, band, movement, conflict and acceptance all still read.

---

## How the two passes work

**Pass 1 — extract and classify.** Reads the three sources and the previous
accepted register. Finds every item the records support, types it against the
classification tests, attaches typed sources, flags contradictions, and marks
hedged claims against a fixed lexical list. Emits no number that is a score.

**Pass 2 — score.** Takes pass 1's output and scores each factor against the
written anchors in PRD section 5, recording the anchor sentence it scored
against. Emits no total, no band, no ordering, no movement.

**`score.py`.** Multiplies impact by likelihood, weights the four attention
factors, assigns the band, computes movement against the previous week, and
sorts. This split is the point: a model judges a factor against a written anchor
well and does consistent weighted arithmetic badly. Keeping the arithmetic in
code is what makes the ranking reproducible — three runs of the same week return
the same top five in the same order, and `score.py --check` fails if a committed
file has drifted from its own factor scores.

The fixtures in `runs/` were produced by executing the two prompt files against
the corpus offline, and are committed as-is. There is no model call at runtime,
so there is no key to expose and what the report displays is genuine run output.

---

## What is demonstrated, and what is only asserted

**Demonstrated.** The classification tests on real ambiguity, including one item
that changes type mid-window and two that are held out and later return. Both
scoring axes and the ordering they produce. Typed evidence, including findings
the export alone can see and contradictions between all three sources. Absence
measured rather than filled in — and the rule biting, where a risk is withheld
because it belongs to a workstream nobody can see. The adjudication loop, in
session.

**Asserted, with a described design but no implementation.** The upstream
pipeline from recording to labelled transcript. Connectors to a real ticket
system and a real board. Glossary normalisation for transcription error.
Persistence of the accepted register between runs. Retention, redaction and
consent policy for recorded meetings.

The line is deliberate. Everything in the first list is cheap to build and hard
to fake. Everything in the second is expensive to build and easy to describe.

---

## Interpretation notes

Four places where the PRD needed a decision, recorded so they can be argued
with rather than discovered.

**CLS-02 against SCO-02.** CLS-02 forbids emitting likelihood, exposure or
proximity for anything other than a risk. SCO-02 requires an attention
composite, which includes a proximity factor, for every type. These are read as
governing different things: the item-level `likelihood`, `exposure` and
`proximity` fields are risk-only and the schema rejects them elsewhere;
`attention_factors.proximity` is a scoring input that exists on every type. The
report follows the design plan and prints a proximity line only on risks; on
other types the factor appears in the arithmetic panel, labelled as an attention
factor.

**Movement for assurance gaps.** The movement rules define worsening in terms of
exposure, impact or criticality, and an assurance gap has none of those. Ageing
explicitly never produces movement, so weeks-absent cannot be the measure
either. A gap's measure is therefore what it leaves unverifiable — carried
items that cannot be checked plus downstream dependencies left unconfirmed —
which is the thing that actually deteriorates. On the row, the week count is
printed instead of the raw delta, because "2nd week absent" is legible and
"1 → 3" is not.

**Two thresholds are asserted, not derived.** Staleness fires above 10 days.
Scope growth needs the excess to be three or more tickets in each of two
consecutive weeks. Applied literally with no materiality floor, scope growth
fires on five of six workstreams in week 4 on an excess of a single ticket,
which is noise at this data volume. Both thresholds are constants in
`tools/corpus_stats.py`, both are stated in the prompt, and every firing below
the floor is recorded in that week's gaps list rather than silently dropped.
Four weeks of synthetic data cannot calibrate either.

**Ticket transitions from a single snapshot.** `tickets.csv` is one export with
one `status_changed_date` per row, as ING-03 specifies. A transition is
therefore counted in the week that date falls in, which means a ticket that
moved twice in the window is only seen once. A real deployment reads a
transition history; the derivation rules are written out at the top of
`tools/corpus_stats.py`.

**Typefaces.** The design plan specifies Spectral, IBM Plex Sans and IBM Plex
Mono. Loading them would mean a request to another origin, which NFR-05
forbids, so the three roles — serif for prose, sans for labels, mono with
tabular figures for every number — are held by system stacks instead.

---

## Data

All content is self-created. No real organisation, client, colleague or project
appears anywhere in this repository. Speakers are role labels: delivery manager,
platform lead, integration lead, data migration lead, reporting lead, test lead,
adoption lead, programme architect. The programme, its six workstreams, the
sixty-eight tickets and the four meetings are invented.
