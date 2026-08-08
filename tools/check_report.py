#!/usr/bin/env python3
"""Run the P3 checks from the design plan against the built report.

    python3 -m http.server 8765 &
    python3 tools/check_report.py                    # http, all four weeks
    python3 tools/check_report.py --file             # the single-file build

Checks, one per "done when" row:

  RPT-02  every week reachable in one tap and directly by URL hash
  RPT-03  every group heading prints its scale
  RPT-04  with all disclosures closed, every row shows score+scale,
          workstream, control status, movement and source agreement
  RPT-05  one item walked end to end: quote with two lines of context either
          side, ticket field rows, board status, precedence and routing
  RPT-06  both totals recompute by hand from the printed factors
  RPT-07  acceptance reachable and legible on every row, at both viewports
  RPT-09  assurance gaps are the first group on every week
  NFR-03  320px and 390px, light and dark: no horizontal overflow, no
          clipped text, every text/background pair at least 4.5:1
  NFR-04  greyscale the page and type, band, movement, conflict and
          acceptance all still read

Exits 0 when everything passes.
"""

import argparse
import json
import os
import re
import sys

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BROWSER = "/opt/pw-browsers/chromium"
WEIGHTS = {"proximity": 0.35, "blast_radius": 0.25, "control_status": 0.25,
           "evidence_confidence": 0.15}

failures = []
passes = []


def check(ok, label, detail=""):
    (passes if ok else failures).append(label + (f" — {detail}" if detail else ""))
    print(("  ok   " if ok else "  FAIL ") + label + (f"  {detail}" if detail and not ok else ""))


CONTRAST_JS = """
() => {
  const srgb = c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
  const lum = ([r,g,b]) => 0.2126*srgb(r) + 0.7152*srgb(g) + 0.0722*srgb(b);
  const parse = s => { const m = s.match(/[\\d.]+/g); return m ? m.slice(0,3).map(Number) : null; };
  const alpha = s => { const m = s.match(/rgba?\\(([^)]+)\\)/); if (!m) return 1;
    const p = m[1].split(',').map(x => parseFloat(x)); return p.length > 3 ? p[3] : 1; };
  function bgOf(node) {
    for (let n = node; n; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && alpha(c) > 0.01) return parse(c);
    }
    return [255,255,255];
  }
  const bad = [];
  for (const n of document.querySelectorAll('body *')) {
    if (!n.offsetParent && n.tagName !== 'BODY') continue;
    const direct = Array.from(n.childNodes)
      .filter(c => c.nodeType === 3 && c.textContent.trim().length)
      .map(c => c.textContent.trim()).join(' ');
    if (!direct) continue;
    const cs = getComputedStyle(n);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const fg = parse(cs.color), bg = bgOf(n);
    if (!fg || !bg) continue;
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1,l2) + 0.05) / (Math.min(l1,l2) + 0.05);
    const px = parseFloat(cs.fontSize);
    const large = px >= 24 || (px >= 18.66 && parseInt(cs.fontWeight,10) >= 700);
    const need = large ? 3.0 : 4.5;
    if (ratio < need) bad.push({
      tag: n.tagName.toLowerCase(), cls: n.className && String(n.className).slice(0,40),
      text: direct.slice(0,44), ratio: Math.round(ratio*100)/100, need, px
    });
  }
  return bad;
}
"""

CLIP_JS = """
() => {
  const bad = [];
  for (const n of document.querySelectorAll('body *')) {
    if (!n.offsetParent) continue;
    const cs = getComputedStyle(n);
    if (cs.overflow === 'visible' && cs.overflowX === 'visible') continue;
    // Visually-hidden labels are 1x1 with a clip-path by design; they are
    // read by assistive tech, not clipped away from a sighted reader.
    if (cs.clipPath && cs.clipPath !== 'none') continue;
    if (n.clientWidth <= 1 || n.clientHeight <= 1) continue;
    if (n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1) {
      bad.push({ tag: n.tagName.toLowerCase(), cls: String(n.className).slice(0,40),
                 sw: n.scrollWidth, cw: n.clientWidth, sh: n.scrollHeight, ch: n.clientHeight });
    }
  }
  return bad;
}
"""

WIDE_JS = """
() => {
  const bad = [];
  const limit = document.documentElement.clientWidth + 1;
  for (const n of document.querySelectorAll('body *')) {
    if (!n.offsetParent) continue;
    const r = n.getBoundingClientRect();
    if (r.width > limit || r.right > limit + 0.5) {
      bad.push({ tag: n.tagName.toLowerCase(), cls: String(n.className).slice(0,40),
                 w: Math.round(r.width), right: Math.round(r.right), limit });
    }
  }
  return bad;
}
"""


def rows_meta(page):
    return page.evaluate("""
    () => Array.from(document.querySelectorAll('.row')).map(r => ({
      id: r.querySelector('.row__id').textContent.trim(),
      type: (r.className.match(/row--([a-z-]+)/) || [])[1],
      chips: Array.from(r.querySelectorAll('.chip')).map(c => c.textContent.trim()),
      score: (r.querySelector('.score__value') || {}).textContent || null,
      band: (r.querySelector('.score__band') || {}).textContent || null,
      counts: Array.from(r.querySelectorAll('.score__counts div')).map(d => d.textContent.trim()),
      attention: (r.querySelector('.score__attention') || {}).textContent || null,
      meta: Array.from(r.querySelectorAll('.row__meta dt')).map(
        (dt, i) => dt.textContent.trim() + '=' + (r.querySelectorAll('.row__meta dd')[i] || {}).textContent),
      metaText: (r.querySelector('.row__meta') || {}).textContent || '',
      acceptance: (r.querySelector('.adj__state') || {}).textContent || null,
      buttons: Array.from(r.querySelectorAll('.adj__btn')).map(b => ({
        label: b.textContent.trim(), w: Math.round(b.getBoundingClientRect().width),
        h: Math.round(b.getBoundingClientRect().height)
      })),
      openDisclosures: r.querySelectorAll('details[open]').length
    }))""")


def run_week(page, base, week, single_file):
    url = (base + "#week-" + str(week))
    page.goto(url, wait_until="load")
    page.wait_for_selector(".row", timeout=15000)
    page.wait_for_timeout(120)

    reg = json.load(open(os.path.join(ROOT, "runs", f"week-{week}-register.json"), encoding="utf-8"))
    print(f"\n--- week {week} ({'file' if single_file else 'http'}) ---")

    # RPT-02: reachable directly by hash.
    shown = page.eval_on_selector('.weekbar__btn[aria-current="true"]', "b => b.textContent.trim()")
    check(shown == "W" + str(week), f"RPT-02 week {week} reachable by URL hash", f"bar shows {shown}")

    # RPT-03: every group heading prints its scale.
    scales = page.eval_on_selector_all(".group__scale", "ns => ns.map(n => n.textContent.trim())")
    check(len(scales) == 4 and all(s.startswith("Scale:") for s in scales),
          "RPT-03 all four group headings print their scale", str(scales))

    # RPT-09: assurance gaps first.
    order = page.eval_on_selector_all(".group .group__name", "ns => ns.map(n => n.textContent.trim())")
    check(order == ["Assurance gaps", "Risks", "Issues", "Dependencies"],
          "RPT-09 assurance gaps are the first group", str(order))

    rows = rows_meta(page)
    check(len(rows) == len(reg["items"]),
          f"every item in the run is on the page ({len(reg['items'])})", f"rendered {len(rows)}")

    by_id = {i["id"]: i for i in reg["items"]}
    rpt04, closed = [], True
    for r in rows:
        item = by_id.get(r["id"])
        if not item:
            rpt04.append(f"{r['id']} not in the run")
            continue
        if r["openDisclosures"]:
            closed = False
        # score + the scale it sits on
        if item["type"] == "assurance-gap":
            if not r["counts"]:
                rpt04.append(f"{r['id']} no coverage counts")
        else:
            if not (r["score"] or "").strip():
                rpt04.append(f"{r['id']} no score")
            if not (r["band"] or "").strip():
                rpt04.append(f"{r['id']} no scale word beside the score")
        if not (r["attention"] or "").startswith("attention"):
            rpt04.append(f"{r['id']} no attention")
        meta = r["metaText"]
        for need in ("Workstream", "Owner", "Control", "Sources"):
            if need not in meta:
                rpt04.append(f"{r['id']} meta missing {need}")
        if "source type" not in meta:
            rpt04.append(f"{r['id']} no source agreement")
        # movement word present as text, not only colour
        move = {"new": "New", "worsening": "Worsening", "improving": "Improving", "stable": "Stable",
                "resolved": "Resolved", "returned": "Returned", "reclassified": "Reclassified"}[item["movement"]["state"]]
        if not any(move in c for c in r["chips"]):
            rpt04.append(f"{r['id']} movement word {move!r} not in chips {r['chips']}")
        # NFR-04: type word present
        if not any(c.startswith(("Risk", "Issue", "Dependency", "Assurance gap")) for c in r["chips"]):
            rpt04.append(f"{r['id']} type word missing from chips")
        # conflict conveyed as a word
        if item.get("contradiction", {}).get("present") and "Sources conflict" not in r["chips"]:
            rpt04.append(f"{r['id']} conflict not stated as a word")
        if item["type"] == "dependency" and item["blocking"] and "Blocking" not in r["chips"]:
            rpt04.append(f"{r['id']} blocking not stated as a word")
        # RPT-07
        if not (r["acceptance"] or "").strip():
            rpt04.append(f"{r['id']} no acceptance state word")
        if len(r["buttons"]) != 3:
            rpt04.append(f"{r['id']} acceptance controls not all three")
        if len(r["chips"]) > 5:
            rpt04.append(f"{r['id']} more than five chips")

    check(closed, "RPT-04 all disclosures start closed")
    check(not rpt04, "RPT-04 / NFR-04 / RPT-07 every row states its five facts as words",
          "; ".join(rpt04[:4]))

    # RPT-06: recompute both totals from the printed factors.
    bad_math = []
    for item in reg["items"]:
        f = item["attention_factors"]
        want = round(sum(f[k] * w for k, w in WEIGHTS.items()), 2)
        if abs(item["computed"]["attention"] - want) > 1e-9:
            bad_math.append(f"{item['id']} attention")
        if item["type"] == "risk":
            if item["computed"]["exposure"] != item["impact"] * item["likelihood"]:
                bad_math.append(f"{item['id']} exposure")
    check(not bad_math, "RPT-06 both totals recompute from the printed factors", "; ".join(bad_math))

    return rows


def walk_one_item(page, base):
    """RPT-05, end to end on the week 3 conflict."""
    print("\n--- RPT-05: walking RK-02 in week 3 end to end ---")
    page.goto(base + "#week-3", wait_until="load")
    page.wait_for_selector("#item-RK-02", timeout=15000)
    page.click("#item-RK-02 .row__evidence > summary")
    page.wait_for_selector("#item-RK-02 .panel", timeout=5000)

    got = page.evaluate("""
    () => {
      const r = document.getElementById('item-RK-02');
      const lines = Array.from(r.querySelectorAll('.lines__line'));
      const fieldKeys = Array.from(r.querySelectorAll('.fields__k')).map(n => n.textContent.trim());
      const conflict = r.querySelector('.conflict');
      const srcTypes = Array.from(r.querySelectorAll('.src__type')).map(n => n.textContent.trim());
      const anchors = Array.from(r.querySelectorAll('.sum details')).length;
      return {
        contextLines: lines.length,
        citedLines: lines.filter(l => l.classList.contains('is-cited')).length,
        everyLineHasSpeakerAndStamp: lines.every(l =>
          l.querySelector('.lines__who') && l.querySelector('.lines__stamp')),
        fieldKeys, srcTypes, anchors,
        conflictText: conflict ? conflict.textContent : '',
        sums: Array.from(r.querySelectorAll('.sum__line')).map(n => n.textContent.trim())
      };
    }""")

    check(got["contextLines"] == 5 and got["citedLines"] == 1,
          "RPT-05 cited transcript line with two lines either side",
          f"{got['contextLines']} lines, {got['citedLines']} cited")
    check(got["everyLineHasSpeakerAndStamp"],
          "RPT-05 speaker role and timestamp on every transcript line")
    for k in ("status", "status changed", "days since transition", "blocked by", "due"):
        check(k in got["fieldKeys"], f"RPT-05 ticket field row: {k}")
    check(any(s.startswith("Board") for s in got["srcTypes"]),
          "RPT-05 board status printed beside the other sources", str(got["srcTypes"]))
    check("Precedence" in got["conflictText"] and "Routed to" in got["conflictText"],
          "RPT-05 / EVI-03 precedence and routing stated")
    check(got["anchors"] == 4, "RPT-06 each attention factor expands to its anchor",
          f"{got['anchors']} expandable factors")
    check(any("exposure" in s for s in got["sums"]) and any("attention" in s for s in got["sums"]),
          "RPT-06 both totals printed as a worked sum")

    anchor_text = page.eval_on_selector(
        "#item-RK-02 .sum details:first-of-type", "d => { d.open = true; return d.textContent; }")
    check("Within 2 weeks" in anchor_text, "RPT-06 anchor sentence reachable per factor")


def viewport_checks(page, base, width, scheme):
    page.emulate_media(color_scheme=scheme)
    page.set_viewport_size({"width": width, "height": 900})
    page.goto(base + "#week-3", wait_until="load")
    page.wait_for_selector(".row", timeout=15000)
    page.wait_for_timeout(150)
    label = f"NFR-03 {width}px {scheme}"

    doc = page.evaluate(
        "() => ({sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,"
        " bsw: document.body.scrollWidth})")
    check(doc["sw"] <= doc["cw"], f"{label}: no horizontal document overflow",
          f"scrollWidth {doc['sw']} vs clientWidth {doc['cw']}")

    wide = page.evaluate(WIDE_JS)
    check(not wide, f"{label}: nothing wider than the viewport",
          "; ".join(f"{w['tag']}.{w['cls']} {w['w']}px" for w in wide[:3]))

    clipped = page.evaluate(CLIP_JS)
    check(not clipped, f"{label}: no clipped content",
          "; ".join(f"{c['tag']}.{c['cls']} {c['sw']}>{c['cw']}" for c in clipped[:3]))

    low = page.evaluate(CONTRAST_JS)
    check(not low, f"{label}: every pair meets WCAG AA",
          "; ".join(f"{c['tag']}.{c['cls']} {c['ratio']}:1 need {c['need']} [{c['text']}]" for c in low[:4]))

    if width < 900:
        vis = page.evaluate("""
        () => {
          const rows = Array.from(document.querySelectorAll('.row'));
          return {
            allVisible: rows.every(r => r.querySelectorAll('.adj__btn').length === 3 &&
              Array.from(r.querySelectorAll('.adj__btn')).every(b => b.offsetParent !== null)),
            smallest: Math.min(...rows.flatMap(r => Array.from(r.querySelectorAll('.adj__btn'))
              .map(b => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))))
          };
        }""")
        check(vis["allVisible"], f"{label}: RPT-07 acceptance visible on every row, never behind a menu")
        check(vis["smallest"] >= 43.5, f"{label}: hit targets at least 44px", f"smallest {vis['smallest']}")


def greyscale_check(page, base):
    print("\n--- NFR-04: greyscale ---")
    page.emulate_media(color_scheme="light")
    page.set_viewport_size({"width": 1180, "height": 1000})
    page.goto(base + "#week-3", wait_until="load")
    page.wait_for_selector(".row", timeout=15000)
    # Emulate achromatopsia rather than injecting a filter: it is the real
    # condition being designed for, and it does not need an inline style,
    # which the production Content-Security-Policy correctly refuses.
    cdp = page.context.new_cdp_session(page)
    cdp.send("Emulation.setEmulatedVisionDeficiency", {"type": "achromatopsia"})
    words = page.evaluate("""
    () => {
      const t = document.body.innerText;
      return {
        type: ['Risk','Issue','Dependency','Assurance gap'].every(w => t.includes(w)),
        band: ['critical band','high band','medium band'].some(w => t.includes(w)),
        movement: ['Worsening','Stable','New','Resolved'].every(w => t.includes(w)),
        conflict: t.includes('Sources conflict'),
        blocking: t.includes('Blocking'),
        acceptance: ['Unaccepted','Accepted'].every(w => t.includes(w)),
        scales: (t.match(/Scale:/g) || []).length
      };
    }""")
    for k, v in words.items():
        if k == "scales":
            check(v == 4, "NFR-04 greyscale: four group scales still read", f"{v} found")
        else:
            check(bool(v), f"NFR-04 greyscale: {k} still reads as a word")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8765/index.html")
    ap.add_argument("--file", action="store_true", help="check the single-file build over file://")
    args = ap.parse_args()

    base = args.base
    single = False
    if args.file:
        base = "file://" + os.path.join(ROOT, "risk-radar.html")
        single = True

    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=BROWSER)
        page = browser.new_page(viewport={"width": 1180, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append("console." + m.type + ": " + m.text)
                if m.type == "error" else None)

        for week in (1, 2, 3, 4):
            run_week(page, base, week, single)

        walk_one_item(page, base)

        for width in (320, 390):
            for scheme in ("light", "dark"):
                print(f"\n--- {width}px {scheme} ---")
                viewport_checks(page, base, width, scheme)
        print("\n--- 1180px, both schemes ---")
        for scheme in ("light", "dark"):
            viewport_checks(page, base, 1180, scheme)

        greyscale_check(page, base)

        check(not errors, "no page errors or console errors", "; ".join(errors[:3]))
        browser.close()

    print(f"\n{len(passes)} passed, {len(failures)} failed")
    if failures:
        print("\nfailures:")
        for f in failures:
            print("  - " + f)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
