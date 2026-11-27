# /// script
# requires-python = ">=3.14"
# ///
"""Coder 2 (stream A2): render each unit's agent trace as a readable digest.
Reads only the agent trace (events log / ledger / Moodle blob) and unit fields. No grades, no observer conclusions."""
import json, re, sys, os
from pathlib import Path
from compression import zstd

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
OUT = HERE / 'digests'
OUT.mkdir(exist_ok=True)
units = [json.loads(l) for l in open(HERE.parent / 'units.jsonl')]

def condense(text, cap):
    t = re.sub(r' \[ref=e\d+\]', '', text)
    t = re.sub(r' \[cursor=pointer\]', '', t)
    t = re.sub(r'\n### Events\s*$', '', t)
    if len(t) > cap:
        t = t[:cap] + f'\n…[truncated {len(t)-cap} chars]'
    return t

def content_text(c):
    if c is None: return ''
    if isinstance(c, str): return c
    if isinstance(c, dict):
        if 'content' in c: return content_text(c['content'])
        if 'text' in c: return c['text']
        return json.dumps(c)
    if isinstance(c, list): return '\n'.join(content_text(x) for x in c)
    return str(c)

def from_codex(events):
    out = []
    for ev in events:
        if ev.get('type') != 'item.completed': continue
        it = ev['item']
        if it['type'] == 'agent_message': out.append(('MSG', it['text']))
        elif it['type'] == 'reasoning': out.append(('THINK', it.get('text', '')))
        elif it['type'] == 'mcp_tool_call':
            out.append(('CALL', f"{it['tool']} {json.dumps(it.get('arguments'), ensure_ascii=False)}"))
            r = content_text(it.get('result')) if it.get('result') else ''
            if it.get('error'): r += f"\nERROR: {it['error']}"
            out.append(('RESULT', r))
        elif it['type'] == 'error': out.append(('ERROR', json.dumps(it)))
    return out

def from_omp(events):
    out = []
    for ev in events:
        if ev.get('type') != 'message_end': continue
        m = ev['message']
        if m['role'] == 'assistant':
            for c in m['content']:
                if c['type'] == 'text': out.append(('MSG', c['text']))
                elif c['type'] == 'thinking': out.append(('THINK', c.get('thinking', '')))
                elif c['type'] == 'toolCall':
                    a = {k: v for k, v in c['arguments'].items() if k != 'i'}
                    out.append(('CALL', f"{c['name'].replace('mcp__study_','')} {json.dumps(a, ensure_ascii=False)}"))
            if m.get('stopReason') not in (None, 'toolUse', 'stop', 'end_turn'): out.append(('STOP', str(m.get('stopReason')) + ' ' + str(m.get('errorMessage', ''))))
        elif m['role'] == 'toolResult':
            out.append(('RESULT', ('[isError] ' if m.get('isError') else '') + content_text(m.get('content'))))
    return out

def from_ledger(ledger):
    out = []
    for e in ledger:
        if e['type'] == 'tool-call': out.append(('CALL', f"{e['name']} {json.dumps(e.get('arguments'), ensure_ascii=False)}"))
        elif e['type'] == 'tool-result':
            r = e.get('result', e.get('rawResult'))
            out.append(('RESULT', ('[isError] ' if isinstance(r, dict) and r.get('isError') else '') + content_text(r)))
        else: out.append(('LEDGER', json.dumps(e)[:400]))
    return out

def load_jsonl(p):
    p = ROOT / p
    if p.suffix == '.zst': return [json.loads(l) for l in zstd.decompress(p.read_bytes()).decode().splitlines() if l.strip()]
    return [json.loads(l) for l in open(p) if l.strip()]

cache = {}
def trials_of(path):
    if path not in cache:
        d = {}
        for r in load_jsonl(path):
            rec = r.get('record', r)
            if isinstance(rec, dict) and 'trialId' in rec and 'agent' in rec: d[rec['trialId']] = rec
        cache[path] = d
    return cache[path]

ecache = {}
def events_of(path):
    if path not in ecache:
        d = {}; cur = None
        for e in load_jsonl(path):
            if e['type'] == 'trial-start': cur = e['trial']['id']; d[cur] = []
            elif e['type'] == 'trial-record': cur = None
            elif e['type'] == 'agent-event' and cur: d[cur].append(e['event'])
        ecache[path] = d
    return ecache[path]

def header(u):
    h = [f"UNIT {u['unit_id']}", f"model {u['model']} driver {u['driver']} build {u['build']} type {u['build_type']}",
         f"scenario {u['scenario']} {u.get('scenario_name','')}"]
    h += ['  ' + s for s in u['scenario_steps']]
    h.append(f"fault {json.dumps(u['fault_change'], ensure_ascii=False)}")
    h.append(f"target {u.get('target_step_numbers')} {u.get('target_step')}")
    h.append(f"VERDICT {u['reported_status']} step {u.get('reported_failing_step_number')} '{u.get('reported_failing_step')}'")
    h.append(f"REASON {u.get('reported_reason')}")
    h.append(f"parse_error {u.get('verdict_parse_error')} tool_calls {u['tool_calls']} timed_out {u['agent_timed_out']} run_result {u['run_result']} run_error {u.get('run_error')}")
    if 'reread_status' in u: h.append(f"reread {u['reread_status']}")
    return '\n'.join(h)

def build(u, cap):
    src = ''
    if u['app'] == 'moodle':
        p = ROOT / u['paths']['trace'].split()[0]
        evs = [json.loads(l) for l in open(p) if l.strip()]
        items = from_codex(evs) if u['driver'] == 'codex' else from_omp(evs)
        src = 'moodle blob'
        raw = None
    else:
        tpath = u['paths']['trace'].split()[0]
        rec = trials_of(tpath)[u['trial_id']]
        raw = rec['agent'].get('rawResponse')
        if u['run_set'] in ('B', 'C', 'D'):
            evs = events_of(u['paths']['log'].split()[0]).get(u['trial_id'], [])
            items = from_codex(evs) if u['run_set'] in ('B', 'C') else from_omp(evs)
            src = 'events log'
            if not items: items = from_ledger(rec['agent']['ledger']); src = 'ledger (events empty)'
        else:
            items = from_ledger(rec['agent']['ledger']); src = 'ledger'
    lines = [header(u), f"SOURCE {src}", '=' * 60]
    n = 0
    for kind, txt in items:
        if kind == 'CALL': n += 1; lines.append(f"#{n} CALL {txt}")
        elif kind == 'RESULT': lines.append(f"#{n} RESULT {condense(txt, cap)}")
        elif kind == 'THINK': lines.append(f"THINK {condense(txt, 1500)}")
        else: lines.append(f"{kind} {txt}")
    if raw is not None: lines.append(f"RAWRESPONSE {raw if isinstance(raw,str) else json.dumps(raw)}"[:6000])
    return '\n'.join(lines)

if __name__ == '__main__':
    cap = int(os.environ.get('CAP', '2500'))
    for i, u in enumerate(units):
        name = f"{i:03d}.txt"
        (OUT / name).write_text(build(u, cap))
    print('wrote', len(units))
