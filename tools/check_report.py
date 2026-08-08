#!/usr/bin/env python3
"""Check the report against what it promises.

    python3 -m http.server 8765 &
    python3 tools/check_report.py                    # http, all four weeks
    python3 tools/check_report.py --file             # the single-file build

What is checked:

  week switching   every week reachable in one action and directly by hash
  sections         five, in fixed order, each stating its scale
  the row          a number, its scale word, a title, and one meta line that
                   carries the workstream and nothing beyond the permitted set
  the disclosure   statement, evidence, assessment and acceptance for each row
  contradiction    precedence named and the contradiction routed
  arithmetic       both totals recompute by hand from the printed factors
  overflow         at 320, 390 and 660px in both colour schemes, with
                   overflow-x forced visible so a clipped page cannot report
                   clean, the document is never wider than the viewport and no
                   element's right edge crosses it
  contrast         every text/background pair meets WCAG AA
  greyscale        type, band, movement, conflict and acceptance all read as
                   words with colour emulated away
  light lock       a dark-scheme viewer still gets the light palette
"""

import argparse
import json
import os
import sys

from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BROWSER = "/opt/pw-browsers/chromium"
WEIGHTS = {"proximity": 0.35, "blast_radius": 0.25, "control_status": 0.25,
           "evidence_confidence": 0.15}

SECTIONS = ["Assurance gaps", "Risks", "Issues", "Dependencies", "Closed"]
SCALES = ["coverage counts, not scored", "exposure, 1 to 25", "impact, 1 to 5",
          "criticality, 1 to 5", "resolved this week"]

# The meta line is a closed vocabulary. Anything else on it is a regression.
MOVE_WORDS = ("New", "Worsening", "Improving", "Resolved", "Returned", "Reclassified")
META_EXTRAS = ("Sources conflict", "Unmanaged", "No owner", "From tickets only")

failures = []
passes = []


def check(ok, label, detail=""):
    (passes if ok else failures).append(label + (f" — {detail}" if detail else ""))
    print(("  ok   " if ok else "  FAIL ") + label + (f"  {detail}" if detail and not ok else ""))


# --------------------------------------------------------------------------
# browser-side probes
# --------------------------------------------------------------------------

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
    if (n.closest('details:not([open])')) continue;
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
      tag: n.tagName.toLowerCase(), cls: String(n.className).slice(0,40),
      text: direct.slice(0,44), ratio: Math.round(ratio*100)/100, need
    });
  }
  return bad;
}
"""

# Force overflow visible everywhere first. A page that hides its overflow
# reports scrollWidth === clientWidth while a real phone clips the content;
# measuring after the mask is off is the only honest test.
OVERFLOW_JS = """
() => {
  const patch = document.createElement('style');
  patch.id = '__overflow_probe';
  patch.textContent = '*,*::before,*::after{overflow-x:visible !important;overflow:visible !important}';
  document.head.appendChild(patch);
  void document.body.offsetWidth;

  const vw = window.innerWidth;
  const wide = [];
  for (const n of document.querySelectorAll('body *')) {
    if (!n.offsetParent) continue;
    if (n.closest('details:not([open])')) continue;
    const r = n.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > vw + 0.5 || r.width > vw + 0.5) {
      wide.push({ tag: n.tagName.toLowerCase(), cls: String(n.className).slice(0,44),
                  right: Math.round(r.right), w: Math.round(r.width) });
    }
  }
  const out = { vw, scrollWidth: document.documentElement.scrollWidth,
                bodyScroll: document.body.scrollWidth, wide: wide.slice(0, 6),
                wideCount: wide.length };
  patch.remove();
  return out;
}
"""

ROWS_JS = """
() => Array.from(document.querySelectorAll('.row')).map(r => ({
  id: (r.querySelector('.row__more > summary') || {}).textContent || '',
  num: (r.querySelector('.row__num') || {}).textContent || '',
  scale: (r.querySelector('.row__scale') || {}).textContent || '',
  title: (r.querySelector('.row__title') || {}).textContent || '',
  meta: Array.from(r.querySelectorAll('.row__meta > span:not(.sep)')).map(s => s.textContent.trim()),
  open: r.querySelectorAll('details[open]').length,
  detailText: (r.querySelector('.detail') || {}).textContent || '',
  buttons: Array.from(r.querySelectorAll('.adj__btn[data-act]')).map(b => ({
    label: b.textContent.trim(),
    w: Math.round(b.getBoundingClientRect().width),
    h: Math.round(b.getBoundingClientRect().height)
  })),
  state: (r.querySelector('.adj__state') || {}).textContent || ''
}))
"""


def load(page, base, week):
    page.goto(f"{base}#week-{week}", wait_until="load")
    page.wait_for_selector(".row", timeout=15000)
    page.wait_for_timeout(150)


def run_week(page, base, week):
    load(page, base, week)
    reg = json.load(open(os.path.join(ROOT, "runs", f"week-{week}-register.json"), encoding="utf-8"))
    print(f"\n--- week {week} ---")

    current = page.eval_on_selector('.weeks__btn[aria-current="true"]', "b => b.textContent.trim()")
    check(current == f"Week {week}", f"week {week} reachable by URL hash", f"bar shows {current}")

    names = page.eval_on_selector_all(".section__name", "n => n.map(x => x.textContent.trim())")
    check(names == SECTIONS, "five sections in fixed order", str(names))
    scales = page.eval_on_selector_all(".section__scale", "n => n.map(x => x.textContent.trim())")
    check(scales == SCALES, "every section states its scale", str(scales))

    rows = page.evaluate(ROWS_JS)
    check(len(rows) == len(reg["items"]),
          f"every item in the run is on the page ({len(reg['items'])})", f"rendered {len(rows)}")

    by_id = {i["id"]: i for i in reg["items"]}
    bad, closed_ok = [], True
    for r in rows:
        rid = r["id"].split("·")[0].strip()
        item = by_id.get(rid)
        if not item:
            bad.append(f"{rid} not in the run")
            continue
        if r["open"]:
            closed_ok = False
        if not r["num"].strip():
            bad.append(f"{rid}: no number")
        if not r["scale"].strip():
            bad.append(f"{rid}: no scale word")
        if not r["title"].strip():
            bad.append(f"{rid}: no title")
        if not r["meta"]:
            bad.append(f"{rid}: no meta line")
            continue

        # the workstream leads, and nothing beyond the permitted set follows
        ws = r["meta"][0]
        if ws.lower() != item["workstream"].replace("-", " "):
            bad.append(f"{rid}: meta starts {ws!r}, not the workstream")
        for part in r["meta"][1:]:
            allowed = part.startswith(MOVE_WORDS) or part in META_EXTRAS
            if not allowed:
                bad.append(f"{rid}: meta carries {part!r}, outside the permitted set")
        if item["movement"]["state"] == "stable" and any(p.startswith(MOVE_WORDS) for p in r["meta"][1:]):
            bad.append(f"{rid}: stable item prints a movement word")

        # everything triage does not need is behind the disclosure
        d = r["detailText"]
        for need, label in (("Evidence", "evidence"), ("Assessment", "assessment"),
                            ("Owner", "owner"), ("Attention", "attention")):
            if need not in d:
                bad.append(f"{rid}: disclosure has no {label}")
        if len(r["buttons"]) != 3:
            bad.append(f"{rid}: acceptance controls not all three")
        if not r["state"].strip():
            bad.append(f"{rid}: no acceptance state word")

    check(closed_ok, "every row starts collapsed")
    check(not bad, "rows carry a number, a scale word, a title and one permitted meta line",
          "; ".join(bad[:4]))

    # both totals recompute by hand from the printed factors
    math_bad = []
    for item in reg["items"]:
        f = item["attention_factors"]
        want = round(sum(f[k] * w for k, w in WEIGHTS.items()), 2)
        if abs(item["computed"]["attention"] - want) > 1e-9:
            math_bad.append(f"{item['id']} attention")
        if item["type"] == "risk" and item["computed"]["exposure"] != item["impact"] * item["likelihood"]:
            math_bad.append(f"{item['id']} exposure")
    check(not math_bad, "both totals recompute from the printed factors", "; ".join(math_bad))


def walk_one_item(page, base):
    print("\n--- the conflicted integration risk, end to end ---")
    load(page, base, 3)
    page.eval_on_selector("#item-RK-02 .row__more", "d => d.open = true")
    page.wait_for_timeout(150)

    got = page.evaluate("""
    () => {
      const r = document.getElementById('item-RK-02');
      const note = (r.querySelector('.note-line.is-conflict') || {}).textContent || '';
      return {
        conflict: note,
        quote: (r.querySelector('.quote__text') || {}).textContent || '',
        who: (r.querySelector('.quote__who') || {}).textContent || '',
        ctx: r.querySelectorAll('.quote__ctx-line').length,
        also: (r.querySelector('.also') || {}).textContent || '',
        heads: Array.from(r.querySelectorAll('.detail__head')).map(n => n.textContent.trim()),
        dts: Array.from(r.querySelectorAll('.dl dt')).map(n => n.textContent.trim()),
        sub: (r.querySelector('.dl__sub') || {}).textContent || ''
      };
    }""")

    check("Sources conflict" in got["conflict"], "contradiction is named")
    check("precedent" in got["conflict"], "precedence stated", got["conflict"][:60])
    check("Routed to" in got["conflict"], "contradiction routed")
    check(got["quote"].strip().startswith("“"), "primary source is the transcript quote in full")
    check("week 3" in got["who"] and ":" in got["who"],
          "speaker, week, line and timestamp on the quote", got["who"])
    check(got["ctx"] == 4, "two transcript lines either side", f"{got['ctx']} context lines")
    check(got["also"].startswith("Also:"), "remaining sources on one compact line", got["also"][:60])
    check(got["heads"] == ["Statement", "Evidence", "Assessment"],
          "disclosure blocks in order", str(got["heads"]))
    check(got["dts"][:2] == ["Exposure", "Attention"],
          "assessment leads with the scale then attention", str(got["dts"]))
    check(got["sub"].count("×") == 4, "four attention factors on one sub-line", got["sub"])


def viewport_checks(page, base, width, scheme):
    page.emulate_media(color_scheme=scheme)
    page.set_viewport_size({"width": width, "height": 900})
    load(page, base, 3)
    label = f"{width}px {scheme}"

    r = page.evaluate(OVERFLOW_JS)
    check(r["scrollWidth"] == r["vw"],
          f"{label}: document is exactly the viewport width, overflow unmasked",
          f"scrollWidth {r['scrollWidth']} vs innerWidth {r['vw']}")
    check(r["wideCount"] == 0, f"{label}: no element crosses the viewport edge",
          "; ".join(f"{w['tag']}.{w['cls']} right={w['right']}" for w in r["wide"][:3]))

    low = page.evaluate(CONTRAST_JS)
    check(not low, f"{label}: every text pair meets WCAG AA",
          "; ".join(f"{c['tag']}.{c['cls']} {c['ratio']}:1 need {c['need']} [{c['text']}]" for c in low[:4]))

    paper = page.eval_on_selector("body", "n => getComputedStyle(n).backgroundColor")
    check(paper == "rgb(255, 255, 255)", f"{label}: light palette locked", paper)

    if width < 700:
        vis = page.evaluate("""
        () => {
          const b = Array.from(document.querySelectorAll('.adj__btn[data-act]'));
          return { n: b.length,
                   smallest: b.length ? Math.min(...b.map(x => x.getBoundingClientRect().height)) : 99 };
        }""")
        check(vis["smallest"] >= 43.5, f"{label}: acceptance targets at least 44px tall",
              f"smallest {vis['smallest']}")


def greyscale_check(page, base):
    print("\n--- greyscale ---")
    page.emulate_media(color_scheme="light")
    page.set_viewport_size({"width": 660, "height": 1000})
    load(page, base, 3)
    cdp = page.context.new_cdp_session(page)
    cdp.send("Emulation.setEmulatedVisionDeficiency", {"type": "achromatopsia"})

    # textContent, not innerText: a collapsed disclosure still has to read as
    # words, and the reader can open it without colour telling them to.
    words = page.evaluate("""
    () => {
      const t = document.body.textContent;
      return {
        type: ['Assurance gaps','Risks','Issues','Dependencies','Closed'].every(w => t.includes(w)),
        band: ['Critical','High','Medium'].every(w => t.includes(w)),
        movement: ['Worsening','New','Resolved'].every(w => t.includes(w)),
        conflict: t.includes('Sources conflict'),
        management: t.includes('Unmanaged') || t.includes('No owner'),
        blocking: t.includes('Blocking'),
        acceptance: ['Unaccepted','Accepted'].every(w => t.includes(w)),
        alert: t.includes('did not report') && t.includes('unknown, not green'),
        scales: ['exposure, 1 to 25','impact, 1 to 5','criticality, 1 to 5'].every(w => t.includes(w))
      };
    }""")
    for k, v in words.items():
        check(bool(v), f"greyscale: {k} still reads as words")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8765/index.html")
    ap.add_argument("--file", action="store_true", help="check the single-file build over file://")
    args = ap.parse_args()

    base = "file://" + os.path.join(ROOT, "risk-radar.html") if args.file else args.base

    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=BROWSER)
        page = browser.new_page(viewport={"width": 660, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append("console." + m.type + ": " + m.text)
                if m.type == "error" else None)

        for week in (1, 2, 3, 4):
            run_week(page, base, week)

        walk_one_item(page, base)

        for width in (320, 390, 660):
            for scheme in ("light", "dark"):
                print(f"\n--- {width}px {scheme} ---")
                viewport_checks(page, base, width, scheme)

        greyscale_check(page, base)

        print("\n--- surface inventory ---")
        page.set_viewport_size({"width": 660, "height": 1000})
        load(page, base, 3)
        inv = page.evaluate("""
        () => {
          const m = {};
          for (const n of document.querySelectorAll('button,a,input,select,textarea,summary,[role=button]')) {
            const k = n.tagName.toLowerCase() + '.' + (String(n.className).split(' ')[0] || '-');
            m[k] = (m[k] || 0) + 1;
          }
          return m;
        }""")
        for k, v in sorted(inv.items()):
            print(f"  {v:>4}  {k}")
        stray = [k for k in inv if not any(
            k.startswith(p) for p in ("button.weeks__btn", "button.adj__btn", "summary."))]
        check(not stray, "no control outside the permitted set", str(stray))

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
