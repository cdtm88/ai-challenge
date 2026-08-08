/* Risk Radar — the register, rendered from committed run data.
 *
 * No framework, no build step, no model call, no network request to any
 * origin but this one. The register's content is decided in runs/*.json;
 * this file decides only how it is laid out and what can be reached.
 *
 * A collapsed row is three things: a number with its scale word, a title,
 * and one grey meta line. Everything else — id, owner, source counts, the
 * factor arithmetic, acceptance — lives behind that row's disclosure.
 * Nothing is dropped; it is moved.
 */
(function () {
  "use strict";

  var WEEKS = [1, 2, 3, 4];
  var AIRTIME_FLOOR = 120;  // CLS-05: under two minutes is not a report

  /* Section order is fixed and is an argument, not a preference. "Closed"
     collects anything the run resolved this week, whatever its type. */
  var SECTIONS = [
    { key: "assurance-gap", name: "Assurance gaps", scale: "coverage counts, not scored",
      empty: "No assurance gaps evidenced this week." },
    { key: "risk", name: "Risks", scale: "exposure, 1 to 25",
      empty: "No risks evidenced this week." },
    { key: "issue", name: "Issues", scale: "impact, 1 to 5",
      empty: "No issues evidenced this week." },
    { key: "dependency", name: "Dependencies", scale: "criticality, 1 to 5",
      empty: "No dependencies evidenced this week." },
    { key: "closed", name: "Closed", scale: "resolved this week",
      empty: "Nothing closed this week." }
  ];

  var TYPE_WORD = {
    "risk": "Risk", "issue": "Issue",
    "dependency": "Dependency", "assurance-gap": "Assurance gap"
  };

  var MOVE_WORD = {
    "new": "New", "worsening": "Worsening", "improving": "Improving",
    "stable": "Stable", "resolved": "Resolved", "returned": "Returned",
    "reclassified": "Reclassified"
  };

  var BAND_WORD = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

  var CRITICALITY_WORD = {
    1: "desirable, work continues without it",
    2: "between desirable and milestone-critical",
    3: "a milestone depends on it",
    4: "between milestone and release-critical",
    5: "the release depends on it, no alternative path"
  };

  var SOURCE_ORDER = { ticket: 0, transcript: 1, board: 2, metadata: 3 };

  var WS_LABEL = {
    "platform": "Platform", "integration": "Integration",
    "data-migration": "Data migration", "reporting": "Reporting",
    "test": "Test", "adoption": "Adoption", "programme": "Programme"
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
    return String(key).replace(/-/g, " ").replace(/^./, function (c) { return c.toUpperCase(); });
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

  function sentence(list) {
    if (list.length <= 1) return list.join("");
    return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
  }

  // ── acceptance, session-scoped ───────────────────────────────────────

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
      /* private mode, or storage disabled: the session simply does not survive reload */
    }
  }

  function acceptanceFor(week, item) {
    return acceptance[week + ":" + item.id] || item.acceptance;
  }

  function setAcceptance(week, id, state, note) {
    acceptance[week + ":" + id] = { state: state, by: "This session", at: null, note: note || null };
    saveAcceptance();
  }

  // ── the collapsed row ────────────────────────────────────────────────

  /* The left column: the number that decides the row's place, and the word
     that says which scale it sits on. An assurance gap has no score, and
     says so rather than borrowing one. */
  function scoreParts(item, closed) {
    var p;
    if (item.type === "risk") {
      p = { num: String(item.computed.exposure), label: BAND_WORD[item.computed.band] || "Band" };
      p.tone = closed ? "is-closed"
        : item.computed.band === "critical" ? "is-critical"
        : item.computed.band === "high" ? "is-high"
        : item.computed.band === "low" ? "is-low" : "";
    } else if (item.type === "issue") {
      p = { num: String(item.impact), label: "Impact", tone: closed ? "is-closed" : "" };
    } else if (item.type === "dependency") {
      p = { num: String(item.criticality), label: "Criticality", tone: closed ? "is-closed" : "" };
    } else {
      p = { num: "—", label: "Unknown", tone: closed ? "is-closed" : "is-unknown" };
    }
    return p;
  }

  /* Movement is worth a word only when something moved. A stable item says
     nothing, so the eye skips it. */
  function movementWord(item) {
    var m = item.movement;
    var word = MOVE_WORD[m.state];
    if (m.state === "stable") return null;
    if (m.state === "reclassified" && item.reclassified) {
      return "Reclassified from " + item.reclassified.from_type;
    }
    if (item.type === "assurance-gap") {
      if (m.state === "worsening" && item.coverage && item.coverage.weeks_absent) {
        return "Worsening, " + item.coverage.weeks_absent + " weeks absent";
      }
      return word;
    }
    if ((m.state === "worsening" || m.state === "improving") && m.from !== null && m.to !== null) {
      return word + " " + m.from + " → " + m.to;
    }
    return word;
  }

  /* Amber is for a management gap: something nobody owns, or nobody is
     doing. It is not for a low score. */
  function controlWord(item) {
    if (item.control.score >= 5) return "Unmanaged";
    if (item.control.score >= 4) return "No owner";
    return null;
  }

  function metaLine(item) {
    var parts = [el("span", { text: wsLabel(item.workstream) })];

    var mv = movementWord(item);
    if (mv) parts.push(el("span", { text: mv }));

    if (item.contradiction && item.contradiction.present) {
      parts.push(el("span", { class: "is-conflict", text: "Sources conflict" }));
    }

    var ctl = controlWord(item);
    if (ctl) parts.push(el("span", { class: "is-unmanaged", text: ctl }));

    if (item.detection && item.detection.export_only) {
      parts.push(el("span", { text: "From tickets only" }));
    }

    var line = el("p", { class: "row__meta" });
    parts.forEach(function (p, i) {
      if (i) line.appendChild(el("span", { class: "sep", text: "·" }));
      line.appendChild(p);
    });
    return line;
  }

  // ── the disclosure ───────────────────────────────────────────────────

  function reclassNote(item) {
    if (!item.reclassified) return null;
    var r = item.reclassified;
    return el("div", { class: "note-line" }, [
      el("b", { text: "Reclassified" }),
      "Was a " + r.from_type + (r.from_id ? ", " + r.from_id : "") +
      " until week " + r.week + ". " + r.trigger + "."
    ]);
  }

  function contradictionNote(item) {
    var c = item.contradiction;
    if (!c || !c.present) return null;
    return el("div", { class: "note-line is-conflict" }, [
      el("b", { text: "Sources conflict" }),
      c.statement + " The " + c.precedence + " record is taken as precedent. Routed to " +
      c.routed_to + "."
    ]);
  }

  function orderedSources(item) {
    return item.sources.slice().sort(function (a, b) {
      return SOURCE_ORDER[a.type] - SOURCE_ORDER[b.type];
    });
  }

  /* The primary source is the one a reader can judge fastest: a person on
     the record, otherwise the ticket that shows the state. */
  function primarySource(item) {
    var src = item.sources;
    var pick = null;
    if (item.hedge && item.hedge.present && item.hedge.quote) {
      pick = src.filter(function (s) { return s.type === "transcript" && s.quote === item.hedge.quote; })[0];
    }
    return pick
      || src.filter(function (s) { return s.type === "transcript"; })[0]
      || src.filter(function (s) { return s.type === "ticket"; })[0]
      || orderedSources(item)[0];
  }

  function markHedges(text, terms) {
    if (!terms || !terms.length) return [text];
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

  function transcriptEvidence(s, item) {
    var terms = (item.hedge && item.hedge.present && item.hedge.quote === s.quote)
      ? item.hedge.terms || [] : [];
    var block = el("div", { class: "quote" }, [
      append(el("p", { class: "quote__text" }), markHedges("“" + s.quote + "”", terms)),
      el("p", {
        class: "quote__who",
        text: s.speaker + " · week " + s.week + ", line " + s.line + (s.timestamp ? ", " + s.timestamp : "")
      })
    ]);

    // Two lines either side, so the quote can be judged where it was said.
    var tr = data && data.transcripts ? data.transcripts[s.week] : null;
    if (!tr) return block;
    var lines = tr.lines, idx = -1;
    for (var i = 0; i < lines.length; i++) { if (lines[i].line === s.line) { idx = i; break; } }
    if (idx < 0) return block;

    var ctx = el("div", { class: "quote__ctx" });
    for (var j = Math.max(0, idx - 2); j <= Math.min(lines.length - 1, idx + 2); j++) {
      if (j === idx) continue;
      var l = lines[j];
      ctx.appendChild(el("p", { class: "quote__ctx-line" }, [
        el("span", { class: "who", text: l.timestamp + " " + l.speaker + ": " }),
        l.text
      ]));
    }
    block.appendChild(ctx);
    return block;
  }

  function ticketEvidence(s) {
    var rows = el("div", { class: "record" });
    rows.appendChild(recordRow("cited field", s.field + " = " + s.value));
    var t = (data && data.tickets || []).filter(function (r) { return r.ticket_id === s.ticket_id; })[0];
    if (t) {
      var asAt = data.registers[currentWeek] ? data.registers[currentWeek].date : null;
      append(rows, [
        recordRow("title", t.title),
        recordRow("workstream", wsLabel(t.workstream)),
        recordRow("status", t.status),
        recordRow("assignee role", t.assignee_role || "unassigned"),
        recordRow("created", t.created_date),
        recordRow("status changed", t.status_changed_date),
        asAt ? recordRow("days since transition", String(daysBetween(t.status_changed_date, asAt))) : null,
        recordRow("due", t.due_date || "no due date"),
        recordRow("blocked by", t.blocked_by || "nothing")
      ]);
    }
    if (s.observation) rows.appendChild(recordRow("observation", s.observation));
    return rows;
  }

  function recordRow(k, v) {
    return el("div", { class: "record__row" }, [
      el("span", { class: "record__k", text: k }),
      el("span", { class: "record__v", text: v })
    ]);
  }

  function sourceSummary(s) {
    if (s.type === "transcript") {
      return "transcript, " + s.speaker + " week " + s.week + " line " + s.line;
    }
    if (s.type === "ticket") {
      return "ticket " + s.ticket_id + " — " + s.observation;
    }
    if (s.type === "board") {
      return "board, " + wsLabel(s.workstream) + " reported " + s.status + " on " + s.date;
    }
    return "metadata, " + s.measure + " = " + s.value + " — " + s.observation;
  }

  function evidenceBlock(item) {
    var primary = primarySource(item);
    var block = el("div", { class: "detail__block" }, [
      el("h4", { class: "detail__head", text: "Evidence" })
    ]);

    if (primary.type === "transcript") block.appendChild(transcriptEvidence(primary, item));
    else if (primary.type === "ticket") block.appendChild(ticketEvidence(primary));
    else block.appendChild(el("p", { class: "quote__text", text: sourceSummary(primary) }));

    var rest = orderedSources(item).filter(function (s) { return s !== primary; });
    if (rest.length) {
      block.appendChild(el("p", { class: "also" }, [
        el("b", { text: "Also: " }),
        rest.map(sourceSummary).join("; ") + "."
      ]));
    }
    return block;
  }

  function assessmentBlock(item, week) {
    var c = item.computed;
    var dl = el("dl", { class: "dl" });

    if (item.type === "risk") {
      append(dl, [
        el("dt", { text: "Exposure" }),
        el("dd", {}, [
          el("span", { class: "u-num", text: item.impact + " × " + item.likelihood + " = " + c.exposure }),
          " of 25, " + c.band
        ])
      ]);
    } else if (item.type === "issue") {
      append(dl, [
        el("dt", { text: "Impact" }),
        el("dd", {}, [el("span", { class: "u-num", text: String(item.impact) }), " of 5"])
      ]);
    } else if (item.type === "dependency") {
      append(dl, [
        el("dt", { text: "Criticality" }),
        el("dd", {}, [
          el("span", { class: "u-num", text: String(item.criticality) }),
          " of 5, " + CRITICALITY_WORD[item.criticality]
        ]),
        el("dt", { text: "Waiting" }),
        el("dd", {
          text: wsLabel(item.waiting_workstream) + " on " + wsLabel(item.counterparty) +
                " since week " + item.week_started + (item.blocking ? ". Blocking: work cannot proceed." : ".")
        })
      ]);
    } else {
      var cov = item.coverage;
      append(dl, [
        el("dt", { text: "Coverage" }),
        el("dd", {}, [
          el("span", { class: "u-num", text: mmss(cov.airtime_seconds) }),
          " airtime · ",
          el("span", { class: "u-num", text: String(cov.transitions) }),
          " ticket transitions",
          cov.carried_unverifiable ? " · " + cov.carried_unverifiable + " carried items unverifiable" : "",
          cov.downstream_unconfirmed ? " · " + cov.downstream_unconfirmed + " downstream dependencies unconfirmed" : ""
        ])
      ]);
    }

    var terms = c.attention_terms.map(function (t) {
      return t.factor.replace(/_/g, " ") + " " + t.score + "×" + t.weight;
    }).join(" · ");
    append(dl, [
      el("dt", { text: "Attention" }),
      el("dd", {}, [
        el("span", { class: "u-num", text: c.attention.toFixed(2) }),
        " of 5",
        el("span", { class: "dl__sub", text: terms })
      ]),
      el("dt", { text: "Owner" }),
      el("dd", { text: item.owner.role ? item.owner.role : "Unowned" }),
      el("dt", { text: "Control" }),
      el("dd", { text: item.control.anchor || (item.control.text || "Nothing stated.") })
    ]);

    if (item.hedge && item.hedge.present) {
      append(dl, [
        el("dt", { text: "Hedged" }),
        el("dd", {
          text: item.hedge.terms.join(", ") + ". " + (item.hedge.cap_applied
            ? "The only supporting evidence is hedged, so likelihood is capped at 3."
            : "Corroborated by another source type, so no cap applies.")
        })
      ]);
    }

    return el("div", { class: "detail__block" }, [
      el("h4", { class: "detail__head", text: "Assessment" }),
      dl
    ]);
  }

  function adjudicateBlock(item, week) {
    var acc = acceptanceFor(week, item);
    var fs = el("fieldset", { class: "adj" }, [
      el("legend", { class: "u-sr", text: "Adjudicate " + item.id })
    ]);

    var btns = el("div", { class: "adj__btns" });
    [["accepted", "Accept"], ["amended", "Amend"], ["rejected", "Reject"]].forEach(function (pair) {
      btns.appendChild(el("button", {
        type: "button", class: "adj__btn", "data-act": pair[0],
        "aria-pressed": acc.state === pair[0] ? "true" : "false",
        text: pair[1]
      }));
    });
    fs.appendChild(btns);

    var word = acc.state.charAt(0).toUpperCase() + acc.state.slice(1);
    var detail = "";
    if (acc.by) detail += " · " + acc.by;
    if (acc.at) detail += " " + acc.at;
    if (acc.carried_from_week) detail += " · carried from week " + acc.carried_from_week;
    fs.appendChild(el("span", { class: "adj__state", text: word + detail }));

    if (acc.note) {
      fs.appendChild(el("p", { class: "adj__note" }, [
        acc.state === "amended" ? "Amendment: " : "Reason: ", acc.note
      ]));
    }
    if (acc.state === "amended" && acc.note) {
      fs.appendChild(el("p", { class: "adj__note" }, [
        "The run said: ", el("del", { text: item.statement })
      ]));
    }
    fs.appendChild(el("div", { class: "adj__form", hidden: true }));
    return fs;
  }

  function rowNode(item, week, closed) {
    var acc = acceptanceFor(week, item);
    var sp = scoreParts(item, closed);

    var article = el("article", {
      class: "row" + (acc.state === "rejected" ? " is-rejected" : ""),
      id: "item-" + item.id
    });
    article.setAttribute("data-acc", JSON.stringify(item.acceptance));

    article.appendChild(el("div", { class: "row__score" }, [
      el("span", { class: "row__num " + sp.tone, text: sp.num }),
      el("span", { class: "row__scale", text: sp.label })
    ]));

    var body = el("div", { class: "row__body" }, [
      el("h3", { class: "row__title", text: item.title }),
      metaLine(item)
    ]);

    /* Built up front rather than on click: <details> opens without script, so
       a reader with JavaScript off still reaches the evidence. */
    var more = el("details", { class: "row__more" }, [
      el("summary", { text: item.id + " · detail" })
    ]);
    append(more, el("div", { class: "detail" }, [
      reclassNote(item),
      contradictionNote(item),
      el("div", { class: "detail__block" }, [
        el("h4", { class: "detail__head", text: "Statement" }),
        el("p", { text: item.statement })
      ]),
      evidenceBlock(item),
      assessmentBlock(item, week),
      adjudicateBlock(item, week)
    ]));
    body.appendChild(more);

    article.appendChild(body);
    return article;
  }

  // ── page ─────────────────────────────────────────────────────────────

  function render() {
    var reg = data.registers[currentWeek];
    renderHead(reg);
    renderWeeks();
    renderAlert(reg);
    renderRegister(reg);
    renderCoverage(reg);
    renderOmissions(reg);
  }

  function renderHead(reg) {
    var unaccepted = reg.items.filter(function (i) {
      return acceptanceFor(reg.week, i).state === "unaccepted";
    }).length;
    clear(document.getElementById("head-sub")).appendChild(
      el("span", {}, [
        "Week " + reg.week + " of 4 · run ",
        el("span", { class: "u-num", text: reg.date }),
        " · " + reg.items.length + " items, " + unaccepted + " not yet adjudicated"
      ])
    );
  }

  function renderWeeks() {
    var bar = clear(document.getElementById("weekbar"));
    WEEKS.forEach(function (w) {
      bar.appendChild(el("button", {
        type: "button", class: "weeks__btn", "data-week": w,
        "aria-current": w === currentWeek ? "true" : "false",
        text: "Week " + w
      }));
    });
  }

  /* Absence is the finding a delivery manager needs first, so it sits above
     the register rather than inside it. */
  function renderAlert(reg) {
    var host = clear(document.getElementById("alert"));
    var cov = reg.coverage;
    var quiet = Object.keys(cov.airtime_seconds).filter(function (ws) {
      return cov.airtime_seconds[ws] < AIRTIME_FLOOR || cov.transitions[ws] === 0;
    });
    if (!quiet.length) return;

    host.appendChild(el("p", {}, [
      el("b", { text: quiet.length + " of " + cov.workstreams_total + " workstreams did not report" }),
      ". " + sentence(quiet.map(wsLabel)) +
      (quiet.length === 1 ? " gave" : " gave") + " too little to verify. Their state is unknown, not green."
    ]));
  }

  function renderRegister(reg) {
    var host = clear(document.getElementById("register"));
    var closed = reg.items.filter(function (i) { return i.movement.state === "resolved"; });
    var live = reg.items.filter(function (i) { return i.movement.state !== "resolved"; });

    SECTIONS.forEach(function (sec) {
      var items = sec.key === "closed" ? closed
        : live.filter(function (i) { return i.type === sec.key; });

      var section = el("section", { class: "section" }, [
        el("div", { class: "section__head" }, [
          el("h2", { class: "section__name", text: sec.name }),
          el("span", { class: "section__scale", text: sec.scale })
        ])
      ]);

      if (!items.length) {
        section.appendChild(el("p", { class: "empty", text: sec.empty }));
      } else {
        items.forEach(function (item) {
          section.appendChild(rowNode(item, reg.week, sec.key === "closed"));
        });
      }
      host.appendChild(section);
    });
  }

  function renderCoverage(reg) {
    var cov = reg.coverage;
    var host = clear(document.getElementById("coverage-detail"));
    var table = el("div", { class: "cov" }, [
      el("div", { class: "cov__row is-head" }, [
        el("span", { text: "Workstream" }),
        el("span", { text: "Airtime" }),
        el("span", { text: "Moves" }),
        el("span", { text: "Board" })
      ])
    ]);
    Object.keys(cov.airtime_seconds).forEach(function (ws) {
      var under = cov.airtime_seconds[ws] < AIRTIME_FLOOR || cov.transitions[ws] === 0;
      table.appendChild(el("div", { class: "cov__row" }, [
        el("span", { class: under ? "is-under" : null, text: wsLabel(ws) + (under ? " — not reporting" : "") }),
        el("span", { class: "u-num", text: mmss(cov.airtime_seconds[ws]) }),
        el("span", { class: "u-num", text: String(cov.transitions[ws]) }),
        el("span", { text: (cov.board || {})[ws] || "—" })
      ]));
    });
    append(host, [
      table,
      el("p", { class: "note__lede" }, [
        "Meeting airtime totalled ",
        el("span", { class: "u-num", text: mmss(cov.airtime_total_seconds) }),
        " of " + Math.round(cov.meeting_duration_seconds / 60) + " minutes, against ",
        el("span", { class: "u-num", text: String(cov.transitions_total) }),
        " ticket transitions. A workstream under two minutes of airtime, or with no ticket " +
        "movement, is reported as an assurance gap rather than scored."
      ])
    ]);
  }

  function renderOmissions(reg) {
    var list = clear(document.getElementById("omissions-list"));
    var count = document.getElementById("omissions-count");
    if (count) count.textContent = String(reg.gaps.length);
    reg.gaps.forEach(function (g) {
      list.appendChild(el("div", { class: "omit" }, [
        el("span", { class: "omit__ref", text: g.ref }),
        g.subject ? el("span", { class: "omit__subject", text: g.subject }) : null,
        el("p", { class: "omit__reason", text: g.reason })
      ]));
    });
  }

  // ── routing ──────────────────────────────────────────────────────────

  function weekFromHash() {
    var m = /^#week-([1-4])$/.exec(window.location.hash);
    return m ? Number(m[1]) : null;
  }

  function goToWeek(w) {
    if (window.location.hash !== "#week-" + w) window.location.hash = "week-" + w;
    else show(w);
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
     only the week being read is fetched. From file:// fetch is blocked, so
     the same data, inlined at build time, is loaded instead. Neither path
     reaches another origin. */
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
      class: "empty",
      text: "Run data did not load (" + err.message + "). Over http the report reads " +
            "runs/week-N-register.json directly; from a bare filesystem it needs " +
            "data.bundle.js, rebuilt with python3 tools/build_bundle.py."
    }));
  }

  // ── intake ───────────────────────────────────────────────────────────

  /* Two files, read in the browser. What can be derived without a model is
     derived here and shown: the coverage numbers, and the three detections
     that run over the export alone. What needs a model — classifying each
     finding and scoring it against the anchors — is a two-pass run made
     offline, because there is no model and no server at view time. The
     button hands over exactly the input that run expects. */

  var CSV_COLUMNS = ["ticket_id", "workstream", "title", "status", "assignee_role",
                     "created_date", "status_changed_date", "due_date", "blocked_by"];
  var CLOSED_STATUSES = ["done", "closed", "resolved", "complete", "completed"];
  var STALE_DAYS = 10;
  var STALE_MIN = 3;
  var GROWTH_MIN_EXCESS = 3;

  var intake = { tickets: null, transcript: null };

  function parseCsvRows(text) {
    // Quoted fields may contain commas, quotes and newlines, so this walks
    // the text rather than splitting it.
    var rows = [], row = [], field = "", quoted = false, i = 0;
    text = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    for (; i < text.length; i++) {
      var c = text[i];
      if (quoted) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return r.length > 1 || (r[0] || "").trim(); });
  }

  function readTickets(text) {
    var rows = parseCsvRows(text);
    if (!rows.length) throw new Error("the file is empty");
    var head = rows[0].map(function (h) { return h.trim().toLowerCase().replace(/\s+/g, "_"); });
    var missing = CSV_COLUMNS.filter(function (c) { return head.indexOf(c) < 0; });
    var records = rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (k, n) { o[k] = (r[n] === undefined ? "" : r[n]).trim(); });
      return o;
    }).filter(function (o) { return o.ticket_id; });
    return { rows: records, columns: head, missing: missing };
  }

  var TIME_LINE = /^\s*(?:\[)?(\d{1,2}:\d{2}(?::\d{2})?)(?:\])?\s+([^:]{2,48}?)\s*:\s*(.+)$/;
  var VTT_CUE = /^(\d{1,2}:\d{2}(?::\d{2})?)[.,]?\d*\s*-->/;

  function readTranscript(text, name) {
    if (/\.json$/i.test(name) || /^\s*\{/.test(text)) {
      var doc = JSON.parse(text);
      if (!doc.lines) throw new Error("no lines array");
      return { doc: doc, format: "json" };
    }
    // VTT or speaker-labelled text: keep whatever carries a time and a name.
    var lines = [], pending = null, n = 0;
    text.replace(/\r\n?/g, "\n").split("\n").forEach(function (raw) {
      var cue = VTT_CUE.exec(raw);
      if (cue) { pending = cue[1]; return; }
      var m = TIME_LINE.exec(raw);
      if (m) {
        lines.push({ line: ++n, timestamp: m[1], speaker: m[2].trim(), text: m[3].trim(), workstream: null });
        pending = null;
        return;
      }
      var named = /^\s*([^:]{2,48}?)\s*:\s*(.+)$/.exec(raw);
      if (named && pending) {
        lines.push({ line: ++n, timestamp: pending, speaker: named[1].trim(), text: named[2].trim(), workstream: null });
        pending = null;
      }
    });
    if (!lines.length) throw new Error("no speaker-labelled lines with timestamps");
    return { doc: { lines: lines, airtime_seconds: {}, duration_seconds: null }, format: /\.vtt$/i.test(name) ? "vtt" : "text" };
  }

  function isClosed(status) {
    return CLOSED_STATUSES.indexOf(String(status).trim().toLowerCase()) >= 0;
  }

  function toDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "").trim());
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null;
  }

  function windowEnd() {
    if (intake.transcript && intake.transcript.doc.date && toDate(intake.transcript.doc.date)) {
      return toDate(intake.transcript.doc.date);
    }
    var latest = null;
    (intake.tickets ? intake.tickets.rows : []).forEach(function (t) {
      [t.status_changed_date, t.created_date].forEach(function (d) {
        var v = toDate(d);
        if (v !== null && (latest === null || v > latest)) latest = v;
      });
    });
    return latest;
  }

  /* The same derivations tools/corpus_stats.py runs over the committed
     corpus, applied to whatever was just dropped in. */
  function derive() {
    var end = windowEnd();
    if (end === null || !intake.tickets) return null;
    var day = 86400000;
    var windows = [0, 1, 2].map(function (back) {
      return { end: end - back * 7 * day, start: end - (back * 7 + 6) * day };
    });

    var streams = {};
    function bucket(ws) {
      if (!streams[ws]) {
        streams[ws] = { transitions: 0, opened: [0, 0, 0], closed: [0, 0, 0], stale: [], airtime: 0, spoke: false };
      }
      return streams[ws];
    }

    intake.tickets.rows.forEach(function (t) {
      var ws = t.workstream || "(unlabelled)";
      var b = bucket(ws);
      var moved = toDate(t.status_changed_date);
      var made = toDate(t.created_date);
      windows.forEach(function (w, n) {
        if (made !== null && made >= w.start && made <= w.end) b.opened[n] += 1;
        if (moved !== null && moved >= w.start && moved <= w.end) {
          if (n === 0) b.transitions += 1;
          if (isClosed(t.status)) b.closed[n] += 1;
        }
      });
      if (moved !== null && !isClosed(t.status)) {
        var days = Math.round((end - moved) / day);
        if (days > STALE_DAYS) b.stale.push({ id: t.ticket_id, days: days });
      }
    });

    if (intake.transcript) {
      var doc = intake.transcript.doc;
      Object.keys(doc.airtime_seconds || {}).forEach(function (ws) {
        bucket(ws).airtime = doc.airtime_seconds[ws];
        bucket(ws).spoke = doc.airtime_seconds[ws] > 0;
      });
      (doc.lines || []).forEach(function (l) {
        if (l.workstream) bucket(l.workstream).spoke = true;
      });
    }

    var detections = { staleness: [], growth: [], claimed: [], quiet: [] };
    Object.keys(streams).forEach(function (ws) {
      var b = streams[ws];
      if (b.stale.length >= STALE_MIN) {
        b.stale.sort(function (x, y) { return y.days - x.days; });
        detections.staleness.push({ ws: ws, n: b.stale.length, worst: b.stale[0] });
      }
      var grew = [0, 1].every(function (n) { return b.opened[n] - b.closed[n] >= GROWTH_MIN_EXCESS; });
      if (grew) detections.growth.push({ ws: ws, this_week: b.opened[0] + "/" + b.closed[0], last_week: b.opened[1] + "/" + b.closed[1] });
      if (b.spoke && b.transitions === 0) detections.claimed.push({ ws: ws });
      if (intake.transcript && (b.airtime < AIRTIME_FLOOR || b.transitions === 0)) {
        detections.quiet.push({ ws: ws, airtime: b.airtime, transitions: b.transitions });
      }
    });

    return { end: end, streams: streams, detections: detections,
             windowLabel: new Date(windows[0].start).toISOString().slice(0, 10) + " to " +
                          new Date(end).toISOString().slice(0, 10) };
  }

  function setSlot(kind, tone, message) {
    var label = document.querySelector('.drop[data-kind="' + kind + '"]');
    var state = document.getElementById("state-" + kind);
    if (!label || !state) return;
    label.classList.remove("is-ok", "is-warn", "is-bad", "is-over");
    if (tone) label.classList.add("is-" + tone);
    state.textContent = message;
  }

  function line(tone, parts) {
    return el("p", { class: "read__line" + (tone ? " is-" + tone : "") }, parts);
  }

  function renderIntake() {
    var out = clear(document.getElementById("intake-out"));
    if (!intake.tickets && !intake.transcript) return;

    var checks = el("div", { class: "read__list" });

    if (intake.tickets) {
      var t = intake.tickets;
      checks.appendChild(line(t.missing.length ? "bad" : "ok", [
        el("span", { class: "u-num", text: String(t.rows.length) }),
        " ticket rows read. " + (t.missing.length
          ? "Missing required column" + (t.missing.length > 1 ? "s" : "") + ": " + t.missing.join(", ") + "."
          : "All nine required columns present.")
      ]));
    }

    if (intake.transcript) {
      var d = intake.transcript.doc;
      var labelled = d.lines.filter(function (l) { return l.speaker && l.timestamp; }).length;
      checks.appendChild(line(labelled === d.lines.length ? "ok" : "warn", [
        el("span", { class: "u-num", text: String(d.lines.length) }),
        " transcript lines read as " + intake.transcript.format + ". " +
        labelled + " carry a speaker and a timestamp."
      ]));
      var air = Object.keys(d.airtime_seconds || {}).length;
      if (!air) {
        checks.appendChild(line("warn", [
          "No per-workstream airtime in the file, so coverage cannot be measured. " +
          "Add airtime_seconds, or attribute lines to a workstream."
        ]));
      } else if (d.duration_seconds) {
        var total = Object.keys(d.airtime_seconds).reduce(function (a, k) { return a + d.airtime_seconds[k]; }, 0);
        checks.appendChild(line(total <= d.duration_seconds ? "ok" : "bad", [
          "Airtime totals ", el("span", { class: "u-num", text: mmss(total) }),
          " against a " + mmss(d.duration_seconds) + " meeting."
        ]));
      }
    }

    append(out, [el("h3", { class: "read__head", text: "What the files say" }), checks]);

    var d2 = derive();
    if (d2) {
      var found = el("div", { class: "read__list" });
      var det = d2.detections;

      det.quiet.forEach(function (q) {
        found.appendChild(line("bad", [
          wsLabel(q.ws) + " is under the coverage floor — ",
          el("span", { class: "u-num", text: mmss(q.airtime) }), " of airtime, ",
          el("span", { class: "u-num", text: String(q.transitions) }),
          " ticket transitions. Its state is unknown, not green."
        ]));
      });
      det.claimed.forEach(function (c) {
        found.appendChild(line("warn", [
          wsLabel(c.ws) + " spoke this week and recorded no ticket movement at all."
        ]));
      });
      det.growth.forEach(function (g) {
        found.appendChild(line("warn", [
          wsLabel(g.ws) + " opened more than it closed two weeks running — ",
          el("span", { class: "u-num", text: g.last_week }), " then ",
          el("span", { class: "u-num", text: g.this_week }), " opened against closed."
        ]));
      });
      det.staleness.forEach(function (st) {
        found.appendChild(line("warn", [
          wsLabel(st.ws) + " has ", el("span", { class: "u-num", text: String(st.n) }),
          " tickets with no transition in over " + STALE_DAYS + " days, the oldest ",
          el("span", { class: "u-num", text: st.worst.id }), " at ",
          el("span", { class: "u-num", text: String(st.worst.days) }), " days."
        ]));
      });

      if (!found.childNodes.length) {
        found.appendChild(line("ok", ["Nothing the export alone can see. The three detections found no material signal in " + d2.windowLabel + "."]));
      }

      append(out, [
        el("h3", { class: "read__head", text: "Found without a model, from " + d2.windowLabel }),
        found
      ]);
    }

    var ready = intake.tickets && !intake.tickets.missing.length && intake.transcript;
    var run = el("button", { type: "button", class: "btn", id: "intake-run", disabled: !ready },
                 "Download the run input");
    run.addEventListener("click", downloadBundle);

    var reset = el("button", { type: "button", class: "btn btn--quiet" }, "Clear");
    reset.addEventListener("click", function () {
      intake = { tickets: null, transcript: null };
      ["tickets", "transcript"].forEach(function (k) {
        var input = document.getElementById("in-" + k);
        if (input) input.value = "";
        setSlot(k, null, "Waiting for a file");
      });
      renderIntake();
    });

    append(out, [
      el("p", { class: "read__note" },
        ready
          ? ["Classifying each finding and scoring it against the anchors needs a model, and there is none at view time — no key, no server, no call. " +
             "The two prompt passes run offline against this file, and their output is committed as the week's register."]
          : ["Add both files to prepare a run. What is shown above needed no model; classification and scoring do."]),
      el("div", { class: "read__actions" }, [run, reset])
    ]);
  }

  function downloadBundle() {
    var d = derive();
    var payload = {
      generated: "Risk Radar intake, in-browser",
      window: d ? d.windowLabel : null,
      transcript: intake.transcript ? intake.transcript.doc : null,
      tickets: intake.tickets ? intake.tickets.rows : [],
      derived: d ? { by_workstream: d.streams, detections: d.detections } : null,
      next: "Run prompts/1-extract-classify.md then prompts/2-score.md over this file, then score.py."
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "risk-radar-run-input.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function takeFile(kind, file) {
    if (!file) return;
    setSlot(kind, null, "Reading " + file.name + "…");
    var reader = new FileReader();
    reader.onload = function () {
      try {
        if (kind === "tickets") {
          intake.tickets = readTickets(String(reader.result));
          setSlot(kind, intake.tickets.missing.length ? "bad" : "ok",
                  file.name + " — " + intake.tickets.rows.length + " rows");
        } else {
          intake.transcript = readTranscript(String(reader.result), file.name);
          setSlot(kind, "ok", file.name + " — " + intake.transcript.doc.lines.length + " lines");
        }
      } catch (e) {
        if (kind === "tickets") intake.tickets = null; else intake.transcript = null;
        setSlot(kind, "bad", file.name + " — could not be read: " + e.message);
      }
      renderIntake();
    };
    reader.onerror = function () { setSlot(kind, "bad", "could not be read"); };
    reader.readAsText(file);
  }

  function bindIntake() {
    ["tickets", "transcript"].forEach(function (kind) {
      var label = document.querySelector('.drop[data-kind="' + kind + '"]');
      var input = document.getElementById("in-" + kind);
      if (!label || !input) return;

      input.addEventListener("change", function () { takeFile(kind, input.files[0]); });

      ["dragenter", "dragover"].forEach(function (ev) {
        label.addEventListener(ev, function (e) {
          e.preventDefault();
          label.classList.add("is-over");
        });
      });
      ["dragleave", "dragend"].forEach(function (ev) {
        label.addEventListener(ev, function () { label.classList.remove("is-over"); });
      });
      label.addEventListener("drop", function (e) {
        e.preventDefault();
        label.classList.remove("is-over");
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          takeFile(kind, e.dataTransfer.files[0]);
        }
      });
    });
  }

  // ── delegation and hydration ─────────────────────────────────────────

  /* Every control is reached by delegation, so the same handlers drive markup
     built here and markup painted into the HTML at build time. */
  function bindControls() {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (!t || !t.closest) return;

      var wk = t.closest(".weeks__btn");
      if (wk) { goToWeek(Number(wk.getAttribute("data-week"))); return; }

      var adj = t.closest(".adj__btn[data-act]");
      if (!adj) return;
      var row = adj.closest(".row");
      var act = adj.getAttribute("data-act");
      if (act === "accepted") {
        setAcceptance(currentWeek, row.id.replace("item-", ""), act, null);
        refreshRow(row);
      } else {
        openNoteForm(row, act);
      }
    });
  }

  function acceptanceFromRow(row) {
    var override = acceptance[currentWeek + ":" + row.id.replace("item-", "")];
    if (override) return override;
    try { return JSON.parse(row.getAttribute("data-acc")); } catch (e) { return { state: "unaccepted" }; }
  }

  function openNoteForm(row, state) {
    var host = row.querySelector(".adj__form");
    var itemId = row.id.replace("item-", "");
    var acc = acceptanceFromRow(row);
    clear(host);
    host.hidden = false;

    var id = "note-" + state + "-" + itemId;
    var input = el("input", {
      type: "text", id: id, class: "adj__input",
      value: (acc.note && acc.state === state) ? acc.note : "",
      placeholder: state === "amended" ? "What you changed, and why" : "Why this is not a register item"
    });

    function commit() {
      var text = input.value.trim();
      setAcceptance(currentWeek, itemId, state, text ||
        (state === "amended" ? "Amended without a note." : "Rejected without a stated reason."));
      refreshRow(row);
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
      el("label", {
        class: "adj__label", "for": id,
        text: state === "amended"
          ? "Amendment. The run's own wording is kept and struck through; it is never erased."
          : "Reason for rejection. The row stays on the record with the reason attached."
      }),
      el("div", { class: "adj__row" }, [input, save, cancel])
    ]);
    input.focus();
  }

  /* Repaint one row's acceptance rather than the register, so adjudicating
     never destroys the page or needs the week's JSON. */
  function refreshRow(row) {
    var acc = acceptanceFromRow(row);
    var statement = (row.querySelector(".detail__block p") || {}).textContent || "";
    var fs = row.querySelector(".adj");
    fs.parentNode.replaceChild(
      adjudicateBlock({ id: row.id.replace("item-", ""), acceptance: acc, statement: statement }, currentWeek),
      fs
    );
    row.classList.toggle("is-rejected", acc.state === "rejected");
    refreshHeadCount();
  }

  function refreshHeadCount() {
    var rows = document.querySelectorAll(".row");
    var n = 0;
    Array.prototype.forEach.call(rows, function (r) {
      if (acceptanceFromRow(r).state === "unaccepted") n += 1;
    });
    var sub = document.getElementById("head-sub");
    if (!sub) return;
    sub.textContent = sub.textContent.replace(/\d+ not yet adjudicated/, n + " not yet adjudicated");
  }

  /* A page painted at build time is already correct: adopt it rather than
     rebuild it, and skip the fetch its week would otherwise need. */
  function staticWeek() {
    var v = document.body.getAttribute("data-static-week");
    return v ? Number(v) : null;
  }

  /* The painted markup carries the run's own acceptance. Anything this
     session has since decided lives in sessionStorage, so replay it over the
     painted rows on load: adjudications must survive a refresh. */
  function applyStoredAcceptance() {
    var touched = false;
    Array.prototype.forEach.call(document.querySelectorAll(".row"), function (row) {
      if (acceptance[currentWeek + ":" + row.id.replace("item-", "")]) {
        refreshRow(row);
        touched = true;
      }
    });
    if (!touched) refreshHeadCount();
  }

  function start() {
    bindControls();
    bindIntake();
    var week = weekFromHash() || staticWeek() || 3;
    if (staticWeek() === week) {
      currentWeek = week;
      applyStoredAcceptance();
      return;
    }
    show(week);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
