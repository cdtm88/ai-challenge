#!/usr/bin/env python3
"""Paint the default week into index.html so the register is readable with no
JavaScript at all.

    python3 build.py            # write the static week into index.html
    python3 build.py --check    # fail if index.html is stale
    python3 build.py --week 2   # choose a different default week

The markup is not reimplemented here. app.js renders the week once in a
headless browser and the result is copied into index.html verbatim, so the
static page and the scripted page cannot drift: one produced the other.
app.js then adopts the painted week instead of rebuilding it, and handles
week switching, disclosure and acceptance only.

The disclosures are painted open and then closed again, so every <details>
carries its evidence and arithmetic in the document. <details> needs no
script to open, so a reader without JavaScript still reaches the evidence.
"""

import argparse
import functools
import http.server
import os
import re
import shutil
import socketserver
import sys
import tempfile
import threading

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_WEEK = 3

# Every region app.js writes into. Emptied to build the shell, refilled from
# the render.
REGIONS = [
    "head-sub", "weekbar", "alert", "register",
    "coverage-detail", "omissions-list", "omissions-count",
]

BEGIN = "<!-- static: painted by build.py, do not edit by hand -->"


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def inner_span(html, rid):
    """Return (start, end) of the inner HTML of the element carrying `rid`.

    Counts tag depth rather than matching to the first close tag: a painted
    region is full of nested elements of the same name, and a non-greedy
    regex would stop at the first one and shred the document.
    """
    open_tag = re.search(r'<(\w+)([^>]*\bid="' + re.escape(rid) + r'"[^>]*)>', html)
    if not open_tag:
        return None
    name = open_tag.group(1)
    depth, pos = 1, open_tag.end()
    scan = re.compile(r"</?" + name + r"\b[^>]*>", re.I)
    while True:
        tag = scan.search(html, pos)
        if not tag:
            raise SystemExit(f"unbalanced markup around id={rid!r}")
        depth += -1 if tag.group(0).startswith("</") else 1
        if depth == 0:
            return open_tag.end(), tag.start()
        pos = tag.end()


def set_inner(html, rid, inner):
    span = inner_span(html, rid)
    if span is None:
        return html
    return html[: span[0]] + inner + html[span[1]:]


def strip_static(html):
    """Return index.html with every painted region emptied."""
    html = html.replace(BEGIN + "\n", "")
    html = re.sub(r'(<body[^>]*?) data-static-week="\d+"', r"\1", html)
    for rid in REGIONS:
        html = set_inner(html, rid, "")
    return html


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve(directory):
    handler = functools.partial(_Quiet, directory=directory)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    httpd.allow_reuse_address = True
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, httpd.server_address[1]


def render(week, shell_html):
    """Render `week` with app.js and return the painted regions."""
    from playwright.sync_api import sync_playwright

    tmp = tempfile.mkdtemp(prefix="risk-radar-build-")
    try:
        with open(os.path.join(tmp, "index.html"), "w", encoding="utf-8") as fh:
            fh.write(shell_html)
        for name in ("styles.css", "app.js"):
            shutil.copy(os.path.join(ROOT, name), os.path.join(tmp, name))
        for sub in ("runs", "data"):
            shutil.copytree(os.path.join(ROOT, sub), os.path.join(tmp, sub))

        httpd, port = serve(tmp)
        try:
            with sync_playwright() as pw:
                browser = pw.chromium.launch(executable_path="/opt/pw-browsers/chromium")
                page = browser.new_page()
                errors = []
                page.on("pageerror", lambda e: errors.append(str(e)))
                page.goto(f"http://127.0.0.1:{port}/index.html#week-{week}", wait_until="load")
                page.wait_for_selector(".row", timeout=20000)
                page.wait_for_timeout(300)
                if errors:
                    raise SystemExit("render failed: " + "; ".join(errors[:3]))

                # Painted closed: the panels are already in the document, so the
                # disclosure is readable without script but starts collapsed.
                page.evaluate(
                    "() => document.querySelectorAll('details').forEach(d => d.removeAttribute('open'))"
                )
                painted = page.evaluate(
                    "(ids) => Object.fromEntries(ids.map(id => "
                    "[id, (document.getElementById(id) || {}).innerHTML || '']))",
                    REGIONS,
                )
                rows = page.locator(".row").count()
                browser.close()
        finally:
            httpd.shutdown()
            httpd.server_close()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    if not rows:
        raise SystemExit("render produced no rows")
    return painted, rows


def paint(html, week, painted):
    for rid in REGIONS:
        html = set_inner(html, rid, painted.get(rid, ""))
    html = re.sub(r"<body([^>]*)>", r'<body\1 data-static-week="%d">' % week, html, count=1)
    html = html.replace("<body", BEGIN + "\n<body", 1)
    return html


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", type=int, default=DEFAULT_WEEK)
    ap.add_argument("--check", action="store_true",
                    help="do not write; exit 1 if index.html differs from a fresh render")
    args = ap.parse_args()

    path = os.path.join(ROOT, "index.html")
    current = read(path)
    shell = strip_static(current)
    painted, rows = render(args.week, shell)
    fresh = paint(shell, args.week, painted)

    if args.check:
        if fresh != current:
            print("index.html is stale: re-run python3 build.py", file=sys.stderr)
            return 1
        print(f"index.html is current: week {args.week}, {rows} rows painted")
        return 0

    with open(path, "w", encoding="utf-8") as fh:
        fh.write(fresh)
    size = len(fresh.encode("utf-8")) / 1024
    print(f"painted week {args.week} into index.html: {rows} rows, {size:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
