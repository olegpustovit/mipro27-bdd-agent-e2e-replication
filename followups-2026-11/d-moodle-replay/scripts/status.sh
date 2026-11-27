#!/usr/bin/env bash
# Progress summary of the replay ledger (no outcomes beyond infrastructure checks).
cd "$(dirname "$0")/.."
tail -2 logs/run-plan.log; grep -c " END " logs/run-plan.log | sed 's/^/jobs ended: /'; grep "exit=[1-9]" logs/run-plan.log
python3 - <<'PY'
import json, collections
c=collections.Counter(); tok=0; errs=[]
for l in open('data/ledger/trials.jsonl'):
    e=json.loads(l)
    if e['type']=='trial-end':
        c[(e.get('arm'), e.get('outcome'))]+=1
        m=e.get('meter') or {}
        if e.get('arm')=='C': tok+=(m.get('inputTokens') or 0)+(m.get('outputTokens') or 0)
        if e.get('outcome')=='error' or e.get('status') in ('error',): errs.append((e['key'], (e.get('error') or e.get('stdoutTail') or '')[:160]))
    if e['type'] in ('trial-interrupted','schedule-stopped'): errs.append((e.get('key'), e['type']))
print(dict(c), f'agent tokens {tok/1e6:.2f}M'); [print(' ', *x) for x in errs]
PY
date -u
