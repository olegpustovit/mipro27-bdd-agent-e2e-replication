# /// script
# requires-python = ">=3.14"
# ///
"""Coder 2: list browser tool executions with start/end times in omp traces (campaign D events log, Moodle omp blobs)."""
import json, sys
import digest as D
U = [json.loads(l) for l in open(D.HERE.parent / 'units.jsonl')]
_logcache = {}
def unit_events(u):
    if u['app'] == 'moodle':
        return [{'event': json.loads(l), 'at': None} for l in open(D.ROOT / u['paths']['trace'].split()[0]) if l.strip()]
    p = u['paths']['log'].split()[0]
    if p not in _logcache:
        d = {}; cur = None
        for e in D.load_jsonl(p):
            if e['type'] == 'trial-start': cur = e['trial']['id']; d[cur] = []
            elif e['type'] == 'trial-record': cur = None
            elif cur and e['type'] == 'agent-event': d[cur].append(e)
        _logcache[p] = d
    return _logcache[p].get(u['trial_id'], [])
def omp_execs(evs):
    st = {}; order = []
    for e in evs:
        ev = e['event']
        at = e.get('at') or ev.get('timestamp')
        if ev.get('type') == 'tool_execution_start':
            st[ev['toolCallId']] = [ev['toolName'].replace('mcp__study_browser_', ''), at, None, json.dumps({k: v for k, v in (ev.get('args') or {}).items() if k != 'i'}, ensure_ascii=False)[:90]]; order.append(ev['toolCallId'])
        elif ev.get('type') == 'tool_execution_end' and ev['toolCallId'] in st:
            st[ev['toolCallId']][2] = at
    return [st[i] for i in order]
if __name__ == '__main__':
    for idx in map(int, sys.argv[1:]):
        u = U[idx]; ex = omp_execs(unit_events(u))
        print(f'== {idx} {u["unit_id"]}')
        for n, (name, s, e, a) in enumerate(ex, 1):
            ov = [m for m, (nm2, s2, e2, a2) in enumerate(ex[:n-1], 1) if e2 and s and e2 > s]
            print(f'  {n:>2} {name:14} {str(s)[11:23]}-{str(e)[11:23]} {"OVERLAPS " + str(ov) if ov else ""} {a}')
