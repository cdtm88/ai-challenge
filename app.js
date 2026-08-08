/* Risk Radar — the register, rendered from committed run data.
 *
 * No framework, no build step, no model call, no network request to any
 * origin but this one. The register's content is decided in runs/*.json;
 * this file decides only how it is laid out and what can be reached.
 *
 * JS is required to read the register but not to read the record: the four
 * files under runs/ are the complete output and are readable on their own.
 */
(function () {
  "use strict";

  var WEEKS = [1, 2, 3, 4];

  var GROUPS = [
    {
      type: "assurance-gap",
      name: "Assurance gaps",
      scale: "Scale: coverage counts — not scored",
      note: "Listed first because a workstream that has not reported has not reported green.",
      empty: "No assurance gaps this week: every workstream cleared the coverage floor."
    },
    {
      type: "risk",
      name: "Risks",
      scale: "Scale: exposure = impact × likelihood, 1–25",
      empty: "No risks evidenced this week."
    },
    {
      type: "issue",
      name: "Issues",
      scale: "Scale: impact 1–5 — no likelihood, it has occurred",
      empty: "No issues evidenced this week."
    },
    {
      type: "dependency",
      name: "Dependencies",
      scale: "Scale: criticality 1–5 — blocking listed first",
      empty: "No dependencies evidenced this week."
    }
  ];

  var TYPE_WORD = {
    "risk": "Risk",
    "issue": "Issue",
    "dependency": "Dependency",
    "assurance-gap": "Assurance gap"
  };

  var MOVE_WORD = {
    "new": "New",
    "worsening": "Worsening",
    "improving": "Improving",
    "stable": "Stable",
    "resolved": "Resolved",
    "returned": "Returned",
    "reclassified": "Reclassified"
  };

  var CRITICALITY_WORD = {
    1: "Desirable — work continues without it",
    2: "Between desirable and milestone-critical",
    3: "A milestone depends on it",
    4: "Between milestone and release-critical",
    5: "The release depends on it, no alternative path"
  };

  var SOURCE_ORDER = { ticket: 0, transcript: 1, board: 2, metadata: 3 };

  var WS_LABEL = {
    "platform": "Platform",
    "integration": "Integration",
    "data-migration": "Data migration",
    "reporting": "Reporting",
    "test": "Test",
    "adoption": "Adoption",
    "programme": "Programme"
  };

  var data = null;
  var currentWeek = 3;
  var acceptance = loadAcceptance();

  // ── small DOM helpers ────────────────────────────────────────────────

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else node.setAttribute(k, v === true ? "" : String(v));
      });
    }
    append(node, children);
    return node;
  }

  function append(node, children) {
    if (children === null || children === undefined) return node;
    if (!Array.isArray(children)) children = [children];
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  function wsLabel(key) {
    if (WS_LABEL[key]) return WS_LABEL[key];
    return key.replace(/-/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });
  }

  function mmss(seconds) {
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + "m " + (s < 10 ? "0" : "") + s + "s";
  }

  function daysBetween(fromISO, toISO) {
    var a = new Date(fromISO + "T00:00:00Z").getTime();
    var b = new Date(toISO + "T00:00:00Z").getTime();
    return Math.round((b - a) / 86400000);
  }

  // ── acceptance, session-scoped (D-11) ────────────────────────────────

  function loadAcceptance() {
    try {
      return JSON.parse(window.sessionStorage.getItem("risk-radar-acceptance") || "{}");
    } catch (e) {
      return {};
    }
  }

  function saveAcceptance() {
    try {
      window.sessionStorage.setItem("risk-radar-acceptance", JSON.stringify(acceptance));
    } catch (e) {
      /* private mode, or storage disabled. The session simply does not survive reload. */
    }
  }

  function acceptanceKey(week, item) { return week + ":" + item.id; }

  function acceptanceFor(week, item) {
    return acceptance[acceptanceKey(week, item)] || item.acceptance;
  }

  function setAcceptance(week, item, state, note) {
    acceptance[acceptanceKey(week, item)] = {
      state: state,
      by: "This session",
      at: null,
      note: note || null
    };
    saveAcceptance();
  }

  // ── chips (the complete vocabulary; five is the ceiling per row) ─────

  function chipsFor(item, acc) {
    var chips = [];

    chips.push(el("span", {
      class: "chip chip--type" + (item.type === "assurance-gap" ? " is-gap" : ""),
      text: TYPE_WORD[item.type]
    }));

    if (item.contradiction && item.contradiction.present) {
      chips.push(el("span", { class: "chip chip--alarm", text: "Sources conflict" }));
    }
    if (item.type === "dependency" && item.blocking) {
      chips.push(el("span", { class: "chip chip--alarm", text: "Blocking" }));
    }

    if (item.reclassified && item.movement.state === "reclassified") {
      chips.push(el("span", {
        class: "chip chip--reclass",
        text: "Reclassified W" + item.reclassified.week + " · was a " + item.reclassified.from_type +
              (item.reclassified.from_id ? ", " + item.reclassified.from_id : "")
      }));
    } else {
      chips.push(el("span", { class: "chip chip--move", text: movementText(item) }));
    }

    var note = noteChipText(item);
    if (note && chips.length < 5) chips.push(el("span", { class: "chip chip--note", text: note }));

    return chips.slice(0, 5);
  }

  function movementText(item) {
    var m = item.movement;
    var word = MOVE_WORD[m.state];

    /* An assurance gap has no score, so its measure is how much it leaves
       unverifiable — a number that means nothing on a chip. Where the gap is
       an absence, the week count is the legible fact; otherwise say what the
       measure is rather than printing a bare delta. */
    if (item.type === "assurance-gap") {
      if (item.coverage && item.coverage.weeks_absent) {
        return word + " · " + ordinal(item.coverage.weeks_absent) + " week absent";
      }
      if ((m.state === "worsening" || m.state === "improving") && m.from !== null) {
        return word + " · unverifiable " + m.from + " → " + m.to;
      }
      return word;
    }

    if (m.state === "worsening" || m.state === "improving") {
      if (m.from !== null && m.to !== null) return word + " " + m.from + " → " + m.to;
    }
    if (m.state === "resolved" && m.from !== null) return word + " · was " + m.from;
    if (item.type === "dependency" && typeof m.weeks_waiting === "number") {
      return word + " · " + ordinal(m.weeks_waiting) + " week waiting";
    }
    return word;
  }

  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"];
    var v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function noteChipText(item) {
    if (item.hedge && item.hedge.present && item.hedge.cap_applied) return "Hedged — capped at 3";
    if (item.detection && item.detection.export_only) return "Export only — unspoken";
    if (item.hedge && item.hedge.present) return "Hedged claim";
    if (item.detection) return "Export detection — " + item.detection.rule.replace(/-/g, " ");
    return null;
  }

  // ── score block ──────────────────────────────────────────────────────

  function scoreBlock(item) {
    var c = item.computed;
    var dl = el("dl", { class: "row__score" });

    if (item.type === "risk") {
      var critical = c.band === "critical";
      append(dl, [
        el("dt", { class: "u-sr", text: "Exposure" }),
        el("dd", {}, [
          el("div", { class: "score__value" + (critical ? " is-critical" : ""), text: c.exposure + "/25" }),
          el("div", { class: "score__band" + (critical ? " is-critical" : ""), text: c.band + " band" }),
          el("div", { class: "score__terms", text: item.impact + " impact × " + item.likelihood + " likelihood" }),
          el("div", { class: "score__attention", text: "attention " + c.attention.toFixed(2) + " / 5" })
        ])
      ]);
    } else if (item.type === "issue") {
      append(dl, [
        el("dt", { class: "u-sr", text: "Impact" }),
        el("dd", {}, [
          el("div", { class: "score__value", text: item.impact + "/5" }),
          el("div", { class: "score__band", text: "Impact" }),
          el("div", { class: "score__attention", text: "attention " + c.attention.toFixed(2) + " / 5" })
        ])
      ]);
    } else if (item.type === "dependency") {
      append(dl, [
        el("dt", { class: "u-sr", text: "Criticality" }),
        el("dd", {}, [
          el("div", { class: "score__value", text: item.criticality + "/5" }),
          el("div", { class: "score__band", text: CRITICALITY_WORD[item.criticality] }),
          el("div", { class: "score__terms", text: "started week " + item.week_started }),
          el("div", { class: "score__attention", text: "attention " + c.attention.toFixed(2) + " / 5" })
        ])
      ]);
    } else {
      var cov = item.coverage;
      var counts = el("div", { class: "score__counts" });
      append(counts, [
        countLine("airtime", mmss(cov.airtime_seconds)),
        countLine("transitions", String(cov.transitions)),
        typeof cov.carried_unverifiable === "number"
          ? countLine("carried unverifiable", String(cov.carried_unverifiable)) : null,
        typeof cov.downstream_unconfirmed === "number"
          ? countLine("downstream deps unconfirmed", String(cov.downstream_unconfirmed)) : null
      ]);
      append(dl, [
        el("dt", { class: "u-sr", text: "Coverage" }),
        el("dd", {}, [
          counts,
          el("div", { class: "score__attention", text: "attention " + c.attention.toFixed(2) + " / 5" })
        ])
      ]);
    }
    return dl;
  }

  function countLine(label, value) {
    return el("div", {}, [label + " ", el("b", { text: value })]);
  }

  // ── meta block ───────────────────────────────────────────────────────

  function metaBlock(item) {
    var dl = el("dl", { class: "row__meta" });
    var types = sourceTypes(item);
    var agreement = types.length < 2
      ? "uncorroborated"
      : (item.contradiction && item.contradiction.present ? "disagree" : "agree");

    append(dl, [
      el("dt", { text: "Workstream" }),
      el("dd", { text: wsLabel(item.workstream) }),
      el("dt", { text: "Owner" }),
      el("dd", { text: item.owner.role ? item.owner.role : "Unowned" }),
      el("dt", { text: "Control" }),
      el("dd", {}, [controlWord(item.control), " · ", el("span", { class: "u-num", text: item.control.score + "/5" })]),
      el("dt", { text: "Sources" }),
      el("dd", { class: agreement === "disagree" ? "is-alarm" : null }, [
        el("span", { class: "u-num", text: String(types.length) }),
        " source type" + (types.length === 1 ? "" : "s") + " · " + agreement
      ]),
      el("dd", { text: types.join(" · ") })
    ]);

    if (item.type === "dependency") {
      append(dl, [
        el("dt", { text: "Counterparty" }),
        el("dd", { text: wsLabel(item.waiting_workstream) + " waits on " + wsLabel(item.counterparty) })
      ]);
    }
    return dl;
  }

  function controlWord(control) {
    if (control.score === 0) return "Owned, dated";
    if (control.score === 2) return "Owned, no date";
    if (control.score === 4) return "Unowned mention";
    return "Nothing stated";
  }

  function sourceTypes(item) {
    var seen = [];
    item.sources.forEach(function (s) { if (seen.indexOf(s.type) < 0) seen.push(s.type); });
    return seen.sort(function (a, b) { return SOURCE_ORDER[a] - SOURCE_ORDER[b]; });
  }

  // ── quote, with hedge terms marked in situ ───────────────────────────

  function quoteBlock(item) {
    var t = null;
    if (item.hedge && item.hedge.present && item.hedge.quote) {
      t = item.sources.filter(function (s) {
        return s.type === "transcript" && s.quote === item.hedge.quote;
      })[0];
    }
    if (!t) t = item.sources.filter(function (s) { return s.type === "transcript"; })[0];
    if (!t) return null;

    var terms = (item.hedge && item.hedge.present) ? item.hedge.terms || [] : [];
    return el("blockquote", { class: "row__quote" }, [
      el("p", {}, markHedges("“" + t.quote + "”", terms)),
      el("cite", {
        text: t.speaker + ", week " + t.week + " line " + t.line + (t.timestamp ? ", " + t.timestamp : "")
      })
    ]);
  }

  function markHedges(text, terms) {
    if (!terms.length) return [text];
    var lower = text.toLowerCase();
    var hits = [];
    terms.forEach(function (term) {
      var from = 0, at;
      while ((at = lower.indexOf(term, from)) !== -1) {
        hits.push([at, at + term.length]);
        from = at + term.length;
      }
    });
    if (!hits.length) return [text];
    hits.sort(function (a, b) { return a[0] - b[0]; });

    var out = [], cursor = 0;
    hits.forEach(function (h) {
      if (h[0] < cursor) return;
      if (h[0] > cursor) out.push(text.slice(cursor, h[0]));
      out.push(el("mark", { text: text.slice(h[0], h[1]) }));
      cursor = h[1];
    });
    if (cursor < text.length) out.push(text.slice(cursor));
    return out;
  }

  // ── evidence panel (RPT-05) ──────────────────────────────────────────

  function evidencePanel(item, week) {
    var panel = el("section", { class: "panel" }, [
      el("h5", { class: "u-caps panel__head", text: "Evidence — one block per source, in precedence order" })
    ]);

    var ordered = item.sources.slice().sort(function (a, b) {
      return SOURCE_ORDER[a.type] - SOURCE_ORDER[b.type];
    });
    ordered.forEach(function (s) { panel.appendChild(sourceBlock(s, item, week)); });

    if (item.contradiction && item.contradiction.present) {
      panel.appendChild(el("div", { class: "conflict" }, [
        el("b", { text: "Sources conflict" }),
        el("p", { text: item.contradiction.statement }),
        el("p", {}, [
          el("span", { class: "u-caps", text: "Precedence " }),
          "the " + item.contradiction.precedence + " record is taken as precedent. ",
          el("span", { class: "u-caps", text: "Routed to " }),
          item.contradiction.routed_to + "."
        ])
      ]));
    }
    return panel;
  }

  function sourceBlock(s, item, week) {
    var block = el("div", { class: "src" });

    if (s.type === "transcript") {
      append(block, [
        el("div", { class: "src__type", text: "Transcript — week " + s.week + ", line " + s.line }),
        transcriptContext(s, item)
      ]);
    } else if (s.type === "ticket") {
      append(block, [
        el("div", { class: "src__type", text: "Ticket — " + s.ticket_id }),
        el("p", { class: "src__obs", text: s.observation }),
        ticketFields(s, week)
      ]);
    } else if (s.type === "board") {
      append(block, [
        el("div", { class: "src__type", text: "Board — reported status" }),
        el("div", { class: "fields" }, [
          fieldRow("workstream", wsLabel(s.workstream)),
          fieldRow("reported", s.status),
          fieldRow("as at", s.date)
        ]),
        s.observation ? el("p", { class: "src__obs", text: s.observation }) : null
      ]);
    } else {
      append(block, [
        el("div", { class: "src__type", text: "Metadata — run-level observation" }),
        el("div", { class: "fields" }, [
          fieldRow("measure", s.measure),
          fieldRow("value", s.value)
        ]),
        el("p", { class: "src__obs", text: s.observation })
      ]);
    }
    return block;
  }

  function transcriptContext(s, item) {
    var transcript = data.transcripts[s.week];
    var wrap = el("div", { class: "lines" });
    if (!transcript) {
      return append(wrap, el("p", { class: "src__obs", text: "“" + s.quote + "” — " + s.speaker }));
    }
    var lines = transcript.lines;
    var idx = -1;
    for (var i = 0; i < lines.length; i++) { if (lines[i].line === s.line) { idx = i; break; } }
    if (idx < 0) {
      return append(wrap, el("p", { class: "src__obs", text: "“" + s.quote + "” — " + s.speaker }));
    }

    var terms = (item.hedge && item.hedge.present && item.hedge.quote === s.quote) ? item.hedge.terms || [] : [];
    for (var j = Math.max(0, idx - 2); j <= Math.min(lines.length - 1, idx + 2); j++) {
      var l = lines[j];
      var cited = j === idx;
      wrap.appendChild(el("div", { class: "lines__line" + (cited ? " is-cited" : "") }, [
        el("span", { class: "lines__stamp", text: l.timestamp + " · l." + l.line }),
        el("span", { class: "lines__text" }, [
          el("span", { class: "lines__who", text: l.speaker }),
          append(el("span", {}), cited ? markHedges(l.text, terms) : [l.text])
        ])
      ]));
    }
    return wrap;
  }

  function ticketFields(s, week) {
    var wrap = el("div", { class: "fields" });
    var t = data.tickets.filter(function (r) { return r.ticket_id === s.ticket_id; })[0];
    var asAt = data.registers[week].date;

    wrap.appendChild(fieldRow("cited field", s.field + " = " + s.value));
    if (!t) return wrap;

    append(wrap, [
      fieldRow("title", t.title),
      fieldRow("workstream", wsLabel(t.workstream)),
      fieldRow("status", t.status),
      fieldRow("assignee role", t.assignee_role || "unassigned"),
      fieldRow("created", t.created_date),
      fieldRow("status changed", t.status_changed_date),
      fieldRow("days since transition", String(daysBetween(t.status_changed_date, asAt))),
      fieldRow("due", t.due_date || "no due date"),
      fieldRow("blocked by", t.blocked_by || "nothing")
    ]);
    return wrap;
  }

  function fieldRow(k, v) {
    return el("div", { class: "fields__row" }, [
      el("span", { class: "fields__k", text: k }),
      el("span", { class: "fields__v", text: v })
    ]);
  }

  // ── arithmetic panel (RPT-06) ────────────────────────────────────────

  function arithmeticPanel(item) {
    var c = item.computed;
    var panel = el("section", { class: "panel" }, [
      el("h5", { class: "u-caps panel__head", text: "Arithmetic — every factor, its weight and the anchor it was scored against" })
    ]);
    var sum = el("div", { class: "sum" });

    if (item.type === "risk") {
      sum.appendChild(el("div", { class: "sum__line sum__total" }, [
        el("span", { text: "exposure" }),
        el("span", { text: "impact " + item.impact }),
        el("span", { text: "× " + item.likelihood }),
        el("span", { text: "= " + c.exposure + "/25" })
      ]));
      sum.appendChild(el("div", {
        class: "sum__note",
        text: "Bands: 15–25 critical, 10–14 high, 5–9 medium, 1–4 low. " +
              c.exposure + " puts this item in the " + c.band + " band."
      }));
      sum.appendChild(el("div", { class: "sum__rule" }));
    }

    var anchors = item.attention_factors.anchors || {};
    c.attention_terms.forEach(function (t) {
      var line = el("div", { class: "sum__line" }, [
        el("span", { text: t.factor.replace(/_/g, " ") }),
        el("span", { text: String(t.score) }),
        el("span", { text: "× " + t.weight }),
        el("span", { text: "= " + t.product.toFixed(2) })
      ]);
      var d = el("details", {}, [
        el("summary", {}, line),
        el("p", { class: "sum__anchor", text: anchors[t.factor] || "Anchor not recorded for this factor." })
      ]);
      sum.appendChild(d);
    });

    sum.appendChild(el("div", { class: "sum__line sum__rule sum__total" }, [
      el("span", { text: "attention" }),
      el("span", { text: "" }),
      el("span", { text: "" }),
      el("span", { text: c.attention.toFixed(2) + " / 5" })
    ]));
    sum.appendChild(el("div", {
      class: "sum__note",
      text: "Both totals are computed in code from the model's factor scores, never by the model. " +
            "Attention orders items inside a band; it never modifies exposure."
    }));

    if (item.control.anchor) {
      sum.appendChild(el("div", { class: "sum__note", text: "Control status anchor: " + item.control.anchor }));
    }
    if (item.hedge && item.hedge.present) {
      sum.appendChild(el("div", {
        class: "sum__note",
        text: "Hedge terms matched: " + item.hedge.terms.join(", ") + ". " +
              (item.hedge.cap_applied
                ? "The only supporting evidence is hedged, so likelihood is capped at 3."
                : "Corroborating evidence of another source type exists, so no cap applies.")
      }));
    }
    if (item.reclassified) {
      sum.appendChild(el("div", {
        class: "sum__note",
        text: "Reclassified in week " + item.reclassified.week + " from " + item.reclassified.from_type +
              (item.reclassified.from_id ? " (" + item.reclassified.from_id + ")" : "") +
              ". Trigger: " + item.reclassified.trigger + "."
      }));
    }

    panel.appendChild(sum);
    return panel;
  }

  // ── acceptance controls (RPT-07) ─────────────────────────────────────

  function adjudicateBlock(item, week, rerender) {
    var acc = acceptanceFor(week, item);
    var fs = el("fieldset", { class: "row__adjudicate" });
    fs.appendChild(el("legend", { class: "u-sr", text: "Adjudicate " + item.id }));

    var word = acc.state.charAt(0).toUpperCase() + acc.state.slice(1);
    var detail = "";
    if (acc.by) detail += " · " + acc.by;
    if (acc.at) detail += " " + acc.at;
    if (acc.carried_from_week) detail += " · carried from week " + acc.carried_from_week;
    fs.appendChild(el("span", { class: "adj__state is-" + acc.state, text: word + detail }));

    /* Amending and rejecting each need a written note, captured inline rather
       than in a modal: a dialog is unavailable in a sandboxed frame, and the
       note belongs beside the row it changes. */
    var noteForm = el("div", { class: "adj__form", hidden: true });

    var buttons = el("div", { class: "adj__buttons" });
    [["accepted", "Accept"], ["amended", "Amend"], ["rejected", "Reject"]].forEach(function (pair) {
      var state = pair[0];
      var btn = el("button", {
        type: "button",
        class: "adj__btn",
        "aria-pressed": acc.state === state ? "true" : "false",
        text: pair[1]
      });
      btn.addEventListener("click", function () {
        if (state === "accepted") {
          setAcceptance(week, item, state, null);
          rerender();
          return;
        }
        openNoteForm(noteForm, state, item, week, acc, rerender);
      });
      buttons.appendChild(btn);
    });
    fs.appendChild(buttons);

    if (acc.note) {
      fs.appendChild(el("p", { class: "adj__note" }, [
        acc.state === "amended" ? "Amendment: " : "Reason: ", acc.note
      ]));
    }
    fs.appendChild(noteForm);
    return fs;
  }

  function openNoteForm(host, state, item, week, acc, rerender) {
    clear(host);
    host.hidden = false;

    var id = "note-" + state + "-" + item.id;
    var label = state === "amended"
      ? "Amendment. The run's own wording is kept and struck through; it is never erased."
      : "Reason for rejection. The row stays on the record with the reason attached.";

    var input = el("input", {
      type: "text",
      id: id,
      class: "adj__input",
      value: (acc.note && acc.state === state) ? acc.note : "",
      placeholder: state === "amended" ? "What you changed, and why" : "Why this is not a register item"
    });

    function commit() {
      var text = input.value.trim();
      setAcceptance(week, item, state, text ||
        (state === "amended" ? "Amended without a note." : "Rejected without a stated reason."));
      rerender();
    }

    var save = el("button", { type: "button", class: "adj__btn", text: "Save" });
    save.addEventListener("click", commit);
    var cancel = el("button", { type: "button", class: "adj__btn", text: "Cancel" });
    cancel.addEventListener("click", function () { host.hidden = true; clear(host); });

    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); commit(); }
      if (e.key === "Escape") { host.hidden = true; clear(host); }
    });

    append(host, [
      el("label", { class: "adj__label", "for": id, text: label }),
      el("div", { class: "adj__row" }, [input, save, cancel])
    ]);
    input.focus();
  }

  // ── row ──────────────────────────────────────────────────────────────

  function rowNode(item, week, rerender) {
    var acc = acceptanceFor(week, item);
    var alarm = (item.contradiction && item.contradiction.present) ||
                (item.type === "dependency" && item.blocking) ||
                item.type === "assurance-gap" ||
                (item.computed.band === "critical");

    var classes = ["row", "row--" + item.type];
    if (alarm && item.movement.state !== "resolved") classes.push("is-alarm");
    if (acc.state === "rejected") classes.push("is-rejected");
    if (item.movement.state === "resolved") classes.push("is-resolved");

    var article = el("article", { class: classes.join(" "), id: "item-" + item.id });

    var head = el("header", { class: "row__head" }, [el("span", { class: "row__id", text: item.id })]);
    chipsFor(item, acc).forEach(function (c) { head.appendChild(c); });
    article.appendChild(head);

    var titleWrap = el("div", { class: "row__title" }, [
      el("h4", { text: item.title }),
      el("p", { class: "row__statement", text: item.statement })
    ]);
    if (acc.state === "amended" && acc.note) {
      titleWrap.appendChild(el("p", { class: "adj__note" }, [
        "The run said: ", el("del", { text: item.statement })
      ]));
    }
    article.appendChild(titleWrap);

    article.appendChild(scoreBlock(item));
    article.appendChild(metaBlock(item));

    var q = quoteBlock(item);
    if (q) article.appendChild(q);
    else article.appendChild(el("div", { class: "row__quote", style: "border:0;padding:0" }));

    var details = el("details", { class: "row__evidence" }, [
      el("summary", { text: "Evidence & arithmetic" })
    ]);
    var built = false;
    details.addEventListener("toggle", function () {
      if (details.open && !built) {
        details.appendChild(evidencePanel(item, week));
        details.appendChild(arithmeticPanel(item));
        built = true;
      }
    });
    article.appendChild(details);

    article.appendChild(adjudicateBlock(item, week, rerender));
    return article;
  }

  // ── page ─────────────────────────────────────────────────────────────

  function render() {
    var reg = data.registers[currentWeek];
    renderMasthead(reg);
    renderWeekbar();
    renderCoverage(reg);
    renderRegister(reg);
    renderOmissions(reg);
  }

  function renderMasthead(reg) {
    var counts = clear(document.getElementById("masthead-counts"));
    var unaccepted = reg.items.filter(function (i) {
      return acceptanceFor(reg.week, i).state === "unaccepted";
    }).length;

    append(counts, [
      el("dt", { class: "u-sr", text: "Week" }),
      el("dd", {}, ["Week ", el("span", { class: "u-num", text: String(reg.week) }), " of 4"]),
      el("dt", { class: "u-sr", text: "Run" }),
      el("dd", {}, ["run ", el("span", { class: "u-num", text: reg.date }), " · two-pass"]),
      el("dt", { class: "u-sr", text: "Items" }),
      el("dd", {}, [el("span", { class: "u-num", text: String(reg.items.length) }), " items · ",
                    el("span", { class: "u-num", text: String(unaccepted) }), " unaccepted"])
    ]);
  }

  function renderWeekbar() {
    var bar = clear(document.getElementById("weekbar"));
    WEEKS.forEach(function (w) {
      var btn = el("button", {
        type: "button",
        class: "weekbar__btn",
        "aria-current": w === currentWeek ? "true" : "false",
        text: "W" + w
      });
      btn.addEventListener("click", function () { goToWeek(w); });
      bar.appendChild(btn);
    });
    document.getElementById("weekbar-date").textContent = data.registers[currentWeek].date;
  }

  function renderCoverage(reg) {
    var cov = reg.coverage;
    var strip = clear(document.getElementById("coverage"));
    var reporting = cov.workstreams_reporting + " of " + cov.workstreams_total;

    [
      ["airtime", mmss(cov.airtime_total_seconds) + " / " + Math.round(cov.meeting_duration_seconds / 60) + "m", false],
      ["transitions", String(cov.transitions_total), false],
      ["workstreams reporting", reporting, false],
      ["unverified", String(cov.unverified_count), cov.unverified_count > 0]
    ].forEach(function (s) {
      var stat = el("div", { class: "coverage__stat" + (s[2] ? " coverage__stat--alarm" : "") }, [
        el("dt", { text: s[0] }),
        el("dd", { text: s[1] })
      ]);
      strip.appendChild(stat);
    });

    var detail = document.getElementById("coverage-detail");
    var btn = el("button", { type: "button", class: "coverage__more", text: "Coverage & gaps" });
    btn.addEventListener("click", function () {
      detail.hidden = !detail.hidden;
      btn.setAttribute("aria-expanded", String(!detail.hidden));
      if (!detail.hidden) renderCoverageDetail(reg, detail);
    });
    btn.setAttribute("aria-expanded", "false");
    strip.appendChild(btn);
    detail.hidden = true;
  }

  function renderCoverageDetail(reg, host) {
    var cov = reg.coverage;
    clear(host);
    var table = el("table", {}, [
      el("thead", {}, el("tr", {}, [
        el("th", { text: "Workstream" }),
        el("th", { text: "Airtime" }),
        el("th", { text: "Transitions" }),
        el("th", { text: "Opened" }),
        el("th", { text: "Closed" }),
        el("th", { text: "Board" })
      ]))
    ]);
    var body = el("tbody");
    Object.keys(cov.airtime_seconds).forEach(function (ws) {
      body.appendChild(el("tr", {}, [
        el("td", { "data-label": "Workstream", text: wsLabel(ws) }),
        el("td", { class: "u-num", "data-label": "Airtime", text: mmss(cov.airtime_seconds[ws]) }),
        el("td", { class: "u-num", "data-label": "Transitions", text: String(cov.transitions[ws]) }),
        el("td", { class: "u-num", "data-label": "Opened", text: String((cov.opened || {})[ws] === undefined ? "—" : cov.opened[ws]) }),
        el("td", { class: "u-num", "data-label": "Closed", text: String((cov.closed || {})[ws] === undefined ? "—" : cov.closed[ws]) }),
        el("td", { "data-label": "Board", text: (cov.board || {})[ws] || "—" })
      ]));
    });
    table.appendChild(body);

    append(host, [
      el("div", { class: "dialog" }, [
        el("h3", { class: "u-caps", text: "Coverage by workstream" }),
        table,
        el("p", { class: "sum__note", text: "A workstream under 2 minutes of airtime, or with no ticket transitions in the week, is reported as an assurance gap rather than scored." }),
        el("h3", { class: "u-caps", text: "Unverified this week — " + reg.gaps.length }),
        el("div", { class: "omissions__list" }, reg.gaps.map(gapNode))
      ])
    ]);
  }

  function renderRegister(reg) {
    var main = clear(document.getElementById("register"));

    GROUPS.forEach(function (g) {
      var items = reg.items.filter(function (i) { return i.type === g.type; });
      var section = el("section", { class: "group", "aria-labelledby": "group-" + g.type });

      section.appendChild(el("div", { class: "group__head" }, [
        el("h2", { class: "group__name", id: "group-" + g.type, text: g.name }),
        el("span", { class: "group__count", text: String(items.length) }),
        el("span", { class: "group__scale", text: g.scale })
      ]));
      if (g.note) section.appendChild(el("p", { class: "group__note", text: g.note }));

      if (!items.length) {
        section.appendChild(el("p", { class: "group__empty", text: g.empty }));
      } else {
        section.appendChild(el("div", { class: "colheads" }, [
          el("span", { text: "Item, type, movement" }),
          el("span", { text: "Score & control" }),
          el("span", { text: "Evidence & state" })
        ]));
        items.forEach(function (item) {
          section.appendChild(rowNode(item, reg.week, function () { render(); }));
        });
      }
      main.appendChild(section);
    });

    if (reg.week === 1) {
      main.insertBefore(
        el("p", { class: "banner", text: "Week 1. No prior register exists, so every item is new. Movement should not be read as calm." }),
        main.firstChild
      );
    }
  }

  function renderOmissions(reg) {
    var section = document.getElementById("omissions");
    var list = clear(document.getElementById("omissions-list"));
    section.hidden = reg.gaps.length === 0;
    reg.gaps.forEach(function (g) { list.appendChild(gapNode(g)); });
  }

  function gapNode(g) {
    return el("div", { class: "omissions__item" }, [
      el("div", { class: "omissions__ref", text: g.ref }),
      g.subject ? el("div", { class: "omissions__subject", text: g.subject }) : null,
      el("p", { class: "omissions__reason", text: g.reason })
    ]);
  }

  // ── routing ──────────────────────────────────────────────────────────

  function weekFromHash() {
    var m = /^#week-([1-4])$/.exec(window.location.hash);
    return m ? Number(m[1]) : null;
  }

  function goToWeek(w) {
    if (window.location.hash !== "#week-" + w) {
      window.location.hash = "week-" + w;  // hashchange does the rest
    } else {
      show(w);
    }
  }

  window.addEventListener("hashchange", function () {
    var w = weekFromHash();
    if (w) show(w).then(function () { window.scrollTo(0, 0); });
  });

  // ── boot ─────────────────────────────────────────────────────────────

  function adoptBundle(raw) {
    // The inlined bundle keys weeks as strings; the fetch path keys them as
    // numbers. Normalise once so nothing downstream has to care.
    data = { registers: {}, transcripts: {}, tickets: raw.tickets, board: raw.board };
    WEEKS.forEach(function (w) {
      if (raw.registers[w] || raw.registers[String(w)]) {
        data.registers[w] = raw.registers[w] || raw.registers[String(w)];
      }
      if (raw.transcripts[w] || raw.transcripts[String(w)]) {
        data.transcripts[w] = raw.transcripts[w] || raw.transcripts[String(w)];
      }
    });
  }

  function getJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + " " + r.status);
      return r.json();
    });
  }

  function parseCsv(text) {
    var lines = text.trim().split(/\r?\n/);
    var head = lines.shift().split(",");
    return lines.map(function (line) {
      var cells = line.split(",");
      var row = {};
      head.forEach(function (k, i) { row[k] = cells[i] === undefined ? "" : cells[i]; });
      return row;
    });
  }

  /* Over http the committed files are the source of truth at view time, and
     only the week being read is fetched: a reader on a mobile connection
     downloads one register, not four (NFR-01). Weeks already held are not
     re-fetched. From file:// fetch is blocked, so the same data, inlined at
     build time, is loaded instead. Neither path reaches another origin. */
  var loading = {};

  function ensureWeek(week) {
    if (data && data.registers[week] && data.transcripts[week] && data.tickets) {
      return Promise.resolve();
    }
    if (loading[week]) return loading[week];
    loading[week] = Promise.all([
      getJSON("runs/week-" + week + "-register.json"),
      getJSON("data/transcripts/week-" + week + ".json"),
      data && data.tickets ? Promise.resolve(data.tickets)
        : fetch("data/tickets.csv").then(function (r) { return r.text(); }).then(parseCsv),
      data && data.board ? Promise.resolve(data.board) : getJSON("data/board.json")
    ]).then(function (parts) {
      if (!data) data = { registers: {}, transcripts: {}, tickets: null, board: null };
      data.registers[week] = parts[0];
      data.transcripts[week] = parts[1];
      data.tickets = parts[2];
      data.board = parts[3];
    });
    return loading[week];
  }

  function loadInlinedBundle() {
    if (window.RISK_RADAR) { adoptBundle(window.RISK_RADAR); return Promise.resolve(); }
    return new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = "data.bundle.js";
      s.onload = function () {
        if (window.RISK_RADAR) { adoptBundle(window.RISK_RADAR); resolve(); }
        else reject(new Error("data.bundle.js loaded but defined nothing"));
      };
      s.onerror = function () { reject(new Error("data.bundle.js could not be loaded")); };
      document.head.appendChild(s);
    });
  }

  function show(week) {
    currentWeek = week;
    var ready = (window.location.protocol === "file:" || window.RISK_RADAR)
      ? loadInlinedBundle()
      : ensureWeek(week).catch(loadInlinedBundle);
    return ready.then(render).catch(failed);
  }

  function failed(err) {
    clear(document.getElementById("register")).appendChild(el("p", {
      class: "banner",
      text: "Run data did not load (" + err.message + "). Over http the report reads runs/week-N-register.json " +
            "directly; from a bare filesystem it needs data.bundle.js, which is rebuilt with " +
            "python3 tools/build_bundle.py."
    }));
  }

  function start() { show(weekFromHash() || 3); }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
