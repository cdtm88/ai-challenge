#!/usr/bin/env python3
"""Confirm the register is readable with JavaScript switched off entirely.

    python3 -m http.server 8765 &
    python3 tools/check_noscript.py

JavaScript is required to switch week, adjudicate and open the coverage
table. It is not required to read the register: the default week is painted
into index.html by build.py, and <details> opens without script, so the
evidence and the arithmetic are reachable too.
"""

import argparse
import sys

from playwright.sync_api import sync_playwright

BROWSER = "/opt/pw-browsers/chromium"
GROUPS = ["Assurance gaps", "Risks", "Issues", "Dependencies"]
SCALES = [
    "coverage counts — not scored",
    "exposure = impact × likelihood, 1–25",
    "impact 1–5 — no likelihood, it has occurred",
    "criticality 1–5 — blocking listed first",
]

FACTS_JS = """
() => {
  const out = [];
  for (const r of document.querySelectorAll('.row')) {
    const id = (r.querySelector('.row__id') || {}).textContent || '?';
    if (r.querySelector('details[open]')) out.push(id + ': a disclosure starts open');
    const meta = (r.querySelector('.row__meta') || {}).textContent || '';
    const score = (r.querySelector('.row__score') || {}).textContent || '';
    const chips = Array.from(r.querySelectorAll('.chip')).map(c => c.textContent);
    if (!/Workstream/.test(meta)) out.push(id + ': no workstream');
    if (!/Control/.test(meta)) out.push(id + ': no control status');
    if (!/source type/.test(meta)) out.push(id + ': no source agreement');
    if (!/attention/.test(score)) out.push(id + ': no score block');
    if (!/New|Worsening|Improving|Stable|Resolved|Returned|Reclassified/.test(chips.join(' ')))
      out.push(id + ': no movement word');
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
                                  viewport={"width": 1180, "height": 900})
        page = ctx.new_page()
        page.goto(args.base, wait_until="load")
        page.wait_for_timeout(250)

        rows = page.locator(".row").count()
        check(rows > 0, "the register renders at all", f"{rows} rows")

        names = page.eval_on_selector_all(".group .group__name",
                                          "n => n.map(x => x.textContent.trim())")
        check(names == GROUPS, "four groups in the fixed order", str(names))

        text = page.locator("body").inner_text()
        for s in SCALES:
            check(s in text, f"group scale printed: {s[:38]}")

        check(not page.evaluate(FACTS_JS), "every row states its five facts",
              "; ".join(page.evaluate(FACTS_JS)[:3]))

        panels = page.locator(".panel").count()
        check(panels == rows * 2, "evidence and arithmetic panels are in the document",
              f"{panels} panels for {rows} rows")

        lines = page.locator(".lines__line").count()
        check(lines > 0, "transcript context is in the document", f"{lines} lines")

        conflicts = page.locator(".conflict").count()
        check(conflicts > 0, "contradictions with precedence and routing are present",
              f"{conflicts} blocks")

        gaps = page.locator("#omissions-list .omissions__item").count()
        check(gaps > 0, "the omissions strip is present", f"{gaps} entries")

        # <details> opens with no script at all.
        page.eval_on_selector("#register details", "d => d.setAttribute('open','')")
        opened = page.locator("#register details[open] .panel").count()
        check(opened > 0, "a disclosure opens and shows its panels without script")

        browser.close()

    print(f"\n{'all no-script checks pass' if not failures else str(len(failures)) + ' failed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
