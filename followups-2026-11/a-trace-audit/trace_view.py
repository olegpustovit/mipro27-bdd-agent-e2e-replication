# /// script
# requires-python = ">=3.14"
# dependencies = []
# ///
"""Stream A1 coding aid (post-hoc): print a compact, readable digest of the recorded trace of one or more units.

It only reformats recorded evidence: tool calls with arguments, page URLs, snapshot lines that match scenario
keywords, the agent's messages, and the verdict. It reads no automated grades and holds no codes.

  uv run followups-2026-11/a-trace-audit/trace_view.py --set B --type faulty [--scenario bank-create] [--full N]
  uv run followups-2026-11/a-trace-audit/trace_view.py --unit '<unit_id>' --full 999
"""
import argparse
import json
import re
import sys
from functools import cache
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / 'scripts/counts'))
from common import read_jsonl  # noqa: E402

ALWAYS = re.compile(r'alert|error|invalid|dialog|disabled|heading|Page URL|exception|not found|denied|warning', re.I)
CASE_WORDS = {
    'auth-login': ['Sign in', 'Heath93', 'Username or password', 'Log In', 'Sign In'],
    'auth-logout': ['Logout', 'Sign out', 'Sign in', 'signin', 'Heath93'],
    'profile-name': ['First Name', 'Study', 'Last Name', 'Save', 'Heath93', 'textbox'],
    'profile-email': ['Email', 'invalid-email', 'valid email', 'Save', 'Santos'],
    'bank-create': ['Study Credit Union', 'Altered', 'Bank', 'Deleted', 'Routing', 'Account Number', 'Save'],
    'bank-delete': ['Waters', 'Deleted', 'Delete', 'Remove', 'Bank'],
    'transfer-pay': ['Study payment', 'Kristian', 'paid', 'requested', '$12', '$13', 'Pay', 'Amount', 'Personal', 'Mine'],
    'transfer-request': ['Study request', 'Kristian', 'paid', 'requested', '$12', '$13', 'Request', 'Amount', 'Personal', 'Mine'],
    'social-like': ['like', 'Like', '1xfcAhNDZK4', 'transaction'],
    'social-comment': ['comment', 'Comment', 'Study comment', 'Altered', '1xfcAhNDZK4'],
    'feed-personal': ['Mine', 'Friends', 'Personal', 'Contacts', 'personal', 'contacts', 'tab', 'My transactions'],
    'feed-friends': ['Mine', 'Friends', 'Personal', 'Contacts', 'personal', 'contacts', 'tab', 'My transactions'],
}


# Visible signs of each payment fault (coding-rule.md table), searched in tool results. A hit is evidence to read, not a code.
SYMPTOM = {
    'auth-login': r'Username or password is invalid',
    'auth-logout': r'Page URL: http://localhost:3000/(?!signin)\S*',
    'profile-name': r'textbox "First Name"[^\n]*|First Name[^\n]*: \S+|heading "Ted P"[^\n]*|heading "Study P"[^\n]*',
    'profile-email': r'Must contain a valid email[^\n]*|button "Save[^"]*"[^\n]*|textbox "Email"[^\n]*',
    'bank-create': r'Altered Bank|Study Credit Union',
    'bank-delete': r"[^\n]*Waters, King and O'Reilly Bank[^\n]*",
    'transfer-pay': r'[^\n]*\$1[23]\.00[^\n]*|[^\n]*Study payment[^\n]*',
    'transfer-request': r'[^\n]*\b(?:paid|requested|charged)\b[^\n]*|[^\n]*Study request[^\n]*',
    'social-like': r'[^\n]*[Ll]ike[^\n]*',
    'social-comment': r'[^\n]*(?:Altered comment|Study comment)[^\n]*',
    'feed-personal': r'Page URL: \S*(?:personal|contacts|public)\S*|[^\n]*tab "[^"]*" \[selected\][^\n]*',
    'feed-friends': r'Page URL: \S*(?:personal|contacts|public)\S*|[^\n]*tab "[^"]*" \[selected\][^\n]*',
}


def brief(u, tail=5):
    """Compact view: verdict, mechanical step relation, symptom hits per call, last calls, last agent message."""
    steps, msgs, raw, _ = payment_trace(u) if u['app'] == 'payment' else moodle_trace(u)
    rel = ''
    if u['build_type'] == 'faulty' and u['reported_failing_step_number']:
        rep = u['reported_failing_step_number']
        rep = rep if isinstance(rep, list) else [rep]
        tgt = u['target_step_numbers']
        rel = 'same' if set(rep) & set(tgt) else ('later' if min(rep) > min(tgt) else 'earlier')
    print(f'-- {u["unit_id"]} | {u["reported_status"]} | rep {u["reported_failing_step_number"]} tgt {u["target_step_numbers"]} {rel} | calls {u["tool_calls"]}'
          + (f' | reread {u["reread_status"]}' if u.get('reread_status') else '') + (f' | ERR {u["run_error"]}' if u.get('run_error') else ''))
    print(f'   R: {u["reported_reason"]}')
    pat = SYMPTOM.get(u['scenario']) if u['app'] == 'payment' else None
    n, hits, calls = None, [], []
    for kind, num, name, body in steps:
        if kind == 'call':
            n = num
            calls.append(f'#{num} {name.split()[0]} {body[:110]}')
        elif kind == 'result' and pat:
            found = []
            for m in re.finditer(pat, body):
                t = m.group(0).strip()[:140]
                if t not in found:
                    found.append(t)
            if found:
                hits.append(f'#{n}: ' + ' || '.join(found[:4]))
    for h in hits[-6:]:
        print(f'   H {h}')
    for c in calls[-tail:]:
        print(f'   C {c}')
    if msgs:
        print(f'   M {msgs[-2][:300] if len(msgs) > 1 else msgs[-1][:300]}')


def line(u):
    """One line per unit: id, status, reported vs target step, last symptom hit, reason."""
    steps, msgs, raw, _ = payment_trace(u) if u['app'] == 'payment' else moodle_trace(u)
    rel = '-'
    if u['build_type'] == 'faulty' and u['reported_failing_step_number']:
        rep = u['reported_failing_step_number']
        rep = rep if isinstance(rep, list) else [rep]
        tgt = u['target_step_numbers']
        rel = 'same' if set(rep) & set(tgt) else ('later' if min(rep) > min(tgt) else 'earlier')
    pat = SYMPTOM.get(u['scenario']) if u['app'] == 'payment' else None
    n, last = None, ''
    for kind, num, name, body in steps:
        if kind == 'call':
            n = num
        elif kind == 'result' and pat:
            found = []
            for m in re.finditer(pat, body):
                t = m.group(0).strip()[:90]
                if t not in found:
                    found.append(t)
            if found:
                last = f'#{n}: ' + ' || '.join(found[:3])
    uid = u['unit_id'].split(':', 2)[-1].replace('/runtime', '')
    print(f'{uid} | {u["reported_status"][:4]} | {rel} | n{u["tool_calls"]} | H {last[:200]} | R {(u["reported_reason"] or "<no reason; parse error: " + str(u["verdict_parse_error"]) + ">")[:260]}')


def grep(u, regex, context=0):
    """Print every tool-result line matching regex (with call number and optional context lines)."""
    steps, _, _, _ = payment_trace(u) if u['app'] == 'payment' else moodle_trace(u)
    n = None
    rx = re.compile(regex)
    print(f'== {u["unit_id"]}')
    for kind, num, name, body in steps:
        if kind == 'call':
            n = f'{num} {name.split()[0]}'
        elif kind in ('result', 'msg'):
            lines = body.splitlines()
            for i, ln in enumerate(lines):
                if rx.search(ln):
                    seg = lines[max(0, i - context): i + context + 1]
                    print(f'  #{n}{" MSG" if kind == "msg" else ""}: ' + ' / '.join(x.strip()[:160] for x in seg))


def units():
    return [json.loads(l) for l in (HERE / 'units.jsonl').read_text('utf-8').splitlines() if l.strip()]


def selector_path(p):
    return p.split('  [')[0].strip()


@cache
def payment_records(path):
    return {r['record']['trialId']: r['record'] for r in read_jsonl(path)}


@cache
def campaign_messages(path):
    """trialId -> agent messages (Codex agent_message / reasoning, omp assistant text and thinking) from events.jsonl.zst."""
    out, current = {}, None
    for e in read_jsonl(path):
        if e['type'] == 'trial-start':
            current = e['trial']['id']
            out[current] = []
        elif e['type'] == 'agent-event' and current:
            out[current] += event_messages(e['event'])
    return out


def event_messages(ev):
    msgs = []
    if ev.get('type') == 'item.completed' and ev['item'].get('type') in ('agent_message', 'reasoning'):
        msgs.append(f'[{ev["item"]["id"]} {ev["item"]["type"]}] {ev["item"].get("text", "")}')
    if ev.get('type') == 'message_end' and ev.get('message', {}).get('role') == 'assistant':
        for c in ev['message'].get('content', []):
            if c.get('type') == 'text':
                msgs.append(f'[assistant text] {c["text"]}')
            elif c.get('type') == 'thinking' and c.get('thinking'):
                msgs.append(f'[assistant thinking] {c["thinking"]}')
    return msgs


def result_text(res):
    if isinstance(res, dict):
        return '\n'.join(c.get('text', '') for c in res.get('content', []) if isinstance(c, dict))
    return str(res)


def filter_snapshot(text, words, limit):
    lines = text.splitlines()
    keep = []
    for ln in lines:
        s = ln.strip()
        if not s or s.startswith('- /url: http') and 'Page URL' not in s:
            continue
        if ALWAYS.search(s) or any(w in s for w in words):
            keep.append(s[:200])
    if len(keep) > limit:
        keep = keep[:limit] + [f'... (+{len(keep) - limit} more matching lines)']
    return keep


def args_short(a):
    if not isinstance(a, dict):
        return str(a)[:200]
    a = {k: v for k, v in a.items() if k not in ('i', 'intent')}
    return json.dumps(a, ensure_ascii=False)[:300]


def payment_trace(u):
    rec = payment_records(selector_path(u['paths']['trace']))[u['trial_id']]
    steps = []
    for e in rec['agent']['ledger']:
        if e['type'] == 'tool-call':
            steps.append(('call', e['count'], e['name'], args_short(e.get('arguments'))))
        elif e['type'] == 'tool-result':
            steps.append(('result', None, None, result_text(e.get('result') or e.get('rawResult'))))
    msgs = []
    log = selector_path(u['paths']['log'])
    if log.endswith('events.jsonl.zst'):
        msgs = campaign_messages(log).get(u['trial_id'], [])
    return steps, msgs, rec['agent'].get('rawResponse'), rec


def moodle_trace(u):
    steps, msgs, raw, n = [], [], None, 0
    for line in (ROOT / selector_path(u['paths']['trace'])).read_text('utf-8').splitlines():
        ev = json.loads(line)
        t = ev.get('type')
        if t == 'item.completed' and ev['item'].get('type') == 'mcp_tool_call':
            n += 1
            it = ev['item']
            steps.append(('call', n, f'{it["tool"]} <{it["id"]}>', args_short(it.get('arguments'))))
            steps.append(('result', None, None, result_text(it.get('result')) + (f'\nERROR: {it["error"]}' if it.get('error') else '')))
        elif t == 'item.completed' and ev['item'].get('type') in ('agent_message', 'reasoning'):
            steps.append(('msg', None, None, f'[{ev["item"]["id"]}] {ev["item"].get("text", "")}'))
            if ev['item'].get('type') == 'agent_message':
                raw = ev['item'].get('text')
        elif t == 'tool_execution_start':
            n += 1
            steps.append(('call', n, f'{ev["toolName"].replace("mcp__study_", "")} <{ev["toolCallId"][-6:]}>', args_short(ev.get('args'))))
        elif t == 'tool_execution_end':
            steps.append(('result', None, f'<{ev["toolCallId"][-6:]}>', result_text(ev.get('result')) + ('\nERROR' if ev.get('isError') else '')))
        elif t == 'message_end' and ev.get('message', {}).get('role') == 'assistant':
            for m in event_messages(ev):
                steps.append(('msg', None, None, m))
                if m.startswith('[assistant text]'):
                    raw = m[len('[assistant text] '):]
    return steps, [], raw, None


def words_for(u):
    if u['app'] == 'payment':
        return CASE_WORDS[u['scenario']]
    words = set()
    for s in u['scenario_steps']:
        words.update(w for w in re.findall(r'"([^"]{3,})"', s))
    return sorted(words) + ['Mark as done', 'Done', 'completion', 'Submit', 'Save']


def show(u, full, limit):
    print('=' * 110)
    print(f'UNIT {u["unit_id"]}')
    print(f'  model {u["model"]}  build {u["build"]}  type {u["build_type"]}  fault {u["fault_id"]}  status {u["reported_status"]}'
          f'  tool calls {u["tool_calls"]}  timedOut {u["agent_timed_out"]}  run_result {u["run_result"]}  error {u.get("run_error")}')
    if u.get('reread_status'):
        print(f'  re-read status {u["reread_status"]}')
    for s in u['scenario_steps']:
        print(f'    {s.splitlines()[0][:150]}')
    if u['build_type'] == 'faulty':
        print(f'  TARGET {u["target_step_numbers"]}: {u["target_step"]}')
        fc = u['fault_change']
        print(f'  FAULT {json.dumps(fc, ensure_ascii=False)[:400]}')
    print(f'  REPORTED step {u["reported_failing_step_number"]}: {u["reported_failing_step"]}')
    print(f'  REASON {u["reported_reason"]}')
    steps, msgs, raw, _ = payment_trace(u) if u['app'] == 'payment' else moodle_trace(u)
    words = words_for(u)
    calls = [s for s in steps if s[0] == 'call']
    first_full = max(0, len(calls) - full) if full >= 0 else 0
    ci = 0
    for kind, n, name, body in steps:
        if kind == 'call':
            ci += 1
            print(f'  #{n} {name} {body}')
        elif kind == 'msg':
            print(f'    MSG {body[:600]}')
        else:
            url = re.search(r'Page URL: (\S+)', body)
            lines = filter_snapshot(body, words, limit if ci > first_full else 4)
            if not lines and url:
                lines = [f'Page URL: {url[1]}']
            for ln in lines:
                print(f'      | {ln}')
            if not body.strip():
                print('      | (empty result)')
    if msgs:
        print('  AGENT MESSAGES (event log):')
        for m in msgs:
            print(f'    {m[:500]}')
    print(f'  VERDICT {str(raw)[:900]}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--unit', action='append')
    ap.add_argument('--set')
    ap.add_argument('--type')
    ap.add_argument('--scenario')
    ap.add_argument('--full', type=int, default=6, help='filter snapshot lines in full for the last N calls')
    ap.add_argument('--limit', type=int, default=30)
    ap.add_argument('--list', action='store_true')
    ap.add_argument('--brief', action='store_true')
    ap.add_argument('--line', action='store_true')
    ap.add_argument('--grep')
    ap.add_argument('--context', type=int, default=0)
    ap.add_argument('--status')
    a = ap.parse_args()
    for u in units():
        if a.unit and u['unit_id'] not in a.unit:
            continue
        if a.set and u['run_set'] != a.set:
            continue
        if a.type and u['build_type'] != a.type:
            continue
        if a.scenario and u['scenario'] != a.scenario:
            continue
        if a.status and u['reported_status'] != a.status:
            continue
        if a.grep:
            grep(u, a.grep, a.context)
        elif a.line:
            line(u)
        elif a.brief:
            brief(u)
        elif a.list:
            print(u['unit_id'])
        else:
            show(u, a.full, a.limit)


if __name__ == '__main__':
    main()
