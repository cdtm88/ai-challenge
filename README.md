# Risk Radar

A delivery risk tool that reads the weekly delivery meeting transcript alongside
the ticket export and the reported RAG board, classifies what it finds, and
returns a draft register where every item cites its evidence.

---

## Why it exists

Delivery managers maintain risk registers by hand, from memory, after the
meeting. The register drifts from what is actually happening, and the drift is
invisible until something lands.

Three records of the same week already exist: what was said in the room, what
moved in the tickets, and what was reported upward. Risk Radar reads all three,
treats none of them as the truth, and makes the gaps between them the finding.
A workstream that stops reporting is measured rather than assumed green. A board
that says green while the lead says otherwise and the blocking ticket hasn't
moved in three weeks gets contradicted, with all three sources cited and the
contradiction routed to whoever owns the reporting.

The output is a draft. The delivery manager accepts, amends or rejects each
item, and those decisions carry into the next run — because a tool that
overrules the reporting line without asking gets switched off in a fortnight.

**Who it's for:** a delivery manager running three to six concurrent
workstreams, chairing a weekly review, maintaining a register they have to
defend at a steering group.

---

## How it works

**Three sources in, none privileged.** A speaker-labelled transcript with
timestamps and per-workstream airtime, a ticket export, and the reported RAG
status per workstream per week.

**Classify before scoring.** Every finding is typed as a risk, an issue, a
dependency or an assurance gap. Type decides the scale, so an issue is never
scored on probability — once something has happened there is no likelihood left
in it. A dependency where work cannot proceed is additionally marked blocking.

**Two numbers, never blended.** Risks get exposure — impact times likelihood.
Every item gets an attention index built from proximity, blast radius, control
status and evidence confidence. Attention orders items inside an exposure band;
it never inflates one, because a blended score lets a trivial risk climb the
register by ageing.

**Evidence, typed.** Every item carries at least one source: a transcript line
with speaker and timestamp, a ticket field with an observation, a board status,
or a run-level measurement. No source, no item — anything untraceable goes to a
gaps list with a reason rather than being softened into the register. An item
not evidenced this week is held out and named, never carried forward on last
week's quote.

**Three findings need nobody to have spoken.** Staleness, scope growth, and
progress claimed with no ticket transition all run over the export alone. The
strongest finding in the demo data is one of them: reporting's intake outgrowing
its closures for three consecutive weeks. No single person in the room could see
it, and the workstream lead denied it in the same meeting it surfaced.

**Movement.** Each item is new, worsening, stable, improving, resolved, returned
or reclassified, computed against the previous accepted register — so the tool
watches change rather than taking a snapshot.

### The two passes, and why the model doesn't do arithmetic

Pass one finds each item, types it, and attaches its sources. It emits no
number that is a score.

Pass two scores each factor against a written anchor, and records the anchor
sentence it scored against so a reader can argue with the judgement rather than
the total. It emits no total, no band, no ordering.

`score.py` then multiplies, weights, bands, sorts, and computes movement.

The split is the whole design. A model judges a factor against a written anchor
well and does consistent weighted arithmetic badly, and arithmetic is where
confident-sounding wrongness usually enters. Keeping it in code is what makes
the ranking reproducible: the same week ranks the same way every time, and
`score.py --check` fails if a committed register has drifted from its own factor
scores.

---

## Built with

**Python 3, standard library only.** The pipeline — corpus statistics, scoring,
validation — has no third-party dependency. `validate.py` carries a small
JSON Schema draft-07 subset validator so a fresh clone can check the output
contract with nothing installed; where the `jsonschema` package happens to be
present it is used as a cross-check and any disagreement between the two is
itself reported as a failure.

**Vanilla HTML, CSS and JavaScript for the report.** No framework, no build
step, no bundler, no transpiler. One page, one stylesheet, one script, and the
run data as committed JSON. The whole artifact is readable in one place and
there is no build to break.

**No model call at view time.** Outputs are generated offline and committed as
fixtures, so there is no key to expose, no server component, no credentials, and
no request to any origin but the page's own. It works from a static host or from
a bare filesystem.

**Playwright** drives the browser checks, and is the only dependency anywhere in
the repository. It is needed to check the report, not to run it.

---

## Reading the report

```sh
python3 -m http.server 8765
# http://127.0.0.1:8765/index.html#week-3
```

Or open `risk-radar.html` straight from the filesystem — the whole report in one
file, markup, stylesheet, script and data, no server required.

Start on week 3. It carries the contradiction between the board, the room and
the tickets; the workstream that went quiet; the finding nobody in the room
could see; and the rule that withholds a scored risk from a workstream whose
state cannot be verified.

The page is a single column meant to be read at a glance, not a table to be
studied. It runs: header, then the two source slots, then — when it applies —
one alert line, then five sections, then three working notes, then a short
footer.

**The alert line** appears only when a workstream fell under the two-minute
airtime floor or recorded no ticket movement. It says how many of the roster
did not report, which ones, and that their state is unknown rather than green.
It sits above the register because it is the first thing a delivery manager
needs, and burying it in a section would be the same mistake the tool exists
to catch.

**Sections** run in fixed order — assurance gaps, risks, issues, dependencies,
closed — each with its scale stated beside the heading, so a reader is never
carrying a number across a boundary. An empty section says so in one line
rather than disappearing.

**A row** is three things and is meant to be legible in under a second:

- the number that decides its place, with the word for the scale it sits on:
  the band for a risk, `Impact` for an issue, `Criticality` for a dependency,
  and `Unknown` for an assurance gap, which has no score and does not borrow
  one;
- the title;
- one grey line: the workstream, then only what is true and worth acting on —
  movement, and nothing at all when the item is stable; `Sources conflict`;
  `Unmanaged` or `No owner`; `From tickets only` where the export alone raised
  it. A row with nothing wrong shows the workstream alone.

Colour is spent on the number and on those two or three words, and nowhere
else. Red for critical and for conflict, amber for high and for a management
gap, green for low and for closed. Every one of them is a word first, so the
page survives being read in greyscale.

**Everything else is one action away.** Each row's disclosure carries, in
order: any reclassification, any contradiction with the source that takes
precedence and who it is routed to, the statement, the evidence — the primary
source in full, a quote with its speaker and timestamp and two lines either
side, or the ticket record field by field, then one compact `Also:` line for
the remaining sources — the assessment as a small definition list, and finally
Accept, Amend and Reject with the current state beside them.

Coverage by workstream, the omitted list and an explanation of the scoring sit
in three collapsed notes at the foot.

Four weeks switch in one action and are linkable by URL hash. Acceptance is per
item, lasts the browser session, and survives a refresh.

---

## Adding sources

Above the register there are two slots: the ticket export and the meeting
transcript. Drop a Jira CSV and a transcript — JSON, VTT, or speaker-labelled
text — and the page reads both **in the browser**. Nothing is uploaded, no
request leaves the origin, and there is no server to receive one.

What it does with them is what can be done honestly without a model:

**Checks them against the input contract.** The export has to carry all nine
columns; a short one is refused by name — *missing required columns:
workstream, created\_date…* — and cannot prepare a run. The transcript is
counted, its format named, and its per-workstream airtime totalled against the
meeting length, because coverage cannot be measured without it.

**Runs the three model-free detections.** Staleness, scope growth, and airtime
under the floor are arithmetic over the export and the airtime table, so they
run here in full. The window is taken from the transcript's own date. This is
the same arithmetic as `tools/corpus_stats.py`, written twice — once in Python
for the pipeline, once in JavaScript for the page — and
`tools/check_report.py` loads the real corpus into the browser and fails if the
two implementations disagree on a single workstream.

**Stops where a model would be needed.** Classification, scoring against the
anchors and evidence selection are the two prompt passes, and there is no model
at view time — no key, no server, no call. So the page says so, and offers the
prepared run input as a download instead: the parsed transcript, the parsed
tickets and the derived statistics in one JSON file, ready for
`prompts/1-extract-classify.md`.

The register below is unaffected by any of this. It is the committed output of
four runs that already happened.

---

## Layout

```
docs/                          the PRD and design plan this was built from
data/
  transcripts/week-1..4.json     four meetings, role-labelled, with airtime
  tickets.csv                    68-row export, snapshot as at week 4
  board.json                     reported RAG per workstream per week
prompts/
  1-extract-classify.md          pass 1: find it, type it, cite it
  2-score.md                     pass 2: score each factor against an anchor
runs/week-1..4-register.json   the committed run output, one per week
schema/register.schema.json    the output contract
score.py                       both totals, the ordering, the movement
validate.py                    schema, plus the invariants schema can't express
tools/
  corpus_stats.py                coverage numbers and export detections
  build_bundle.py                the inlined data and single-file build
  check_report.py                the browser checks
index.html styles.css app.js   the report
risk-radar.html                the report as one file (generated)
data.bundle.js                 the data inlined for file:// (generated)
verify.sh                      runs everything
```

Commands:

```sh
./verify.sh                    # everything
./verify.sh --no-ui            # pipeline only, no browser needed
python3 tools/corpus_stats.py  # per-week coverage and detections, from data/
python3 score.py               # recompute totals, ordering and movement
python3 validate.py            # validate all four weeks
python3 tools/build_bundle.py  # regenerate the inlined data and single-file build
python3 tools/check_report.py  # drive a browser through the report
```

The browser checks cover both colour schemes at phone and desktop widths, and
include a greyscale pass — type, band, movement, conflict and acceptance all
have to survive without colour, since that is what makes them readable rather
than decorative.

---

## Design decisions worth knowing

**Two thresholds are asserted, not derived.** Staleness fires above 10 days.
Scope growth needs an excess of three or more tickets in each of two consecutive
weeks. Without that second floor, scope growth fires on five of six workstreams
on an excess of a single ticket, which is noise at this data volume. Both are
constants in `tools/corpus_stats.py`, both are stated in the prompts, and every
firing below the floor is recorded in that week's gaps list rather than silently
dropped. Four weeks of data cannot calibrate either.

**Ticket transitions come from a single snapshot.** The export carries one
`status_changed_date` per row, so a transition is counted in the week that date
falls in — meaning a ticket that moved twice in a week is seen once. A real
deployment reads a transition history. The derivation rules are written out at
the top of `tools/corpus_stats.py`.

**Hedge detection is a fixed lexical list**, not sentiment analysis:
*assuming, should be, hopefully, likely, I think, probably, if X then, in
theory, realistically, we expect, all being well, more or less, ought to*. A
claim whose only support carries one of these cannot exceed likelihood 3. A
fixed list is reproducible and explainable; a sentiment score is neither.

**Owners and mitigations are captured, never generated.** Stated ones are
recorded with their owner and date. Where nothing was stated, the control is
nothing stated. Nobody's name is invented and no mitigation is written on
someone's behalf.

**Typefaces are system stacks.** The design plan specifies Spectral, IBM Plex
Sans and IBM Plex Mono. Loading them would mean a request to another origin, so
the three roles — serif for prose, sans for labels, mono with tabular figures
for every number — are held by system stacks instead.

---

## Scope

This is a prototype, not a product.

**Built and demonstrated.** The classification tests on real ambiguity,
including an item that changes type mid-window and items held out and later
returning. Both scoring axes and the ordering they produce. Typed evidence,
including findings the export alone can see and contradictions across all three
sources. Absence measured rather than filled in. The adjudication loop, in
session. Source intake, in the browser: the input contract enforced on a real
export and the three model-free detections run over it.

**Described but not implemented.** The upstream pipeline from recording to
labelled transcript. Connectors to a real ticket system and a real board.
Calling a model from the page — intake prepares the run input; the two passes
run offline.
Glossary normalisation for transcription error. Persistence of the accepted
register between runs. Retention, redaction and consent policy for recorded
meetings.

The line is deliberate: everything in the first list is cheap to build and hard
to fake, and everything in the second is expensive to build and easy to
describe.

---

## Data

All content is self-created. No real organisation, client, colleague or project
appears anywhere in this repository. Speakers are role labels — delivery
manager, platform lead, integration lead, data migration lead, reporting lead,
test lead, adoption lead, programme architect. The programme, its six
workstreams, the sixty-eight tickets and the four meetings are invented.
