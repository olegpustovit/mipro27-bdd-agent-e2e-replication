#!/usr/bin/env bash
# Progress of the stream E-moodle ledger (infrastructure checks only). Usage: status.sh [ledger|smoke-ledger]
cd "$(dirname "$0")/.."
L=${1:-ledger}
tail -3 logs/run-plan.log 2>/dev/null; tail -2 logs/smoke.log 2>/dev/null
python3 - "$L" <<'PY'
import json, sys, collections, os
p=f'data/{sys.argv[1]}/trials.jsonl'
if not os.path.exists(p): print('no ledger', p); sys.exit()
c=collections.Counter(); tok=0; errs=[]
for l in open(p):
    e=json.loads(l)
    if e['type']=='trial-end':
        c[(e.get('arm'), e.get('model'), e.get('outcome'))]+=1
        m=e.get('meter') or {}
        if e.get('arm')=='C': tok+=(m.get('inputTokens') or 0)+(m.get('outputTokens') or 0)
        if e.get('outcome')=='error' or e.get('status')=='error': errs.append((e['key'], (e.get('error') or e.get('stdoutTail') or '')[:200]))
    if e['type'] in ('trial-interrupted','schedule-stopped'): errs.append((e.get('key'), e['type'], e.get('reason')))
for k,v in sorted(c.items(), key=str): print(k, v)
print(f'agent tokens {tok/1e6:.2f}M'); [print(' ', *x) for x in errs]
PY
date -u
