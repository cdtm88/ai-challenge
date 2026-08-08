#!/usr/bin/env python3
"""Confirm the register is readable with JavaScript switched off entirely.

    python3 -m http.server 8765 &
    python3 tools/check_noscript.py

JavaScript is required to switch week and to adjudicate. It is not required
to read the register: the default week is painted into index.html by
build.py, and <details> opens without script, so every row's statement,
evidence and assessment are reachable too.
"""

import argparse
import sys

from playwright.sync_api import sync_playwright

BROWSER = "/opt/pw-browsers/chromium"
SECTIONS = ["Assurance gaps", "Risks", "Issues", "Dependencies", "Closed"]
SCALES = ["coverage counts, not scored", "exposure, 1 to 25", "impact, 1 to 5",
          "criticality, 1 to 5", "resolved this week"]

ROWS_JS = """
() => {
  const out = [];
  for (const r of document.querySelectorAll('.row')) {
    const id = ((r.querySelector('.row__more > summary') || {}).textContent || '?').split('·')[0].trim();
    if (!(r.querySelector('.row__num') || {}).textContent) out.push(id + ': no number');
    if (!(r.querySelector('.row__scale') || {}).textContent) out.push(id + ': no scale word');
    if (!(r.querySelector('.row__title') || {}).textContent) out.push(id + ': no title');
    if (!r.querySelector('.row__meta > span')) out.push(id + ': no meta line');
    const d = (r.querySelector('.detail') || {}).textContent || '';
    for (const need of ['Statement', 'Evidence', 'Assessment', 'Owner', 'Attention']) {
      if (!d.includes(need)) out.push(id + ': disclosure has no ' + need);
    }
    if (r.querySelectorAll('.adj__btn[data-act]').length !== 3) out.push(id + ': acceptance controls missing');
  }
  return out;
}
"""

failures = []


def check(ok, label, detail=""):
    print(("  ok   " if ok else "  FAIL ") + label + (f"  {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(label + (f" — {detail}" if detail else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8765/index.html")
    args = ap.parse_args()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=BROWSER)
        ctx = browser.new_context(java_script_enabled=False,
                                  viewport={"width": 660, "height": 900})
        page = ctx.new_page()
        page.goto(args.base, wait_until="load")
        page.wait_for_timeout(250)

        rows = page.locator(".row").count()
        check(rows > 0, "the register renders at all", f"{rows} rows")

        names = page.eval_on_selector_all(".section__name", "n => n.map(x => x.textContent.trim())")
        check(names == SECTIONS, "five sections in fixed order", str(names))

        scales = page.eval_on_selector_all(".section__scale", "n => n.map(x => x.textContent.trim())")
        check(scales == SCALES, "every section states its scale", str(scales))

        bad = page.evaluate(ROWS_JS)
        check(not bad, "every row carries its number, title, meta line and full disclosure",
              "; ".join(bad[:3]))

        alert = page.locator("#alert").inner_text() if page.locator("#alert").count() else ""
        check("did not report" in alert, "the absence alert is present", repr(alert[:60]))

        ctxlines = page.locator(".quote__ctx-line").count()
        check(ctxlines > 0, "transcript context is in the document", f"{ctxlines} lines")

        conflicts = page.locator(".note-line.is-conflict").count()
        check(conflicts > 0, "contradictions with precedence and routing are present",
              f"{conflicts} notes")

        gaps = page.locator("#omissions-list .omit").count()
        check(gaps > 0, "the omitted list is in the document", f"{gaps} entries")

        cov = page.locator("#coverage-detail .cov__row").count()
        check(cov > 0, "the coverage table is in the document", f"{cov} rows")

        # The intake reads files in the browser, so it is the one part that
        # genuinely needs script. It has to say so rather than fail silently.
        body = page.locator("body").inner_text()
        check("needs JavaScript" in body and "The register below does not" in body,
              "the intake says it needs JavaScript and the register does not")
        out = page.locator("#intake-out").inner_text().strip()
        check(out == "", "the intake claims nothing it cannot deliver", repr(out[:60]))

        # <details> opens with no script at all.
        page.eval_on_selector(".row__more", "d => d.setAttribute('open','')")
        opened = page.locator(".row__more[open] .detail").count()
        check(opened > 0, "a disclosure opens and shows its detail without script")

        browser.close()

    print(f"\n{'all no-script checks pass' if not failures else str(len(failures)) + ' failed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
