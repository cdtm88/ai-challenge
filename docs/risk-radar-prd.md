# Risk Radar - Portable PRD

A delivery risk tool that reads the weekly delivery meeting transcript alongside the ticket export and the reported RAG board, classifies what it finds, and returns a draft register where every item cites its evidence.

Framework target: portable only. Stage: greenfield prototype.

---

## 1. What it is

Delivery managers maintain registers by hand, from memory, after the meeting. The register drifts from what is actually happening, and the drift is invisible until something lands.

Risk Radar reads the three records that already exist: what was said in the room, what moved in the tickets, and what was reported upward. It classifies each finding as a risk, an issue, a dependency or an assurance gap, scores it on the scale appropriate to its type, and cites the source. Where the three records disagree, it says so.

The output is a draft. The delivery manager accepts, amends or rejects each item, and those decisions carry into the next run.

**Primary user:** a delivery manager running three to six concurrent workstreams, chairing a weekly review, maintaining a register they have to defend at a steering group.

**Core value:** the register stops being a memory exercise and becomes an evidence trail, and the gaps between the three records become visible.

---

## 2. Key functions

Six. Everything else is backlog.

**F1 - Ingest three sources.** A speaker-labelled meeting transcript with timestamps, a ticket export, and the reported RAG status per workstream. No source is privileged over another.

**F2 - Classify before scoring.** Every finding is typed as risk, issue, dependency or assurance gap against explicit tests. Type determines the scale, so an issue is never scored on probability. A dependency where work cannot proceed is additionally marked blocking.

**F3 - Score on two axes.** Risks get exposure, impact multiplied by likelihood. Every item gets an attention index built from proximity, blast radius, control status and evidence confidence. Attention orders items within an exposure band and never inflates exposure.

**F4 - Cite and corroborate.** Every item carries at least one typed source. Where two or more sources cover the same item, agreement or conflict is stated explicitly, and conflict raises attention rather than lowering the item.

**F5 - Track movement.** Each item is new, worsening, stable, improving, resolved, returned or reclassified, computed against the previous accepted register.

**F6 - Issue as a draft.** Nothing is accepted until a human accepts it. Acceptance state carries forward so adjudicated items are not re-litigated.

---

## 3. Use cases

**UC1 - Monday prep.** The delivery manager has forty minutes before a steering group. They read the highest-exposure risks with the evidence each came from, and walk in able to answer "how do you know?" for every line.

**UC2 - The workstream that went quiet.** A workstream misses the meeting and its tickets stop moving. Rather than carrying last week's status forward, the register raises an assurance gap ahead of the risks: not green, unknown, with the coverage numbers that prove it.

**UC3 - Correcting the board before it misleads.** The board reports a workstream green; the lead says otherwise on the call and the blocking ticket has not moved in three weeks. The contradiction is raised with all three sources and routed to whoever owns the reporting.

**UC4 - Finding what nobody said.** Open tickets in one workstream outgrow closures for two consecutive weeks. It never came up in a meeting because no single person could see it. The export alone raises it.

---

## 4. Scope

### In scope
- Ingest of transcript, ticket export and RAG board for a four-week window.
- Two prompt passes: extract and classify, then score.
- The four item types, the blocking flag, the two scoring axes, typed source citation.
- Movement and reclassification against the previous run.
- Three ticket-only detections: staleness, scope growth, and progress claimed with no transition.
- A report over the committed runs, with acceptance controls.

### Out of scope, backlog
- Recording, transcription and speaker diarisation. Transcripts arrive labelled.
- Live model calls at runtime. Outputs are generated offline and committed.
- Connectors of any kind. The pipeline is described, not integrated.
- Generated mitigations and generated owners. Stated ones are captured; invented ones are banned.
- Glossary normalisation of transcription variants. Needed in production, not in a prototype with clean input.
- Blocked-by chain tracing beyond depth 1, reopened-ticket rework signals, dependency graph visualisation.
- Opportunities and upside risk.
- Authentication, persistence beyond the session, multi-user, notification.

---

## 5. Scoring anchors

Every scale is defined here so that scoring is reproducible and arguable. The model scores against these words; it never computes a total.

### Impact, 1 to 5. Risks and issues.

| Score | Anchor |
|---|---|
| 1 | Absorbed within the workstream. No schedule effect. |
| 2 | A task or ticket slips. Recoverable inside the sprint. |
| 3 | A milestone moves, or another workstream has to replan. |
| 4 | The release date is at risk. |
| 5 | The release moves, or a commitment made outside the programme is broken. |

### Likelihood, 1 to 5. Risks only.

| Score | Anchor |
|---|---|
| 1 | Hypothetical. Raised as a concern with no supporting signal. |
| 2 | Possible but unlikely on current evidence. |
| 3 | Evens. Could reasonably go either way. |
| 4 | More likely than not. |
| 5 | Already happening, or certain on current evidence. Consider whether this is now an issue. |

### Proximity, 0 to 5. All types.

| Score | Anchor |
|---|---|
| 5 | Within 2 weeks. |
| 4 | Within 4 weeks. |
| 3 | Within 6 weeks. |
| 2 | Within 3 months. |
| 1 | Within 6 months. |
| 0 | Beyond 6 months, or no timeframe stated. Unknown scores 0 and is recorded in gaps. |

### Blast radius, 0 to 5. All types.

| Score | Anchor |
|---|---|
| 0 | Contained within one workstream. |
| 3 | One other workstream is affected. |
| 5 | Programme-wide, or affects a party outside the programme. |

### Control status, 0 to 5. All types.

| Score | Anchor |
|---|---|
| 0 | Mitigation stated, owned, with a date. |
| 2 | Mitigation stated and owned, no date. |
| 4 | Mitigation mentioned but unowned, or an action stated with no substance. |
| 5 | Nothing stated and no owner. |

### Evidence confidence, 0 to 5. All types. Only three values are used.

| Score | Anchor |
|---|---|
| 1 | Two or more source types cover this and they disagree. |
| 2 | Two or more source types cover this and they agree. |
| 5 | A single source, uncorroborated. |

Higher values mean less certainty, so they raise attention. An unverified claim needs checking, not discounting.

### Criticality, 1 to 5. Dependencies only.

| Score | Anchor |
|---|---|
| 1 | Desirable. Work continues without it. |
| 3 | A milestone depends on it. |
| 5 | The release depends on it and there is no alternative path. |

### Coverage. Assurance gaps only. Counts, not scores.

Airtime in minutes; ticket transitions in the period; count of carried-forward items that cannot be verified; count of downstream dependencies left unconfirmed.

### Hedge terms

Exactly this list, matched case-insensitively on the claim text: assuming, should be, hopefully, likely, I think, probably, if X then, in theory, realistically, we expect, all being well, more or less, ought to.

### Movement rules

Evaluated in this order; the first match wins.

| Movement | Rule |
|---|---|
| Reclassified | The item's type changed this week. |
| Resolved | Present in the previous register, and evidenced as closed this week. |
| Returned | Absent from the previous register, present in an earlier one. |
| New | Not present in any previous register. Every item in week 1 is new. |
| Worsening | Exposure increased (risks) or impact increased (issues, dependencies use criticality). |
| Improving | The same measure decreased. |
| Stable | The measure is unchanged. |

Changes in proximity, control status, evidence confidence or age never produce movement.

---

## 6. Requirements

### Ingest

| ID | Requirement | Phase |
|---|---|---|
| ING-01 | Four weekly meeting transcripts exist, each 20 to 30 speaker-labelled lines with timestamps, using role labels only. | P1 |
| ING-02 | Per-workstream airtime in seconds is recorded per meeting and sums to no more than the meeting duration. | P1 |
| ING-03 | A ticket export of at least 40 rows exists with: ticket_id, workstream, title, status, assignee_role, created_date, status_changed_date, due_date, blocked_by. | P1 |
| ING-04 | A board file records the reported RAG status per workstream per week. | P1 |
| ING-05 | The dataset includes one workstream absent for two consecutive weeks, one workstream with under 1 minute of airtime and no specifics, one finding evidenced only in the export, and one item that is a risk in an early week and an issue in a later one. | P1 |
| ING-06 | A JSON schema defines the output contract. Every item requires id, type, title, workstream, owner, sources, movement, acceptance. Risks additionally require impact, likelihood, proximity, control. Dependencies require counterparty, week started and a blocking boolean. | P1 |
| ING-07 | A validator run against all four week outputs exits 0. | P1 |

### Classify and score

| ID | Requirement | Phase |
|---|---|---|
| CLS-01 | Every item is classified as exactly one of risk, issue, dependency or assurance gap: risk is uncertain and future; issue has already occurred or is certain; dependency is contingent on a party outside the workstream; assurance gap means the control that would reveal state has failed. | P2 |
| CLS-02 | Likelihood, exposure and proximity are not emitted for anything other than a risk. Emitting them is a schema validation failure. | P2 |
| CLS-03 | A dependency is marked blocking when a source states that work cannot proceed without it, or when a ticket in the waiting workstream carries a blocked_by reference to the counterparty. | P2 |
| CLS-04 | An item may change type between weeks. The reclassification, the week and the trigger are recorded. | P2 |
| CLS-05 | A workstream with under 2 minutes of airtime, or zero ticket transitions in the week, produces an assurance gap reporting coverage, not a scored risk. No workstream name appears in the prompt. | P2 |
| SCO-01 | Exposure is impact multiplied by likelihood against the anchors in section 5, yielding 1 to 25. Bands: 15 to 25 critical, 10 to 14 high, 5 to 9 medium, 1 to 4 low. | P2 |
| SCO-02 | Attention is a weighted composite of proximity 0.35, blast radius 0.25, control status 0.25 and evidence confidence 0.15, each scored against the anchors in section 5, yielding 0 to 5. It applies to every type. | P2 |
| SCO-03 | The model emits factor scores only. Both totals are computed in code, and the inputs to each total are retained in the output so the arithmetic can be reproduced. | P2 |
| SCO-04 | Register order is exposure band descending, then attention descending. Attention never modifies exposure. | P2 |
| SCO-05 | Movement follows the rules in section 5. | P2 |
| SCO-06 | Every item has an owner by role, defaulting to whoever raised it, or is marked unowned. Owners are never invented. | P2 |
| SCO-07 | Stated mitigations are captured with owner and date where given. Mitigations are never generated. | P2 |
| SCO-08 | A claim whose only supporting evidence carries a hedge term from the list in section 5 cannot exceed likelihood 3. | P2 |
| SCO-09 | Running the same week three times produces the same top 5 items in the same order. | P2 |

### Evidence

| ID | Requirement | Phase |
|---|---|---|
| EVI-01 | Every item carries at least one typed source: transcript (week, line, speaker, verbatim quote), ticket (id, field, value, observation), board (workstream, status, date), or metadata (run-level observation). An item with no source is dropped, not softened. | P2 |
| EVI-02 | Evidence confidence is scored against the anchor in section 5, from the number of source types covering the item and whether they agree. | P2 |
| EVI-03 | A contradiction is emitted where sources conflict, citing all of them. Precedence is ticket export, then spoken claim, then board status. Each contradiction is routed to delivery or to whoever owns reporting. | P2 |
| EVI-04 | Three detections run over the export alone and require no spoken mention: no status transition in more than 10 days by workstream; open count exceeding closures for two consecutive weeks; and progress claimed in the meeting with zero transitions that week. | P2 |
| EVI-05 | Anything untraceable to a source is omitted and listed in gaps with a reason. An item not evidenced this week is held out of the register and named in gaps, never carried forward on last week's quote. | P2 |

### Report

Outcome requirements. How these are laid out, styled and interacted with is a design decision, not a specification.

| ID | Requirement | Phase |
|---|---|---|
| RPT-01 | The report runs entirely from the committed run outputs, with no model call, no server component and no credentials at view time. | P3 |
| RPT-02 | Any of the four weeks can be viewed, and moving between them is a single action. | P3 |
| RPT-03 | Items are grouped by type, and each group states the scale it is scored on, so a reader is never comparing an issue to a risk on one number. | P3 |
| RPT-04 | A reader can determine, without opening an item: its score and band, its workstream, whether anything is being done about it, whether it changed this week, and whether its sources conflict. | P3 |
| RPT-05 | A reader can reach the full evidence for any item, including enough surrounding context to judge a transcript quote in situ, and the field-level detail behind a ticket observation. | P3 |
| RPT-06 | The arithmetic behind exposure and attention is reachable for any item. | P3 |
| RPT-07 | Every item can be accepted, amended or rejected, and its current state is legible. | P3 |
| RPT-08 | Airtime coverage and the unverified list are available for every week. | P3 |
| RPT-09 | Assurance gaps are given more prominence than risks, because a workstream that is not reporting has not reported green. | P3 |

### Non-functional

| ID | Requirement | Phase |
|---|---|---|
| NFR-01 | The report loads and becomes usable on a mobile connection without a perceptible wait. | P3 |
| NFR-02 | A single week's two-pass run completes within 90 seconds on a 4,000-word transcript plus a 40-row export. | P2 |
| NFR-03 | The report is usable at a phone-width viewport in both light and dark colour schemes: no horizontal overflow, no clipped content, and text meeting WCAG AA contrast. | P3 |
| NFR-04 | Type, band, movement, contradiction and acceptance state are each conveyed by text as well as colour. | P3 |
| NFR-05 | No keys, tokens or secrets in the repository, and no server-side component. | P3 |
| NFR-06 | All content is self-created. No real organisation, client, colleague or project identifier appears. Speakers are role labels. | P1 |

---

## 7. Technical decisions

| ID | Decision | Rationale |
|---|---|---|
| D-01 | No framework and no build step. | Zero build risk and the whole artifact is readable in one place. Visual design is unconstrained by this. |
| D-02 | Static hosting. | No infrastructure, no cost, no runtime failure mode. |
| D-03 | No model call at runtime. Outputs generated offline and committed as fixtures, saved unedited. | No key to expose, and what is displayed is genuine model output. |
| D-04 | Two passes: extract and classify, then score. | Gives one inspectable intermediate. When the register is wrong you can see which stage caused it. |
| D-05 | Classification precedes scoring. | Type determines the scale; scoring first forces every item onto the wrong one. |
| D-06 | Exposure and attention are two numbers, never blended. | A blended score lets a trivial risk climb the register by ageing. |
| D-07 | Arithmetic computed in code from model-emitted factor scores. | The model judges a factor against an anchor well and does consistent weighted arithmetic badly. This is what makes SCO-09 achievable. |
| D-08 | Evidence is a typed source array with no source privileged at extraction. | The gap between sources is the highest-value finding; privileging one destroys it. |
| D-09 | Hedge detection is a fixed lexical list, not sentiment analysis. | Reproducible and explainable. Sentiment scores are neither. |
| D-10 | Output is a draft pending human acceptance. | A tool that overrules the reporting line without asking gets switched off. |
| D-11 | Acceptance carry-forward is exercised by generating each week's fixture with the previous week's accepted register as input. In the report itself, acceptance is session-scoped. | Demonstrates the loop without building persistence the prototype does not need. |

---

## 8. Roadmap

Three phases. Named artefacts, so there is no ambiguity about what "done" produces.

### P1 - dataset-and-contract
- **Goal:** Build the four-week corpus and lock the output schema.
- **Requirements:** ING-01 to ING-07, NFR-06
- **Produces:** `transcripts/week-1..4.json`, `tickets.csv`, `board.json`, `schema/register.schema.json`, `validate.py`
- **Done when:** all five artefacts are committed and the validator exits 0 against four hand-written sample outputs.

### P2 - prompts-and-scoring
- **Goal:** Two prompts that turn the three sources into a typed, scored, cited register.
- **Requirements:** CLS-01 to CLS-05, SCO-01 to SCO-09, EVI-01 to EVI-05, NFR-02
- **Produces:** `prompts/1-extract-classify.md`, `prompts/2-score.md`, `runs/week-1..4-claims.json`, `runs/week-1..4-register.json`, `score.py` for the two totals and the ordering
- **Done when:** all four weeks validate; the absent workstream is an assurance gap rather than a scored risk; at least one item reclassifies from risk to issue; at least one item is evidenced only in the export; at least one dependency is marked blocking; at least one contradiction is raised with all sources; and three repeat runs of one week return an identical top 5.

### P3 - report
- **Goal:** A report over the committed runs that satisfies the outcome requirements.
- **Requirements:** RPT-01 to RPT-09, NFR-01, NFR-03, NFR-04, NFR-05
- **Produces:** the report and its committed run data
- **Done when:** all four weeks are viewable offline; RPT-04 and RPT-05 are demonstrably satisfied by walking one item end to end; and the phone-width check in NFR-03 passes in both colour schemes.

---

## 9. What the prototype demonstrates, and what it only asserts

Stated explicitly so the build does not drift into production scope.

**Demonstrated.** The classification tests on real ambiguity, including one item that changes type. The two scoring axes and the ordering they produce. Typed evidence, including one finding the export alone can see and one contradiction between sources. Absence measured rather than assumed. The acceptance loop, in session.

**Asserted, with a described design but no implementation.** The upstream pipeline from recording to labelled transcript. Connectors to a real ticket system and a real board. Glossary normalisation for transcription error. Persistence of the accepted register between runs. Retention, redaction and consent policy for recorded meetings.

The line between the two is deliberate. Everything in the first list is cheap to build and hard to fake. Everything in the second is expensive to build and easy to describe.

---

## 10. Constraints and risks

> **WARNING:** This is a prototype, not a product. The timebox is a single sitting and the scope above is set to fit it. If it slips, P1 and P2 alone are complete and defensible: the dataset, the two prompts and the scoring model are the thinking. Cut the report before cutting classification.

- **Budget:** zero. Guaranteed by D-02 and D-03.
- **Team:** one person directing, all code written by an AI coding agent from this document. Requirements are written as verifiable outcomes rather than implementation notes.
- **Design ownership:** section 6 states what the report must let a reader do, not how it should look. Layout, hierarchy, typography and interaction are the designer's.
- **Known unknown, technical:** whether classification stays stable when an item is described differently each week. Mitigated by passing the previous accepted register, so matching runs against structured prior ids rather than raw prose.
- **Known unknown, calibration:** the 10-day staleness threshold in EVI-04 is asserted, not derived. Four weeks of synthetic data cannot calibrate it. Treat as a configurable assumption.
- **Known unknown, adoption:** a tool that disagrees with the reported board is politically loaded. D-10 is the mitigation and it is not optional.

> **ISSUE:** SCO-09 is the requirement most likely to fail on first attempt. If rank order is unstable, tighten the wording of the anchors in section 5 rather than weakening the criterion, and confirm both totals are being computed in code.

---

## 11. Assumptions

- One weekly delivery review per programme, rather than daily standups.
- Transcripts arrive with speaker labels attached; diarisation is upstream.
- Speakers are identified by role, not name, in both the prototype and the production design.
- The RAG board is available as structured data. In a real deployment it may need extracting from a slide or wiki table, which is a connector problem rather than a design one.
- Input transcripts are clean enough not to need glossary normalisation. This assumption does not survive contact with real transcription and is the first backlog item to promote.
- Four weeks is enough to demonstrate movement and reclassification. It is not enough to calibrate any threshold.

---

Hand this file to the coding agent and start at P1.
