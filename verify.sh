#!/usr/bin/env bash
# Every "done when" check in the roadmap, in order. Exits non-zero on the
# first failure.
#
#   ./verify.sh            # P1, P2, and P3 if playwright is installed
#   ./verify.sh --no-ui    # P1 and P2 only
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

say "P1 — dataset and contract"
python3 tools/corpus_stats.py > /dev/null
echo "  corpus statistics derive cleanly from data/"
python3 -c "
import csv, json, sys
rows = list(csv.DictReader(open('data/tickets.csv', newline='', encoding='utf-8')))
assert len(rows) >= 40, f'ING-03: {len(rows)} ticket rows, need at least 40'
cols = ['ticket_id','workstream','title','status','assignee_role','created_date','status_changed_date','due_date','blocked_by']
assert list(rows[0]) == cols, f'ING-03: columns are {list(rows[0])}'
print(f'  ING-03 ticket export: {len(rows)} rows, all nine columns')
for w in (1,2,3,4):
    t = json.load(open(f'data/transcripts/week-{w}.json', encoding='utf-8'))
    n = len(t['lines'])
    assert 20 <= n <= 30, f'ING-01: week {w} has {n} lines, need 20 to 30'
    assert all(l.get('speaker') and l.get('timestamp') for l in t['lines']), f'ING-01: week {w} unlabelled line'
    a = sum(t['airtime_seconds'].values())
    assert a <= t['duration_seconds'], f'ING-02: week {w} airtime {a} exceeds duration'
print('  ING-01/02 four transcripts, 20-30 labelled lines each, airtime within duration')
"

say "P2 — prompts and scoring"
python3 score.py --check
python3 validate.py
python3 -c "
import json
regs = {w: json.load(open(f'runs/week-{w}-register.json', encoding='utf-8')) for w in (1,2,3,4)}
items = [i for r in regs.values() for i in r['items']]

def need(cond, msg):
    assert cond, 'FAILED: ' + msg
    print('  ' + msg)

need(any(i['type']=='assurance-gap' and i['workstream']=='adoption' for i in regs[3]['items'])
     and not any(i['type']=='risk' and i['workstream']=='adoption' for i in regs[3]['items']),
     'the absent workstream is an assurance gap, not a scored risk')
need(any(i.get('reclassified',{}).get('from_type')=='risk' and i['type']=='issue' for i in items),
     'at least one item reclassifies from risk to issue')
need(any(len({s['type'] for s in i['sources']})==1 and
         {s['type'] for s in i['sources']} <= {'ticket','metadata'} and
         i.get('detection',{}).get('export_only') for i in items),
     'at least one item is evidenced only in the export')
need(any(i['type']=='dependency' and i['blocking'] for i in items),
     'at least one dependency is marked blocking')
need(any(i.get('contradiction',{}).get('present') and
         len(i['contradiction']['source_types'])>=3 for i in items),
     'at least one contradiction is raised citing three source types')
need(any(i.get('hedge',{}).get('cap_applied') and i.get('likelihood',0)<=3 for i in items),
     'at least one hedged claim is capped at likelihood 3')
need(len({i['movement']['state'] for i in items}) == 7,
     'all seven movement states occur across the four weeks')
need(any(i['acceptance']['state']=='amended' for i in items)
     and any(i['acceptance']['state']=='rejected' for i in items)
     and any(i['acceptance'].get('carried_from_week') for i in items),
     'acceptance carries forward, and amend and reject both occur')
"
say "SCO-09 — three repeat runs, identical top 5"
for _ in 1 2 3; do python3 score.py --check 3 | sed 's/^/  /'; done
python3 - <<'PY'
import subprocess
out = {subprocess.run(['python3','score.py','--check','3'], capture_output=True, text=True).stdout
       for _ in range(3)}
assert len(out) == 1, 'SCO-09: repeat runs disagreed'
print('  identical across three runs')
PY

if [ "${1:-}" = "--no-ui" ]; then
  say "done — P1 and P2 pass (P3 skipped)"; exit 0
fi

say "P3 — report"
python3 build.py --check
python3 tools/build_bundle.py
if ! python3 -c "import playwright" 2>/dev/null; then
  echo "  playwright is not installed; skipping the browser checks."
  echo "  pip install playwright  then re-run to check RPT-02..09, NFR-01, NFR-03, NFR-04."
  exit 0
fi
python3 -m http.server 8765 >/dev/null 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
sleep 1
python3 tools/check_report.py
echo
echo "and the same checks against the single-file build over file://"
python3 tools/check_report.py --file | tail -2
echo
echo "first paint with JavaScript disabled"
python3 tools/check_noscript.py

say "all checks pass"
