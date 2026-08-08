#!/usr/bin/env python3
"""Build the static bundle that gets deployed to a host.

    python3 tools/build_deploy.py            # writes dist/
    python3 tools/build_deploy.py --report   # sizes only

`index.html`, `styles.css` and `app.js` are the source of truth and are not
changed by this script beyond comment stripping. The run data is compressed
once and decompressed in the browser, which keeps the whole four-week site
well inside a mobile page-weight budget and lets it be uploaded to a host in
one piece.

The decompression preamble is the only thing the deployed page adds: it
inflates the payload, hands it to `window.RISK_RADAR`, then loads `app.js`
unchanged. app.js already prefers an inlined bundle over fetching, so it
needs no deploy-specific branch.

dist/ is a build output. It is regenerated from the committed sources and is
not itself committed.
"""

import argparse
import base64
import csv
import gzip
import json
import os
import re
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
WEEKS = [1, 2, 3, 4]

LOADER = """<script>
/* Inflates the committed run data, then loads app.js unchanged. The data is
   the same JSON as runs/*.json and data/*; only its transport differs. */
(function () {
  function fail(e) {
    var p = document.getElementById('register');
    if (p) p.textContent = 'Run data did not load: ' + (e && e.message || e);
  }
  try {
    var raw = atob(window.__RR_DATA);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')))
      .text()
      .then(function (text) {
        window.RISK_RADAR = JSON.parse(text);
        delete window.__RR_DATA;
        var s = document.createElement('script');
        s.src = 'app.js';
        document.body.appendChild(s);
      })
      .catch(fail);
  } catch (e) { fail(e); }
})();
</script>"""


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def strip_css(css):
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s*\n\s*", "\n", css)
    return re.sub(r"\n{2,}", "\n", css).strip() + "\n"


def strip_js(js):
    """Remove whole-line comments only. Anything mid-line is left alone, so a
    URL or a string containing // or /* is never touched."""
    js = re.sub(r"^\s*/\*.*?\*/\s*$", "", js, flags=re.S | re.M)
    js = re.sub(r"^\s*//.*$", "", js, flags=re.M)
    return re.sub(r"\n{3,}", "\n\n", js).strip() + "\n"


def payload():
    with open(os.path.join(ROOT, "data", "tickets.csv"), newline="", encoding="utf-8") as fh:
        tickets = list(csv.DictReader(fh))
    return {
        "registers": {str(w): json.loads(read("runs", f"week-{w}-register.json")) for w in WEEKS},
        "transcripts": {str(w): json.loads(read("data", "transcripts", f"week-{w}.json")) for w in WEEKS},
        "tickets": tickets,
        "board": json.loads(read("data", "board.json")),
    }


def build():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(DIST)

    text = json.dumps(payload(), ensure_ascii=False, separators=(",", ":"))
    blob = base64.b64encode(gzip.compress(text.encode("utf-8"), 9)).decode("ascii")

    html = read("index.html")
    html = html.replace(
        '<link rel="stylesheet" href="styles.css">',
        '<link rel="stylesheet" href="styles.css">',
    )
    html = html.replace(
        '<script src="app.js"></script>',
        '<script src="data.js"></script>\n' + LOADER,
    )
    html = re.sub(r"<!--.*?-->", "", html, flags=re.S)

    write(os.path.join(DIST, "index.html"), html)
    write(os.path.join(DIST, "styles.css"), strip_css(read("styles.css")))
    write(os.path.join(DIST, "app.js"), strip_js(read("app.js")))
    write(os.path.join(DIST, "data.js"), "window.__RR_DATA=" + json.dumps(blob) + ";\n")
    # Static host, no build step, no framework to detect.
    write(os.path.join(DIST, "vercel.json"), json.dumps({
        "$schema": "https://openapi.vercel.sh/vercel.json",
        "framework": None,
        "buildCommand": None,
        "outputDirectory": ".",
        "cleanUrls": True,
        "headers": [{
            "source": "/(.*)",
            "headers": [
                {"key": "X-Content-Type-Options", "value": "nosniff"},
                {"key": "Referrer-Policy", "value": "no-referrer"},
            ],
        }],
    }, indent=2) + "\n")

    return text, blob


def write(path, body):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(body)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    args = ap.parse_args()

    text, blob = build()
    files = sorted(os.listdir(DIST))
    total = 0
    for f in files:
        size = os.path.getsize(os.path.join(DIST, f))
        total += size
        print(f"  {f:<14} {size / 1024:7.1f} KB")
    print(f"\n  raw run data      {len(text) / 1024:7.1f} KB")
    print(f"  compressed        {len(blob) / 1024:7.1f} KB "
          f"({len(blob) / len(text) * 100:.0f}% of raw)")
    print(f"  TOTAL deployed    {total / 1024:7.1f} KB "
          f"{'under' if total < 150 * 1024 else 'OVER'} a 150 KB page-weight budget")


if __name__ == "__main__":
    main()
